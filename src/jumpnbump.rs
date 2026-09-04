//! Jump'n Bump — salons et relais temps réel.
//!
//! Le serveur ne simule rien : chaque client fait tourner sa propre
//! physique et diffuse la position de son lapin. Le serveur tient la
//! liste des salons, arbitre les sauts mortels (un seul tueur par vie)
//! et compte les points. Ça suffit pour quatre lapins et ça évite
//! d'embarquer le masque de collision côté serveur.

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
};
use tokio::sync::mpsc::{UnboundedSender, unbounded_channel};

/// Quatre lapins, comme dans le jeu d'origine.
pub const MAX_PLAYERS: usize = 4;
/// Huit pelages dans `lapin.png`, un seul par salon.
const COLORS: u8 = 8;
/// Four distant spawn zones. Rust assigns the zone; the browser only
/// maps it to a walkable point detected in the current map asset.
const SPAWN_SLOTS: u8 = MAX_PLAYERS as u8;

#[derive(Clone, Copy, PartialEq)]
enum Phase {
    Lobby,
    Playing,
    Over,
}

impl Phase {
    fn as_str(self) -> &'static str {
        match self {
            Phase::Lobby => "lobby",
            Phase::Playing => "playing",
            Phase::Over => "over",
        }
    }
}

struct Player {
    id: u32,
    name: String,
    color: u8,
    ready: bool,
    score: u32,
    /// Numéro de vie : sert à ne compter qu'un tueur par mort, même si
    /// deux lapins atterrissent sur la même tête dans la même image.
    life: u32,
    alive: bool,
    spawn: u8,
    tx: UnboundedSender<String>,
}

impl Player {
    fn public(&self) -> Value {
        json!({
            "id": self.id,
            "name": self.name,
            "color": self.color,
            "ready": self.ready,
            "score": self.score,
            "life": self.life,
            "alive": self.alive,
            "spawn": self.spawn,
        })
    }
}

struct Room {
    players: Vec<Player>,
    host: u32,
    phase: Phase,
    target: u32,
    /// Un salon prive ne figure pas dans la liste publique : on n'y
    /// entre qu'en tapant son code.
    private: bool,
    next_spawn: u8,
}

impl Room {
    fn new() -> Self {
        Room {
            players: Vec::new(),
            host: 0,
            phase: Phase::Lobby,
            target: 15,
            private: false,
            next_spawn: 0,
        }
    }

    fn find(&self, id: u32) -> Option<usize> {
        self.players.iter().position(|p| p.id == id)
    }

    fn free_color(&self) -> u8 {
        (0..COLORS)
            .find(|c| !self.players.iter().any(|p| p.color == *c))
            .unwrap_or(0)
    }

    /// Pick a slot not used by another living player and rotate the
    /// preference so repeated respawns do not always use the same area.
    fn free_spawn(&mut self, player_id: u32) -> u8 {
        for offset in 0..SPAWN_SLOTS {
            let candidate = (self.next_spawn + offset) % SPAWN_SLOTS;
            let occupied = self
                .players
                .iter()
                .any(|p| p.id != player_id && p.alive && p.spawn == candidate);
            if !occupied {
                self.next_spawn = (candidate + 1) % SPAWN_SLOTS;
                return candidate;
            }
        }
        0
    }

    fn reset_spawns(&mut self) {
        for (slot, player) in self.players.iter_mut().enumerate() {
            player.spawn = slot as u8;
        }
        self.next_spawn = (self.players.len() as u8) % SPAWN_SLOTS;
    }

    fn send_all(&self, msg: &Value) {
        let text = msg.to_string();
        for p in &self.players {
            let _ = p.tx.send(text.clone());
        }
    }

    fn send_others(&self, from: u32, text: &str) {
        for p in &self.players {
            if p.id != from {
                let _ = p.tx.send(text.to_string());
            }
        }
    }

    fn lobby_state(&self) -> Value {
        json!({
            "t": "lobby",
            "host": self.host,
            "phase": self.phase.as_str(),
            "target": self.target,
            "players": self.players.iter().map(|p| p.public()).collect::<Vec<_>>(),
        })
    }
}

pub struct Hub {
    rooms: Mutex<HashMap<String, Room>>,
    next_id: AtomicU32,
}

impl Hub {
    pub fn new() -> Arc<Self> {
        Arc::new(Hub {
            rooms: Mutex::new(HashMap::new()),
            next_id: AtomicU32::new(1),
        })
    }
}

/// `GET /api/jnb/rooms` — de quoi peupler la liste des salons ouverts.
pub async fn rooms(State(hub): State<Arc<Hub>>) -> Json<Value> {
    let rooms = hub.rooms.lock().expect("hub empoisonné");
    let mut list: Vec<Value> = rooms
        .iter()
        .filter(|(_, r)| !r.players.is_empty() && !r.private)
        .map(|(code, r)| {
            json!({
                "code": code,
                "phase": r.phase.as_str(),
                "target": r.target,
                "players": r.players.iter().map(|p| p.name.clone()).collect::<Vec<_>>(),
                "max": MAX_PLAYERS,
            })
        })
        .collect();
    list.sort_by(|a, b| a["code"].as_str().cmp(&b["code"].as_str()));
    Json(Value::Array(list))
}

#[derive(Deserialize)]
pub struct JoinParams {
    /// Code du salon ; vide ou absent, le serveur en crée un.
    #[serde(default)]
    room: String,
    #[serde(default)]
    name: String,
    /// « 1 » a la creation pour ouvrir un salon prive.
    #[serde(default, rename = "priv")]
    priv_: String,
}

pub async fn ws(
    upgrade: WebSocketUpgrade,
    Query(params): Query<JoinParams>,
    State(hub): State<Arc<Hub>>,
) -> Response {
    upgrade.on_upgrade(move |socket| session(socket, params, hub))
}

/// Un code de salon : quatre chiffres, faciles a dicter et a taper.
fn make_code(seed: u32) -> String {
    let mut n = seed.wrapping_mul(2_654_435_761).wrapping_add(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.subsec_nanos())
            .unwrap_or(0),
    );
    let mut out = String::with_capacity(4);
    for _ in 0..4 {
        out.push((b'0' + (n % 10) as u8) as char);
        n /= 10;
    }
    out
}

fn clean_name(raw: &str) -> String {
    let kept: String = raw
        .trim()
        .chars()
        .filter(|c| c.is_alphanumeric() || matches!(c, ' ' | '-' | '_' | '\''))
        .take(14)
        .collect();
    let kept = kept.trim().to_string();
    if kept.is_empty() {
        "Lapin".to_string()
    } else {
        kept
    }
}

fn room_code(raw: &str) -> Option<String> {
    let code = raw.trim();
    (code.len() == 4 && code.bytes().all(|c| c.is_ascii_digit())).then(|| code.to_owned())
}

async fn session(mut socket: WebSocket, params: JoinParams, hub: Arc<Hub>) {
    // Chaque joueur a une file d'envoi : les autres sessions y déposent
    // du texte sans jamais attendre le réseau d'en face, et la boucle
    // ci-dessous alterne entre vider cette file et lire la socket.
    let (tx, mut rx) = unbounded_channel::<String>();

    let id = hub.next_id.fetch_add(1, Ordering::Relaxed);
    let name = clean_name(&params.name);

    // A join code must point to an existing room. Room creation only
    // happens when the query has no code (the dedicated Create button).
    let join_error = {
        let rooms = hub.rooms.lock().expect("hub empoisonne");
        let raw = params.room.trim();
        if raw.is_empty() {
            None
        } else if room_code(raw).is_none() {
            Some("Le code doit contenir exactement quatre chiffres.")
        } else {
            match rooms.get(raw) {
                None => Some("Aucun salon ne correspond a ce code."),
                Some(room) if room.phase != Phase::Lobby => Some("Cette partie a deja commence."),
                Some(_) => None,
            }
        }
    };
    if let Some(message) = join_error {
        let _ = socket
            .send(Message::Text(
                json!({ "t": "error", "m": message }).to_string().into(),
            ))
            .await;
        return;
    }

    // Entrée dans un salon existant, ou création quand aucun code
    // n'est fourni.
    // Tout se joue sous le verrou, sans le moindre `await` : le garde
    // du Mutex ne doit jamais traverser un point d'attente.
    let joined = {
        let mut rooms = hub.rooms.lock().expect("hub empoisonné");
        let requested: String = params
            .room
            .trim()
            .chars()
            .filter(|c| c.is_ascii_digit())
            .take(4)
            .collect();
        let requested = if requested.len() == 4 {
            requested
        } else {
            String::new()
        };
        let code = if requested.is_empty() {
            let mut c = make_code(id);
            let mut tries = 0u32;
            while rooms.contains_key(&c) {
                tries += 1;
                c = make_code(id.wrapping_add(tries.wrapping_mul(31)));
            }
            c
        } else {
            requested
        };

        let fresh = !rooms.contains_key(&code);
        let room = rooms.entry(code.clone()).or_insert_with(Room::new);
        if fresh {
            room.private = params.priv_ == "1";
        }
        if room.players.len() >= MAX_PLAYERS {
            Err("Ce salon est complet.")
        } else {
            let color = room.free_color();
            let spawn = room.free_spawn(id);
            if room.players.is_empty() {
                room.host = id;
            }
            room.players.push(Player {
                id,
                name: name.clone(),
                color,
                ready: false,
                score: 0,
                // Une partie déjà lancée accueille le retardataire tout
                // de suite : il entre en jeu à son prochain `respawn`.
                life: 0,
                alive: room.phase != Phase::Playing,
                spawn,
                tx: tx.clone(),
            });
            let _ = tx.send(
                json!({ "t": "joined", "id": id, "room": code, "max": MAX_PLAYERS }).to_string(),
            );
            room.send_all(&room.lobby_state());
            Ok(code)
        }
    };

    let code = match joined {
        Ok(code) => code,
        Err(message) => {
            let _ = socket
                .send(Message::Text(
                    json!({ "t": "error", "m": message }).to_string().into(),
                ))
                .await;
            return;
        }
    };

    // Derriere un proxy, une connexion morte peut rester ouverte
    // longtemps : sans ce garde-fou, un salon fantome survit a son
    // dernier joueur. Le client envoie un ping toutes les 25 s.
    let mut last_seen = std::time::Instant::now();

    'session: loop {
        let text = tokio::select! {
            _ = tokio::time::sleep(std::time::Duration::from_secs(30)) => {
                if last_seen.elapsed() > std::time::Duration::from_secs(100) {
                    break 'session;
                }
                continue 'session;
            }
            // Sortie : ce que les autres salons ont écrit pour ce joueur.
            queued = rx.recv() => {
                match queued {
                    Some(out) => {
                        if socket.send(Message::Text(out.into())).await.is_err() {
                            break 'session;
                        }
                        continue 'session;
                    }
                    None => break 'session,
                }
            }
            // Entrée : ce que ce joueur nous envoie.
            incoming = socket.recv() => {
                match incoming {
                    Some(Ok(Message::Text(t))) => {
                        last_seen = std::time::Instant::now();
                        t.to_string()
                    }
                    Some(Ok(Message::Close(_))) | None => break 'session,
                    Some(Ok(_)) => continue 'session,
                    Some(Err(_)) => break 'session,
                }
            }
        };
        let Ok(v) = serde_json::from_str::<Value>(&text) else {
            continue;
        };
        let mut rooms = hub.rooms.lock().expect("hub empoisonné");
        let Some(room) = rooms.get_mut(&code) else {
            break 'session;
        };
        let Some(me) = room.find(id) else {
            break 'session;
        };

        match v["t"].as_str().unwrap_or("") {
            // Position d'un lapin : relayée telle quelle aux voisins.
            "s" => {
                let out = json!({
                    "t": "s", "i": id,
                    "x": v["x"], "y": v["y"], "vx": v["vx"], "vy": v["vy"],
                    "f": v["f"], "a": v["a"], "st": v["st"],
                })
                .to_string();
                room.send_others(id, &out);
            }
            "color" => {
                let c = v["c"].as_u64().unwrap_or(0) as u8;
                let taken = room.players.iter().any(|p| p.id != id && p.color == c);
                if c < COLORS && !taken {
                    room.players[me].color = c;
                    room.send_all(&room.lobby_state());
                }
            }
            // Le prenom se change dans le lobby, en direct.
            "name" => {
                let n = clean_name(v["n"].as_str().unwrap_or(""));
                if room.players[me].name != n {
                    room.players[me].name = n;
                    room.send_all(&room.lobby_state());
                }
            }
            "ready" => {
                room.players[me].ready = v["v"].as_bool().unwrap_or(false);
                room.send_all(&room.lobby_state());
            }
            "target" => {
                if room.host == id {
                    room.target = v["n"].as_u64().unwrap_or(15).clamp(3, 99) as u32;
                    room.send_all(&room.lobby_state());
                }
            }
            "start" => {
                if room.host == id {
                    room.phase = Phase::Playing;
                    room.reset_spawns();
                    for p in &mut room.players {
                        p.score = 0;
                        p.life = 0;
                        p.alive = true;
                        p.ready = false;
                    }
                    room.send_all(&json!({
                        "t": "start",
                        "target": room.target,
                        "players": room.players.iter().map(|p| p.public()).collect::<Vec<_>>(),
                    }));
                    room.send_all(&room.lobby_state());
                }
            }
            "back" => {
                if room.host == id {
                    room.phase = Phase::Lobby;
                    for p in &mut room.players {
                        p.ready = false;
                    }
                    room.send_all(&json!({ "t": "back" }));
                    room.send_all(&room.lobby_state());
                }
            }
            // « J'ai sauté sur la tête de V, qui en était à sa vie L. »
            // Le numéro de vie fait office de jeton : la deuxième
            // réclamation pour la même mort tombe à l'eau.
            "k" => {
                let victim = v["v"].as_u64().unwrap_or(0) as u32;
                let life = v["l"].as_u64().unwrap_or(0) as u32;
                if room.phase != Phase::Playing || victim == id {
                    continue;
                }
                let Some(vi) = room.find(victim) else {
                    continue;
                };
                if !room.players[vi].alive || room.players[vi].life != life {
                    continue;
                }
                room.players[vi].alive = false;
                room.players[me].score += 1;
                let score = room.players[me].score;
                room.send_all(&json!({
                    "t": "k", "k": id, "v": victim, "l": life, "s": score,
                }));
                if score >= room.target {
                    room.phase = Phase::Over;
                    room.send_all(&json!({ "t": "over", "w": id }));
                    room.send_all(&room.lobby_state());
                }
            }
            "r" => {
                // Respawns are decided by Rust. Coordinates sent by an
                // older or modified client are deliberately ignored.
                if room.phase != Phase::Playing || room.players[me].alive {
                    continue;
                }
                let spawn = room.free_spawn(id);
                room.players[me].alive = true;
                room.players[me].life += 1;
                room.players[me].spawn = spawn;
                let life = room.players[me].life;
                room.send_all(&json!({
                    "t": "r", "i": id, "spawn": spawn, "l": life,
                }));
            }
            // Le decompte d'avant-partie : l'hote decide, le serveur
            // relaie. Chaque client fait tourner sa propre horloge.
            "cd" => {
                if room.host == id {
                    let on = v["on"].as_bool().unwrap_or(false);
                    room.send_all(&json!({ "t": "cd", "on": on }));
                }
            }
            "ping" => {
                let _ = room.players[me].tx.send(json!({ "t": "pong" }).to_string());
            }
            _ => {}
        }
    }

    // Sortie : on retire le lapin, on repasse l'hôte au suivant, et on
    // efface le salon s'il ne reste personne.
    {
        let mut rooms = hub.rooms.lock().expect("hub empoisonné");
        if let Some(room) = rooms.get_mut(&code) {
            room.players.retain(|p| p.id != id);
            if room.players.is_empty() {
                rooms.remove(&code);
            } else {
                if room.host == id {
                    room.host = room.players[0].id;
                }
                room.send_all(&json!({ "t": "left", "i": id }));
                room.send_all(&room.lobby_state());
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn player(id: u32, spawn: u8, alive: bool) -> Player {
        let (tx, _) = unbounded_channel();
        Player {
            id,
            name: format!("Lapin {id}"),
            color: id as u8,
            ready: false,
            score: 0,
            life: 0,
            alive,
            spawn,
            tx,
        }
    }

    #[test]
    fn room_codes_are_exactly_four_ascii_digits() {
        assert_eq!(room_code(" 0427 ").as_deref(), Some("0427"));
        assert_eq!(room_code("123"), None);
        assert_eq!(room_code("12a4"), None);
        assert_eq!(room_code("12345"), None);
    }

    #[test]
    fn respawn_avoids_all_living_players() {
        let mut room = Room::new();
        room.players = vec![
            player(1, 0, true),
            player(2, 1, true),
            player(3, 2, true),
            player(4, 3, false),
        ];
        assert_eq!(room.free_spawn(4), 3);
    }

    #[test]
    fn match_start_assigns_distinct_slots() {
        let mut room = Room::new();
        room.players = (1..=MAX_PLAYERS as u32)
            .map(|id| player(id, 0, true))
            .collect();
        room.reset_spawns();
        let slots: Vec<u8> = room.players.iter().map(|p| p.spawn).collect();
        assert_eq!(slots, vec![0, 1, 2, 3]);
    }
}
