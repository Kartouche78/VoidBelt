//! Un salon RL2 : la partie, ses sieges et la diffusion de l'etat.
//!
//! Rien ne borne l'effectif. Les sieges sont une liste qui s'allonge, et la
//! partie est refaite sur la composition courante des qu'elle bouge — mais
//! seulement au salon : renumeroter les voitures en plein match echangerait
//! celles des joueurs restants.

use serde_json::{Value, json};
use tokio::sync::mpsc::UnboundedSender;
use voidbelt_rl2::{
    car::Input,
    tune::Tune,
    game::{CARS, Game, Phase},
    state,
};
use axum::extract::ws::Message;

/// Effectif d'un salon vide : deux voitures, le temps que quelqu'un arrive.
pub const IDLE_CARS: usize = CARS;
const MATCH_SECONDS: f32 = 300.0;
/// Delai avant de renvoyer tout le monde au salon, match termine.
const REMATCH_AFTER: f32 = 8.0;
/// Sans nouvelle commande pendant ce delai, on relache les gaz du joueur.
/// Un onglet passe en arriere-plan cesse d'emettre : sans ca sa voiture
/// continuerait tout droit sur sa derniere consigne.
const INPUT_GRACE: f32 = 0.6;

pub struct Seat {
    pub id: u32,
    pub name: String,
    /// Camp choisi : 0 bleu, 1 orange. Modifiable tant qu'on est au salon.
    pub team: u8,
    /// Temps ecoule depuis la derniere commande recue.
    pub idle: f32,
    pub tx: UnboundedSender<Message>,
}

pub struct Room {
    pub code: String,
    pub game: Game,
    /// Un trou reste en place le temps d'un match : renumeroter les sieges
    /// en pleine partie echangerait les voitures des joueurs restants.
    pub seats: Vec<Option<Seat>>,
    pub host: u32,
    pub over_for: f32,
    pub empty_for: f32,
    pub seed: u32,
    /// Reglages a appliquer au prochain echauffement.
    pub tune: Tune,
    /// Tampons reutilises : a 60 Hz, mieux vaut ne rien allouer par image.
    pub floats: Vec<f32>,
    pub events: Vec<f32>,
    pub bytes: Vec<u8>,
}

impl Room {
    pub fn new(code: String, seed: u32) -> Room {
        Room {
            code,
            game: Game::warmup(seed, MATCH_SECONDS),
            seats: Vec::new(),
            host: 0,
            over_for: 0.0,
            empty_for: 0.0,
            seed,
            tune: Tune::default(),
            floats: vec![0.0; state::state_len(IDLE_CARS)],
            events: Vec::with_capacity(64),
            bytes: Vec::with_capacity(state::state_len(IDLE_CARS) * 8),
        }
    }

    pub fn taken(&self) -> usize {
        self.seats.iter().filter(|s| s.is_some()).count()
    }

    /// Camp le moins fourni : un arrivant y atterrit par defaut, quitte a
    /// changer ensuite. Sans ca tout le monde s'empilerait cote bleu.
    pub fn lighter_team(&self) -> u8 {
        let mut n = [0usize; 2];
        for s in self.seats.iter().flatten() {
            n[(s.team & 1) as usize] += 1;
        }
        u8::from(n[1] < n[0])
    }

    /// Installe un joueur et renvoie son siege. Un trou libre est repris,
    /// sinon le salon s'agrandit : il n'y a pas de plafond.
    pub fn seat(&mut self, seat: Seat) -> usize {
        let slot = match self.seats.iter().position(|s| s.is_none()) {
            Some(i) => {
                self.seats[i] = Some(seat);
                i
            }
            None => {
                self.seats.push(Some(seat));
                self.seats.len() - 1
            }
        };
        self.resync();
        slot
    }

    /// Adopte de nouveaux reglages. Une partie en cours les garde pour le
    /// prochain echauffement : changer la physique en pleine action
    /// deplacerait les voitures sous les joueurs.
    pub fn set_tune(&mut self, t: Tune) {
        self.tune = t;
        if self.game.phase == Phase::Warmup {
            self.game.tune = t;
        }
    }

    /// Refait la partie sur la composition courante. Uniquement au salon :
    /// en plein match, changer l'effectif deplacerait toutes les voitures.
    pub fn resync(&mut self) {
        if self.game.phase != Phase::Warmup {
            return;
        }
        while matches!(self.seats.last(), Some(None)) {
            self.seats.pop();
        }
        let teams: Vec<u8> = self
            .seats
            .iter()
            .map(|s| s.as_ref().map_or(0, |s| s.team & 1))
            .collect();
        self.game = Game::warmup_with(self.seed, MATCH_SECONDS, &teams);
        self.game.tune = self.tune;
        self.floats = vec![0.0; state::state_len(self.game.cars.len())];
    }

    pub fn step(&mut self, dt: f32) {
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
    pub fn broadcast_state(&mut self) {
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

    pub fn public(&self, code: &str) -> Value {
        let players: Vec<Value> = self
            .seats
            .iter()
            .enumerate()
            .filter_map(|(slot, s)| {
                s.as_ref().map(|s| {
                    json!({ "id": s.id, "name": s.name, "slot": slot, "team": s.team })
                })
            })
            .collect();
        json!({
            "code": code,
            "host": self.host,
            "phase": phase_name(self.game.phase),
            "cars": self.game.cars.len(),
            "players": players,
        })
    }

    /// Previent tout le monde que la composition ou la phase a bouge.
    pub fn announce(&self) {
        let msg = json!({ "t": "room", "room": self.public(&self.code) }).to_string();
        let frame = Message::Text(msg.into());
        for seat in self.seats.iter().flatten() {
            let _ = seat.tx.send(frame.clone());
        }
    }
}

pub fn phase_name(p: Phase) -> &'static str {
    match p {
        Phase::Warmup => "warmup",
        Phase::Countdown => "countdown",
        Phase::Play => "play",
        Phase::Goal => "goal",
        Phase::Over => "over",
    }
}
