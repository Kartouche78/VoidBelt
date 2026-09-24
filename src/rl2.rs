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
        ConnectInfo, Query, State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    http::StatusCode,
    response::{IntoResponse, Response},
};
use std::net::SocketAddr;
mod room;

use room::{IDLE_CARS, Room, Seat};
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
use tokio::sync::mpsc::unbounded_channel;
use voidbelt_rl2::{
    car::Input,
    state,
    tune::{self, Tune},
};

const TICK: Duration = Duration::from_millis(16);
/// Au-dela, un salon vide est oublie.
const EMPTY_GRACE: f32 = 20.0;


pub struct Hub {
    rooms: Mutex<HashMap<String, Room>>,
    next_id: AtomicU32,
    /// Reglages partages par tous les salons. `/admin` les remplace a chaud ;
    /// ils sont relus au demarrage depuis `public/rl2/assets/tune.json`, pour
    /// qu'un reglage publie survive a un redemarrage du serveur.
    tune: Mutex<Tune>,
}

/// Ou l'on garde les reglages publies. Le fichier est aussi servi au
/// navigateur, qui s'en sert pour le solo : une seule source pour les deux.
const TUNE_FILE: &str = "public/rl2/assets/tune.json";

/// Relit les reglages publies, s'il y en a. Un fichier absent ou abime
/// laisse simplement les valeurs d'usine.
fn load_tune() -> Tune {
    let mut t = Tune::default();
    let Ok(text) = std::fs::read_to_string(TUNE_FILE) else {
        return t;
    };
    let Ok(v) = serde_json::from_str::<Value>(&text) else {
        return t;
    };
    apply_json(&mut t, &v);
    t
}

/// Applique un objet `{ nom: valeur }` aux reglages. On passe par les noms
/// et non par les positions : un fichier ecrit avant l'ajout d'un reglage
/// reste lisible, et un nom inconnu est ignore au lieu de tout decaler.
fn apply_json(t: &mut Tune, v: &Value) -> usize {
    let Some(obj) = v.as_object() else { return 0 };
    let mut flat = t.to_vec();
    let mut n = 0;
    for (i, key) in tune::KEYS.iter().enumerate() {
        if let Some(x) = obj.get(*key).and_then(Value::as_f64) {
            if x.is_finite() {
                flat[i] = x as f32;
                n += 1;
            }
        }
    }
    t.read(&flat);
    n
}

/// Les reglages en cours, sous forme d'objet nomme.
fn tune_json(t: &Tune) -> Value {
    let flat = t.to_vec();
    let mut obj = serde_json::Map::new();
    for (i, key) in tune::KEYS.iter().enumerate() {
        obj.insert((*key).to_string(), json!(flat[i]));
    }
    Value::Object(obj)
}

impl Hub {
    /// Cree le hub et lance sa boucle de simulation. A appeler dans le
    /// runtime tokio du serveur.
    pub fn new() -> Arc<Hub> {
        let hub = Arc::new(Hub {
            rooms: Mutex::new(HashMap::new()),
            next_id: AtomicU32::new(1),
            tune: Mutex::new(load_tune()),
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
    /// Skin de voiture du joueur, tel que le catalogue le nomme.
    #[serde(default)]
    pub skin: String,
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

/// Reglages en cours, avec l'ordre officiel des noms. Le jeu les charge au
/// demarrage : solo et parties en ligne tournent ainsi sur les memes valeurs.
pub async fn tune_get(State(hub): State<Arc<Hub>>) -> Json<Value> {
    let t = *hub.tune.lock().expect("hub empoisonne");
    Json(json!({ "keys": tune::KEYS, "values": tune_json(&t) }))
}

/// Publie de nouveaux reglages. Ils s'appliquent aussitot aux salons a
/// l'echauffement et sont ecrits sur disque pour survivre a un redemarrage.
///
/// Reserve a la machine qui heberge le serveur, sauf jeton explicite : sans
/// cela, n'importe quel visiteur du tunnel public pourrait changer la
/// physique de tout le monde.
pub async fn tune_put(
    State(hub): State<Arc<Hub>>,
    headers: axum::http::HeaderMap,
    info: axum::extract::ConnectInfo<SocketAddr>,
    Json(body): Json<Value>,
) -> (StatusCode, Json<Value>) {
    if !allowed(&headers, info.0) {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "Reglages reserves a l'hote du serveur." })),
        );
    }
    let mut t = hub.tune.lock().expect("hub empoisonne");
    let n = apply_json(&mut t, &body);
    let saved = *t;
    drop(t);

    // Les salons deja lances gardent leurs reglages jusqu'au prochain
    // echauffement : changer la physique en pleine action serait brutal.
    {
        let mut rooms = hub.rooms.lock().expect("hub empoisonne");
        for room in rooms.values_mut() {
            room.set_tune(saved);
        }
    }
    let text = serde_json::to_string_pretty(&tune_json(&saved)).unwrap_or_default();
    let ecrit = std::fs::write(TUNE_FILE, text).is_ok();
    (
        StatusCode::OK,
        Json(json!({ "applied": n, "saved": ecrit, "values": tune_json(&saved) })),
    )
}

/// Vrai si la requete peut agir en admin : un compte admin connecte avec
/// Google, le jeton du serveur, ou la machine hote elle-meme.
///
/// Une requete relayee par un proxy (nginx sur le VPS) arrive elle aussi de
/// `127.0.0.1` : l'adresse ne prouve alors plus rien. Des qu'elle porte un
/// en-tete de relais, seuls la session et le jeton ouvrent la porte.
pub(crate) fn allowed(headers: &axum::http::HeaderMap, who: SocketAddr) -> bool {
    // La voie normale : un compte admin connecte avec Google (`admin2`).
    if admin2::est_admin(headers) {
        return true;
    }
    // En secours, pour des scripts : le jeton du serveur.
    if let Ok(expected) = std::env::var("RL2_ADMIN_TOKEN") {
        if !expected.is_empty() {
            let given = headers
                .get("x-admin-token")
                .and_then(|v| v.to_str().ok())
                .unwrap_or("");
            return given == expected;
        }
    }
    admin2::machine_hote(headers, who)
}

/// Entree dans un salon. Il faut un compte : sans session, la connexion est
/// refusee avant meme d'ouvrir la liaison. Le nom affiche est le pseudo du
/// compte, pas ce que le navigateur pretend. Seule la machine du serveur
/// joue sans compte, pour les essais en local.
pub async fn ws(
    upgrade: WebSocketUpgrade,
    headers: axum::http::HeaderMap,
    ConnectInfo(who): ConnectInfo<SocketAddr>,
    Query(mut params): Query<JoinParams>,
    State(hub): State<Arc<Hub>>,
) -> Response {
    match admin2::compte_de(&headers) {
        Some(c) => {
            let nom = if c.pseudo.is_empty() { &c.nom } else { &c.pseudo };
            if !nom.is_empty() {
                params.name = nom.clone();
            }
        }
        None if admin2::machine_hote(&headers, who) => {}
        None => {
            return (StatusCode::UNAUTHORIZED, "Connecte-toi pour jouer en ligne.").into_response();
        }
    }
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
    // Un identifiant de skin, rien d'autre : il repart vers tous les joueurs
    // du salon, qui le cherchent dans le catalogue.
    let skin: String = params
        .skin
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
        .take(40)
        .collect();

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
                Some(room) => {
                    // Aucun refus possible : le salon s'agrandit.
                    let team = room.lighter_team();
                    let slot = room.seat(Seat {
                        id,
                        name: name.clone(),
                        team,
                        idle: 0.0,
                        tx: tx.clone(),
                        chats: Vec::new(),
                        skin: skin.clone(),
                    });
                    Ok((wanted, slot))
                }
            }
        } else {
            let mut code = make_code(id);
            while rooms.contains_key(&code) {
                code = make_code(id.wrapping_add(rooms.len() as u32 + 1));
            }
            let mut room = Room::new(code.clone(), id);
            room.host = id;
            let slot = room.seat(Seat {
                id,
                name: name.clone(),
                team: 0,
                idle: 0.0,
                tx: tx.clone(),
                chats: Vec::new(),
                skin: skin.clone(),
            });
            rooms.insert(code.clone(), room);
            Ok((code, slot))
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
                // L'effectif bouge quand on rejoint : le client le relit dans
                // l'entete de chaque image plutot que de s'en tenir a ceci.
                "stateLen": state::state_len(IDLE_CARS),
                "carBase": state::CAR_BASE,
                "carStride": state::CAR_STRIDE,
                "carCount": state::CAR_COUNT,
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
        // Au salon, le depart libere vraiment la place ; en plein match la
        // voiture reste, immobile, jusqu'au retour au salon.
        room.resync();
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
        // Stade du salon, reserve a l'hote : tout le monde doit voir le
        // meme terrain, et son arrondi de coins compte dans les rebonds.
        Some("stadium") if room.host == id => {
            let Some(nom) = msg.get("id").and_then(Value::as_str) else {
                return false;
            };
            let nombre = |cle: &str, defaut: f32| {
                msg.get(cle).and_then(Value::as_f64).map_or(defaut, |v| v as f32)
            };
            let corner = nombre("corner", f32::NAN);
            // Un client d'avant F6 n'envoie pas de cage : celle d'usine.
            let usine = voidbelt_rl2::arena::Cage::FACTORY;
            let cage = voidbelt_rl2::arena::Cage::new(
                nombre("goal_half", usine.half),
                nombre("goal_depth", usine.depth),
                nombre("post_r", usine.post),
            );
            room.set_stadium(nom, corner, cage)
        }
        // Tchat rapide. On ne transporte que deux directions, jamais du
        // texte libre : le libelle vit chez le client, et un salon ne peut
        // donc pas servir a diffuser n'importe quoi a n'importe qui.
        Some("chat") => {
            let dir = |cle| {
                msg.get(cle)
                    .and_then(Value::as_str)
                    .filter(|d| matches!(*d, "up" | "down" | "left" | "right"))
                    .map(str::to_string)
            };
            let (Some(g), Some(m)) = (dir("g"), dir("m")) else {
                return false;
            };
            // Le siege dit au-dessus de quelle voiture poser la bulle.
            let Some(slot) = room
                .seats
                .iter()
                .position(|s| s.as_ref().is_some_and(|s| s.id == id))
            else {
                return false;
            };
            let Some(seat) = room.seats[slot].as_mut() else {
                return false;
            };
            // Au-dela de deux messages en dix secondes, on se tait.
            if !seat.may_chat(std::time::Instant::now()) {
                return false;
            }
            let (from, team) = (seat.name.clone(), seat.team);
            room.shout(
                json!({ "t": "chat", "from": from, "slot": slot, "team": team, "g": g, "m": m })
                    .to_string(),
            );
            // Deja diffuse : inutile de renvoyer la composition derriere.
            false
        }
        // Chacun choisit son camp, librement : rien n'impose d'equilibre, et
        // la partie se refait aussitot pour replacer tout le monde.
        Some("team") => {
            let Some(team) = msg.get("team").and_then(Value::as_u64) else {
                return false;
            };
            let team = (team & 1) as u8;
            let Some(seat) = room
                .seats
                .iter_mut()
                .flatten()
                .find(|s| s.id == id)
            else {
                return false;
            };
            if seat.team == team {
                return false;
            }
            seat.team = team;
            // En plein match on enregistre le choix pour le prochain salon,
            // sans deplacer les voitures en cours de jeu.
            room.resync();
            true
        }
        _ => false,
    }
}
