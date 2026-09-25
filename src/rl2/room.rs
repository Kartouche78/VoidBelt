//! Un salon RL2 : la partie, ses sieges et la diffusion de l'etat.
//!
//! Rien ne borne l'effectif. Les sieges sont une liste qui s'allonge, et la
//! partie est refaite sur la composition courante des qu'elle bouge — mais
//! seulement au salon : renumeroter les voitures en plein match echangerait
//! celles des joueurs restants.

use serde_json::{Value, json};
use tokio::sync::mpsc::UnboundedSender;
use voidbelt_rl2::{
    arena::Cage,
    car::Input,
    tune::Tune,
    game::{CARS, Game, Phase},
    state,
};
use axum::extract::ws::Message;
use std::time::{Duration, Instant};

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
    /// Instants des derniers messages rapides, pour borner le flood.
    pub chats: Vec<Instant>,
    /// Skin de voiture choisi (`car-...`), vide pour la livree du camp.
    pub skin: String,
    /// Couleur du clan (`#rrggbb`), vide sans clan : la voiture et
    /// l'etiquette prennent alors la couleur de l'equipe.
    pub couleur: String,
    /// Compte du joueur connecte : son groupe joue dans la meme equipe.
    pub compte: Option<i64>,
}

/// Messages rapides permis par fenetre glissante : deux toutes les dix
/// secondes. Le client applique la meme regle ; le serveur la tient aussi,
/// sans quoi un client modifie inonderait le salon.
pub const CHAT_MAX: usize = 2;
pub const CHAT_WINDOW: Duration = Duration::from_secs(10);

impl Seat {
    /// Vrai si ce joueur peut encore parler, et note le message le cas
    /// echeant.
    pub fn may_chat(&mut self, now: Instant) -> bool {
        self.chats.retain(|t| now.duration_since(*t) < CHAT_WINDOW);
        if self.chats.len() >= CHAT_MAX {
            return false;
        }
        self.chats.push(now);
        true
    }
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
    /// Stade choisi par l'hote. Le decor ne regarde que le navigateur, mais
    /// l'arrondi des coins, lui, est une donnee de collision : il vit donc
    /// dans les reglages du salon et c'est ce serveur qui l'arbitre.
    pub stadium: String,
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
            stadium: String::from("voidbelt"),
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

    /// Equipe d'un membre du groupe deja assis, s'il y en a un : le groupe
    /// joue ensemble.
    pub fn equipe_du_groupe(&self, groupe: &[i64]) -> Option<u8> {
        self.seats
            .iter()
            .flatten()
            .find(|s| s.compte.is_some_and(|c| groupe.contains(&c)))
            .map(|s| s.team & 1)
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
    /// Change le stade du salon. L'identifiant ne sert qu'a dire au
    /// navigateur quelle planche afficher ; l'arrondi et la cage, eux,
    /// entrent dans la physique, d'ou les bornes : un salon ne doit pas
    /// pouvoir se donner un terrain sans coins, sans milieu ou sans but.
    pub fn set_stadium(&mut self, id: &str, corner: f32, cage: Cage) -> bool {
        let propre: String = id
            .chars()
            .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
            .take(32)
            .collect();
        if propre.is_empty() || !corner.is_finite() {
            return false;
        }
        let corner = corner.clamp(10.0, 200.0);
        let cage = Cage::new(cage.half, cage.depth, cage.post);
        if propre == self.stadium
            && (corner - self.tune.arena_corner).abs() < 0.01
            && cage == self.tune.cage()
        {
            return false;
        }
        self.stadium = propre;
        for t in [&mut self.tune, &mut self.game.tune] {
            t.arena_corner = corner;
            t.goal_half = cage.half;
            t.goal_depth = cage.depth;
            t.post_r = cage.post;
        }
        true
    }

    /// Nouveaux reglages publies. Coins et cages appartiennent au stade du
    /// salon, pas au fichier : on les garde, sinon publier depuis /admin
    /// rendrait a tous les salons la forme du stade d'origine.
    pub fn set_tune(&mut self, mut t: Tune) {
        t.arena_corner = self.tune.arena_corner;
        t.goal_half = self.tune.goal_half;
        t.goal_depth = self.tune.goal_depth;
        t.post_r = self.tune.post_r;
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
                    json!({ "id": s.id, "name": s.name, "slot": slot, "team": s.team, "skin": s.skin, "couleur": s.couleur })
                })
            })
            .collect();
        json!({
            "code": code,
            "host": self.host,
            "phase": phase_name(self.game.phase),
            "cars": self.game.cars.len(),
            "stadium": self.stadium,
            "players": players,
        })
    }

    /// Envoie un texte deja compose a tous les sieges occupes.
    pub fn shout(&self, msg: String) {
        let frame = Message::Text(msg.into());
        for seat in self.seats.iter().flatten() {
            let _ = seat.tx.send(frame.clone());
        }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn un_groupe_rejoint_l_equipe_de_son_premier_membre() {
        let (tx, _rx) = tokio::sync::mpsc::unbounded_channel();
        let mut room = Room::new("1234".into(), 1);
        let assis = |compte, team| Seat {
            id: compte as u32,
            name: String::new(),
            team,
            idle: 0.0,
            tx: tx.clone(),
            chats: Vec::new(),
            skin: String::new(),
            couleur: String::new(),
            compte: Some(compte),
        };
        room.seat(assis(10, 1));
        room.seat(assis(20, 0));
        assert_eq!(room.equipe_du_groupe(&[10, 30]), Some(1));
        assert_eq!(room.equipe_du_groupe(&[20]), Some(0));
        assert_eq!(room.equipe_du_groupe(&[99]), None, "sans membre assis, l'equilibre decide");
        assert_eq!(room.equipe_du_groupe(&[]), None);
    }

    #[test]
    fn deux_messages_rapides_par_fenetre_de_dix_secondes() {
        let (tx, _rx) = tokio::sync::mpsc::unbounded_channel();
        let mut s = Seat {
            id: 1,
            name: String::new(),
            team: 0,
            idle: 0.0,
            tx,
            chats: Vec::new(),
            skin: String::new(),
            couleur: String::new(),
            compte: None,
        };
        let t0 = Instant::now();
        assert!(s.may_chat(t0));
        assert!(s.may_chat(t0 + Duration::from_secs(1)));
        assert!(!s.may_chat(t0 + Duration::from_secs(2)), "un troisieme message est passe");
        // Le premier sort de la fenetre a dix secondes pile.
        assert!(s.may_chat(t0 + Duration::from_secs(10)));
        assert!(!s.may_chat(t0 + Duration::from_secs(10)));
    }
}
