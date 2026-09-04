//! Shutdown: online rooms, authoritative health and vehicle impacts.

use axum::{
    Json,
    extract::{
        Query, State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    response::Response,
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU32, Ordering},
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tokio::sync::mpsc::{UnboundedSender, unbounded_channel};

const MAX_PLAYERS: usize = 4;
const MAX_HP: u8 = 100;
const HIT_DISTANCE: f32 = 2.55;
const HIT_COOLDOWN: Duration = Duration::from_millis(650);
const RESPAWN_DELAY: Duration = Duration::from_millis(4500);
const SPAWN_PROTECTION: Duration = Duration::from_millis(1800);
const WORLD_LIMIT: f32 = 340.0;

const SPAWNS: [(f32, f32, f32); MAX_PLAYERS] = [
    (0.0, 0.0, 0.0),
    (0.0, 78.0, std::f32::consts::PI),
    (-78.0, 0.0, -std::f32::consts::FRAC_PI_2),
    (78.0, 0.0, std::f32::consts::FRAC_PI_2),
];

struct Player {
    id: u32,
    name: String,
    color: u8,
    hp: u8,
    alive: bool,
    spawn: u8,
    x: f32,
    z: f32,
    yaw: f32,
    vx: f32,
    vz: f32,
    destroyed_at: Option<Instant>,
    invulnerable_until: Instant,
    tx: UnboundedSender<String>,
}

impl Player {
    fn public(&self) -> Value {
        json!({
            "id": self.id, "name": self.name, "color": self.color,
            "hp": self.hp, "alive": self.alive, "spawn": self.spawn,
            "x": self.x, "z": self.z, "yaw": self.yaw,
        })
    }
}

struct Room {
    players: Vec<Player>,
    hits: HashMap<(u32, u32), Instant>,
}

impl Room {
    fn new() -> Self {
        Self {
            players: Vec::new(),
            hits: HashMap::new(),
        }
    }

    fn find(&self, id: u32) -> Option<usize> {
        self.players.iter().position(|player| player.id == id)
    }

    fn free_spawn(&self, player_id: u32) -> u8 {
        (0..MAX_PLAYERS as u8)
            .find(|slot| {
                !self
                    .players
                    .iter()
                    .any(|player| player.id != player_id && player.alive && player.spawn == *slot)
            })
            .unwrap_or(0)
    }

    fn send_all(&self, message: &Value) {
        let text = message.to_string();
        for player in &self.players {
            let _ = player.tx.send(text.clone());
        }
    }

    fn send_others(&self, sender: u32, text: &str) {
        for player in &self.players {
            if player.id != sender {
                let _ = player.tx.send(text.to_owned());
            }
        }
    }

    fn roster(&self) -> Value {
        json!({
            "t": "roster",
            "players": self.players.iter().map(Player::public).collect::<Vec<_>>(),
        })
    }
}

pub struct Hub {
    rooms: Mutex<HashMap<String, Room>>,
    next_id: AtomicU32,
}

impl Hub {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            rooms: Mutex::new(HashMap::new()),
            next_id: AtomicU32::new(1),
        })
    }
}

#[derive(Deserialize)]
pub struct JoinParams {
    #[serde(default)]
    pub(crate) room: String,
    #[serde(default)]
    pub(crate) name: String,
}

pub async fn rooms(State(hub): State<Arc<Hub>>) -> Json<Value> {
    Json(room_list(&hub))
}

pub(crate) fn room_list(hub: &Arc<Hub>) -> Value {
    let rooms = hub.rooms.lock().expect("shutdown hub poisoned");
    let mut list: Vec<_> = rooms
        .iter()
        .filter(|(_, room)| !room.players.is_empty())
        .map(|(code, room)| {
            json!({
                "code": code,
                "players": room.players.iter().map(|p| p.name.clone()).collect::<Vec<_>>(),
                "max": MAX_PLAYERS,
            })
        })
        .collect();
    list.sort_by(|a, b| a["code"].as_str().cmp(&b["code"].as_str()));
    Value::Array(list)
}

pub async fn ws(
    upgrade: WebSocketUpgrade,
    Query(params): Query<JoinParams>,
    State(hub): State<Arc<Hub>>,
) -> Response {
    upgrade.on_upgrade(move |socket| session(socket, params, hub))
}

fn clean_name(raw: &str) -> String {
    let name: String = raw
        .trim()
        .chars()
        .filter(|c| c.is_alphanumeric() || matches!(c, ' ' | '-' | '_' | '\''))
        .take(14)
        .collect();
    if name.trim().is_empty() {
        "Pilote".to_owned()
    } else {
        name.trim().to_owned()
    }
}

fn room_code(raw: &str) -> Option<String> {
    let code = raw.trim();
    (code.len() == 4 && code.bytes().all(|c| c.is_ascii_digit())).then(|| code.to_owned())
}

fn make_code(seed: u32) -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.subsec_nanos())
        .unwrap_or(0);
    format!(
        "{:04}",
        seed.wrapping_mul(2_654_435_761).wrapping_add(nanos) % 10_000
    )
}

fn finite(value: &Value, fallback: f32, min: f32, max: f32) -> f32 {
    value
        .as_f64()
        .filter(|number| number.is_finite())
        .map(|number| (number as f32).clamp(min, max))
        .unwrap_or(fallback)
}

fn impact_damage(closing_speed: f32) -> u8 {
    (((closing_speed - 1.5) * 3.1).round() as i32).clamp(6, 38) as u8
}

async fn reject(socket: &mut WebSocket, message: &str) {
    let _ = socket
        .send(Message::Text(
            json!({ "t": "error", "m": message }).to_string().into(),
        ))
        .await;
}

fn add_player(room: &mut Room, id: u32, name: String, tx: UnboundedSender<String>) {
    let spawn = room.free_spawn(id);
    let (x, z, yaw) = SPAWNS[spawn as usize];
    room.players.push(Player {
        id,
        name,
        color: spawn,
        hp: MAX_HP,
        alive: true,
        spawn,
        x,
        z,
        yaw,
        vx: 0.0,
        vz: 0.0,
        destroyed_at: None,
        invulnerable_until: Instant::now() + SPAWN_PROTECTION,
        tx,
    });
}

pub(crate) async fn session(mut socket: WebSocket, params: JoinParams, hub: Arc<Hub>) {
    let (tx, mut rx) = unbounded_channel::<String>();
    let id = hub.next_id.fetch_add(1, Ordering::Relaxed);
    let name = clean_name(&params.name);

    let joined = {
        let mut rooms = hub.rooms.lock().expect("shutdown hub poisoned");
        let requested = if params.room.trim().is_empty() {
            None
        } else {
            room_code(&params.room)
        };
        if !params.room.trim().is_empty() && requested.is_none() {
            Err("Le code doit contenir exactement quatre chiffres.")
        } else if let Some(code) = requested {
            match rooms.get_mut(&code) {
                None => Err("Aucun serveur ne correspond a ce code."),
                Some(room) if room.players.len() >= MAX_PLAYERS => Err("Ce serveur est complet."),
                Some(room) => {
                    add_player(room, id, name.clone(), tx.clone());
                    let _ = tx.send(json!({ "t": "joined", "id": id, "room": code }).to_string());
                    room.send_all(&room.roster());
                    Ok(code)
                }
            }
        } else {
            let mut code = make_code(id);
            for attempt in 1..=10_000 {
                if !rooms.contains_key(&code) {
                    break;
                }
                code = make_code(id.wrapping_add(attempt * 31));
            }
            let room = rooms.entry(code.clone()).or_insert_with(Room::new);
            add_player(room, id, name, tx.clone());
            let _ = tx.send(json!({ "t": "joined", "id": id, "room": code }).to_string());
            room.send_all(&room.roster());
            Ok(code)
        }
    };

    let code = match joined {
        Ok(code) => code,
        Err(message) => {
            reject(&mut socket, message).await;
            return;
        }
    };

    let mut last_seen = Instant::now();
    'connection: loop {
        let text = tokio::select! {
            _ = tokio::time::sleep(Duration::from_secs(30)) => {
                if last_seen.elapsed() > Duration::from_secs(100) { break 'connection; }
                continue 'connection;
            }
            queued = rx.recv() => match queued {
                Some(text) => {
                    if socket.send(Message::Text(text.into())).await.is_err() { break 'connection; }
                    continue 'connection;
                }
                None => break 'connection,
            },
            incoming = socket.recv() => match incoming {
                Some(Ok(Message::Text(text))) => {
                    last_seen = Instant::now();
                    text.to_string()
                }
                Some(Ok(Message::Close(_))) | None => break 'connection,
                Some(Ok(_)) => continue 'connection,
                Some(Err(_)) => break 'connection,
            }
        };

        let Ok(value) = serde_json::from_str::<Value>(&text) else {
            continue;
        };
        let mut rooms = hub.rooms.lock().expect("shutdown hub poisoned");
        let Some(room) = rooms.get_mut(&code) else {
            break;
        };
        let Some(me) = room.find(id) else {
            break;
        };

        match value["t"].as_str().unwrap_or_default() {
            "s" if room.players[me].alive => {
                let player = &mut room.players[me];
                player.x = finite(&value["x"], player.x, -WORLD_LIMIT, WORLD_LIMIT);
                player.z = finite(&value["z"], player.z, -WORLD_LIMIT, WORLD_LIMIT);
                player.yaw = finite(&value["yaw"], player.yaw, -100.0, 100.0);
                player.vx = finite(&value["vx"], player.vx, -60.0, 60.0);
                player.vz = finite(&value["vz"], player.vz, -60.0, 60.0);
                let state = json!({
                    "t": "s", "id": id, "x": player.x, "z": player.z,
                    "yaw": player.yaw, "vx": player.vx, "vz": player.vz,
                })
                .to_string();
                room.send_others(id, &state);
                apply_collision(room, me);
            }
            "respawn" => {
                let ready = room.players[me]
                    .destroyed_at
                    .is_some_and(|destroyed| destroyed.elapsed() >= RESPAWN_DELAY);
                if ready {
                    let spawn = room.free_spawn(id);
                    let (x, z, yaw) = SPAWNS[spawn as usize];
                    let player = &mut room.players[me];
                    player.hp = MAX_HP;
                    player.alive = true;
                    player.spawn = spawn;
                    player.x = x;
                    player.z = z;
                    player.yaw = yaw;
                    player.vx = 0.0;
                    player.vz = 0.0;
                    player.destroyed_at = None;
                    player.invulnerable_until = Instant::now() + SPAWN_PROTECTION;
                    room.send_all(&json!({
                        "t": "respawn", "id": id, "hp": MAX_HP,
                        "spawn": spawn, "x": x, "z": z, "yaw": yaw,
                    }));
                }
            }
            "ping" => {
                let _ = room.players[me].tx.send(json!({ "t": "pong" }).to_string());
            }
            _ => {}
        }
    }

    let mut rooms = hub.rooms.lock().expect("shutdown hub poisoned");
    if let Some(room) = rooms.get_mut(&code) {
        room.players.retain(|player| player.id != id);
        room.hits.retain(|(a, b), _| *a != id && *b != id);
        if room.players.is_empty() {
            rooms.remove(&code);
        } else {
            room.send_all(&json!({ "t": "left", "id": id }));
            room.send_all(&room.roster());
        }
    }
}

fn apply_collision(room: &mut Room, me: usize) {
    let now = Instant::now();
    let a = &room.players[me];
    let collision = room.players.iter().enumerate().find_map(|(index, b)| {
        if index == me || !b.alive {
            return None;
        }
        let dx = b.x - a.x;
        let dz = b.z - a.z;
        let distance = dx.hypot(dz);
        if !(0.01..HIT_DISTANCE).contains(&distance) {
            return None;
        }
        let nx = dx / distance;
        let nz = dz / distance;
        let closing = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
        (closing > 2.5).then_some((index, closing))
    });
    let Some((other, closing)) = collision else {
        return;
    };
    let a_id = room.players[me].id;
    let b_id = room.players[other].id;
    let key = if a_id < b_id {
        (a_id, b_id)
    } else {
        (b_id, a_id)
    };
    if room.hits.get(&key).is_some_and(|until| *until > now) {
        return;
    }
    room.hits.insert(key, now + HIT_COOLDOWN);
    let damage = impact_damage(closing);

    for index in [me, other] {
        let player = &mut room.players[index];
        if now >= player.invulnerable_until {
            player.hp = player.hp.saturating_sub(damage);
            if player.hp == 0 {
                player.alive = false;
                player.destroyed_at = Some(now);
                player.vx = 0.0;
                player.vz = 0.0;
            }
        }
    }
    let a = &room.players[me];
    let b = &room.players[other];
    room.send_all(&json!({
        "t": "hit", "a": a.id, "b": b.id, "damage": damage,
        "hp_a": a.hp, "hp_b": b.hp, "alive_a": a.alive, "alive_b": b.alive,
    }));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn damage_is_bounded_and_grows_with_impact() {
        assert_eq!(impact_damage(3.0), 6);
        assert!(impact_damage(12.0) > impact_damage(5.0));
        assert_eq!(impact_damage(100.0), 38);
    }

    #[test]
    fn codes_require_four_ascii_digits() {
        assert_eq!(room_code(" 0042 ").as_deref(), Some("0042"));
        assert_eq!(room_code("42"), None);
        assert_eq!(room_code("12A4"), None);
    }
}
