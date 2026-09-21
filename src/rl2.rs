//! RL2 — parties en ligne.
//!
//! Contrairement a Jump'n Bump, le serveur ne relaie pas : il simule. Il fait
//! tourner le meme moteur que le navigateur (`voidbelt_rl2`), n'accepte des
//! clients que leurs commandes, et rediffuse l'etat complet a 60 Hz. Personne
//! ne peut donc mentir sur sa position, et les deux camps voient exactement
//! la meme partie.
//!
//! Un salon simule des sa creation : on y roule librement en attendant que
//! l'hote lance le match.

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
    time::{Duration, Instant},
};
use tokio::sync::mpsc::{UnboundedSender, unbounded_channel};
use voidbelt_rl2::{
    car::Input,
    game::{CARS, Game, Phase},
    state,
};

/// Un match RL2 se joue a deux, comme le moteur.
pub const SEATS: usize = CARS;
const TICK: Duration = Duration::from_millis(16);
const MATCH_SECONDS: f32 = 300.0;
/// Delai avant de renvoyer tout le monde au salon, match termine.
const REMATCH_AFTER: f32 = 8.0;
/// Au-dela, un salon vide est oublie.
const EMPTY_GRACE: f32 = 20.0;
/// Sans nouvelle commande pendant ce delai, on relache les gaz du joueur.
/// Un onglet passe en arriere-plan cesse d'emettre : sans ca sa voiture
/// continuerait tout droit sur sa derniere consigne.
const INPUT_GRACE: f32 = 0.6;

struct Seat {
    id: u32,
    name: String,
    /// Temps ecoule depuis la derniere commande recue.
    idle: f32,
    tx: UnboundedSender<Message>,
}

struct Room {
    code: String,
    game: Game,
    seats: [Option<Seat>; SEATS],
    host: u32,
    over_for: f32,
    empty_for: f32,
    /// Tampons reutilises : a 60 Hz, mieux vaut ne rien allouer par image.
    floats: Vec<f32>,
    events: Vec<f32>,
    bytes: Vec<u8>,
}

impl Room {
    fn new(code: String, seed: u32) -> Room {
        Room {
            code,
            game: Game::warmup(seed, MATCH_SECONDS),
            seats: [const { None }; SEATS],
            host: 0,
            over_for: 0.0,
            empty_for: 0.0,
            floats: vec![0.0; state::STATE_LEN],
            events: Vec::with_capacity(64),
            bytes: Vec::with_capacity(state::STATE_LEN * 8),
        }
    }

    fn taken(&self) -> usize {
        self.seats.iter().filter(|s| s.is_some()).count()
    }

    fn free_seat(&self) -> Option<usize> {
        self.seats.iter().position(|s| s.is_none())
    }

    fn step(&mut self, dt: f32) {
        if self.taken() == 0 {
            self.empty_for += dt;
            return;
        }
        self.empty_for = 0.0;
        for (slot, seat) in self.seats.iter_mut().enumerate() {
            let Some(seat) = seat else { continue };
            seat.idle += dt;
            if seat.idle > INPUT_GRACE {
                self.game.set_input(slot, Input::default());
            }
        }
        self.game.step(dt);

        // Match fini : on laisse le tableau s'afficher, puis retour au salon
        // pour enchainer sans avoir a recreer la partie.
        if self.game.phase == Phase::Over {
            self.over_for += dt;
            if self.over_for >= REMATCH_AFTER {
                self.over_for = 0.0;
                self.game.back_to_warmup();
                self.announce();
            }
        } else {
            self.over_for = 0.0;
        }

        self.broadcast_state();
    }

    /// Etat + evenements de l'image, concatenes en un seul bloc de `f32`.
    /// Le client connait `STATE_LEN` et coupe au bon endroit.
    fn broadcast_state(&mut self) {
        state::write_state(&self.game, &mut self.floats);
        state::write_events(&self.game, &mut self.events);
        self.bytes.clear();
        for f in self.floats.iter().chain(self.events.iter()) {
            self.bytes.extend_from_slice(&f.to_le_bytes());
        }
        let frame = Message::Binary(self.bytes.clone().into());
        for seat in self.seats.iter().flatten() {
            let _ = seat.tx.send(frame.clone());
        }
    }

    fn public(&self, code: &str) -> Value {
        let players: Vec<Value> = self
            .seats
            .iter()
            .enumerate()
            .filter_map(|(slot, s)| {
                s.as_ref()
                    .map(|s| json!({ "id": s.id, "name": s.name, "slot": slot }))
            })
            .collect();
        json!({
            "code": code,
            "host": self.host,
            "phase": phase_name(self.game.phase),
            "seats": SEATS,
            "players": players,
        })
    }

    /// Previent tout le monde que la composition ou la phase a bouge.
    fn announce(&self) {
        let msg = json!({ "t": "room", "room": self.public(&self.code) }).to_string();
        let frame = Message::Text(msg.into());
        for seat in self.seats.iter().flatten() {
            let _ = seat.tx.send(frame.clone());
        }
    }
}

fn phase_name(p: Phase) -> &'static str {
    match p {
        Phase::Warmup => "warmup",
        Phase::Countdown => "countdown",
        Phase::Play => "play",
        Phase::Goal => "goal",
        Phase::Over => "over",
    }
}

pub struct Hub {
    rooms: Mutex<HashMap<String, Room>>,
    next_id: AtomicU32,
}

impl Hub {
    /// Cree le hub et lance sa boucle de simulation. A appeler dans le
    /// runtime tokio du serveur.
    pub fn new() -> Arc<Hub> {
        let hub = Arc::new(Hub {
            rooms: Mutex::new(HashMap::new()),
            next_id: AtomicU32::new(1),
        });
        let ticker = hub.clone();
        tokio::spawn(async move { ticker.run().await });
        hub
    }

    async fn run(self: Arc<Self>) {
        let mut clock = tokio::time::interval(TICK);
        let mut last = Instant::now();
        loop {
            clock.tick().await;
            let dt = last.elapsed().as_secs_f32().min(0.1);
            last = Instant::now();
            // Le verrou ne traverse aucun `await` : la simulation est courte
            // et purement calculatoire.
            let mut rooms = self.rooms.lock().expect("hub empoisonne");
            for room in rooms.values_mut() {
                room.step(dt);
            }
            rooms.retain(|_, r| r.taken() > 0 || r.empty_for < EMPTY_GRACE);
        }
    }
}

#[derive(Deserialize)]
pub struct JoinParams {
    #[serde(default)]
    pub room: String,
    #[serde(default)]
    pub name: String,
}

pub async fn rooms(State(hub): State<Arc<Hub>>) -> Json<Value> {
    let rooms = hub.rooms.lock().expect("hub empoisonne");
    let open: Vec<Value> = rooms
        .iter()
        .filter(|(_, r)| r.taken() > 0)
        .map(|(code, r)| r.public(code))
        .collect();
    Json(json!({ "rooms": open }))
}

pub async fn ws(
    upgrade: WebSocketUpgrade,
    Query(params): Query<JoinParams>,
    State(hub): State<Arc<Hub>>,
) -> Response {
    upgrade.on_upgrade(move |socket| session(socket, params, hub))
}

fn clean_name(raw: &str) -> String {
    let name: String = raw.trim().chars().filter(|c| !c.is_control()).take(16).collect();
    if name.is_empty() {
        "Pilote".into()
    } else {
        name
    }
}

fn make_code(seed: u32) -> String {
    format!("{:04}", seed.wrapping_mul(7919) % 10_000)
}

async fn session(mut socket: WebSocket, params: JoinParams, hub: Arc<Hub>) {
    let (tx, mut rx) = unbounded_channel::<Message>();
    let id = hub.next_id.fetch_add(1, Ordering::Relaxed);
    let name = clean_name(&params.name);

    // Entree dans un salon, ou creation quand aucun code n'est fourni. Tout
    // se joue sous le verrou, sans `await` au milieu.
    let seated = {
        let mut rooms = hub.rooms.lock().expect("hub empoisonne");
        let wanted: String = params
            .room
            .trim()
            .chars()
            .filter(|c| c.is_ascii_digit())
            .take(4)
            .collect();
        if wanted.len() == 4 {
            match rooms.get_mut(&wanted) {
                None => Err("Aucun salon ne correspond a ce code."),
                Some(room) => match room.free_seat() {
                    None => Err("Ce salon est complet."),
                    Some(slot) => {
                        room.seats[slot] =
                            Some(Seat { id, name: name.clone(), idle: 0.0, tx: tx.clone() });
                        Ok((wanted, slot))
                    }
                },
            }
        } else {
            let mut code = make_code(id);
            while rooms.contains_key(&code) {
                code = make_code(id.wrapping_add(rooms.len() as u32 + 1));
            }
            let mut room = Room::new(code.clone(), id);
            room.host = id;
            room.seats[0] = Some(Seat { id, name: name.clone(), idle: 0.0, tx: tx.clone() });
            rooms.insert(code.clone(), room);
            Ok((code, 0))
        }
    };

    let (code, slot) = match seated {
        Err(message) => {
            let _ = socket
                .send(Message::Text(
                    json!({ "t": "error", "m": message }).to_string().into(),
                ))
                .await;
            return;
        }
        Ok(v) => v,
    };

    {
        let rooms = hub.rooms.lock().expect("hub empoisonne");
        if let Some(room) = rooms.get(&code) {
            let hello = json!({
                "t": "hello",
                "you": id,
                "slot": slot,
                "stateLen": state::STATE_LEN,
                "room": room.public(&code),
            });
            let _ = tx.send(Message::Text(hello.to_string().into()));
            room.announce();
        }
    }

    loop {
        tokio::select! {
            queued = rx.recv() => {
                match queued {
                    Some(frame) => {
                        if socket.send(frame).await.is_err() {
                            break;
                        }
                    }
                    None => break,
                }
            }
            incoming = socket.recv() => {
                match incoming {
                    Some(Ok(Message::Binary(raw))) => {
                        if let Some(input) = decode_input(&raw) {
                            let mut rooms = hub.rooms.lock().expect("hub empoisonne");
                            if let Some(room) = rooms.get_mut(&code) {
                                room.game.set_input(slot, input);
                                if let Some(seat) = room.seats[slot].as_mut() {
                                    seat.idle = 0.0;
                                }
                            }
                        }
                    }
                    Some(Ok(Message::Text(text))) => {
                        let mut rooms = hub.rooms.lock().expect("hub empoisonne");
                        if let Some(room) = rooms.get_mut(&code) {
                            if handle_text(room, id, &text) {
                                room.announce();
                            }
                        }
                    }
                    Some(Ok(_)) => {}
                    _ => break,
                }
            }
        }
    }

    // Depart : on libere le siege et on repasse la main si l'hote s'en va.
    let mut rooms = hub.rooms.lock().expect("hub empoisonne");
    if let Some(room) = rooms.get_mut(&code) {
        room.seats[slot] = None;
        room.game.set_input(slot, Input::default());
        if room.host == id {
            room.host = room.seats.iter().flatten().map(|s| s.id).next().unwrap_or(0);
        }
        room.announce();
    }
}

/// `[gaz, frein, direction, drapeaux]` en `f32` little endian.
fn decode_input(raw: &[u8]) -> Option<Input> {
    if raw.len() < 16 {
        return None;
    }
    let f = |i: usize| {
        let mut b = [0u8; 4];
        b.copy_from_slice(&raw[i * 4..i * 4 + 4]);
        f32::from_le_bytes(b)
    };
    // Les valeurs viennent du reseau : on les borne avant de les confier au
    // moteur, un client bricole peut envoyer n'importe quoi.
    let flags = f(3);
    if !flags.is_finite() {
        return None;
    }
    let flags = flags as u32;
    let axis = |v: f32, lo: f32| if v.is_finite() { v.clamp(lo, 1.0) } else { 0.0 };
    Some(Input {
        throttle: axis(f(0), 0.0),
        brake: axis(f(1), 0.0),
        steer: axis(f(2), -1.0),
        boost: flags & 1 != 0,
        drift: flags & 2 != 0,
    })
}

/// Renvoie `true` quand la composition du salon a change.
fn handle_text(room: &mut Room, id: u32, text: &str) -> bool {
    let msg: Value = match serde_json::from_str(text) {
        Ok(v) => v,
        Err(_) => return false,
    };
    match msg.get("t").and_then(Value::as_str) {
        Some("start") if room.host == id => {
            room.game.begin();
            true
        }
        _ => false,
    }
}
