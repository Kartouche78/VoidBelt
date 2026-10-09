//! Une course contre la montre : depart, checkpoints, arrivee.
//!
//! Au sol, la voiture roule dans le plan deplie de la piste (x = decalage
//! lateral, z = abscisse). A chaque pas, on corrige ce plan pour la courbure
//! de la route : la distance parcourue a l'interieur d'un virage est plus
//! courte, et le repere tourne sous la voiture, qui doit donc braquer pour
//! suivre. Au-dessus d'un trou du trace, elle vole (vol.rs).
//!
//! Pas fixe de 1/120 s, independant du framerate ; le rendu interpole entre
//! les deux derniers pas, et la camera tourne sur cette pose interpolee.

use crate::boite::{self, Boite, Entree};
use crate::camera::Camera;
use crate::classique;
use crate::car::{Car, CarEvent, Contact, Input};
use crate::mur::Mur;
use crate::state::Pose;
use crate::surface::profil;
use crate::suspension::Suspension;
use crate::track::{Track, WALL};
use crate::tune::{Tuning, TUNING};
use crate::vol::{Issue, Vol};

pub const DT: f32 = 1.0 / 120.0;
pub const COUNTDOWN: f32 = 3.0;
/// La voiture attend derriere la ligne de depart.
const GRID: f32 = 22.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Phase {
    Countdown = 0,
    Running = 1,
    Finished = 2,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Event {
    /// Chiffre du compte a rebours qui s'affiche (3, 2, 1).
    Count(u32),
    Go,
    /// Checkpoint franchi : index, chrono.
    Checkpoint(u32, f32),
    Finish(f32),
    Boost,
    /// Drift termine, points valides.
    Bank(u32),
    /// Nouvel impact contre un muret, vitesse normale (m/s).
    Wall(f32),
    Respawn,
    /// La voiture quitte la piste au-dessus d'un trou.
    Decollage,
    /// Reception : vitesse verticale absorbee (m/s), travers (0..1).
    Reception(f32, f32),
}

/// Ce qu'on retrouve en revenant au dernier checkpoint.
#[derive(Clone, Copy, Debug)]
struct Save {
    s: f32,
    speed: f32,
    boost: f32,
    score: u32,
}

pub struct Game {
    pub track: Track,
    pub tune: Tuning,
    pub car: Car,
    pub vol: Option<Vol>,
    pub mur: Mur,
    pub susp: Suspension,
    pub cam: Camera,
    pub boite: Boite,
    pub phase: Phase,
    pub countdown: f32,
    pub time: f32,
    pub next_cp: usize,
    pub cp_times: Vec<f32>,
    pub input: Input,
    pub events: Vec<Event>,
    pub wall_hit: f32,
    /// Gameplay classique (F1) : la conduite d'avant la refonte Stadium Car.
    pub classique: bool,
    save: Save,
    acc: f32,
    pub prev: Pose,
    pub cur: Pose,
}

impl Game {
    pub fn new(track: Track) -> Game {
        let mut g = Game {
            track,
            tune: TUNING,
            car: Car::new(),
            vol: None,
            mur: Mur::default(),
            susp: Suspension::default(),
            cam: Camera::new(),
            boite: Boite::new(boite::RAPTOR, boite::vitesse_de_pointe(&TUNING)),
            phase: Phase::Countdown,
            countdown: COUNTDOWN,
            time: 0.0,
            next_cp: 0,
            cp_times: vec![],
            input: Input::default(),
            events: vec![],
            wall_hit: 0.0,
            classique: false,
            save: Save { s: 0.0, speed: 0.0, boost: 0.0, score: 0 },
            acc: 0.0,
            prev: Pose::default(),
            cur: Pose::default(),
        };
        g.restart();
        g
    }

    /// Remet tout a zero : grille de depart, compte a rebours.
    pub fn restart(&mut self) {
        let s = self.track.start_line - GRID;
        self.car.reset(0.0, s, 0.0);
        self.phase = Phase::Countdown;
        self.countdown = COUNTDOWN;
        self.time = 0.0;
        self.next_cp = 0;
        self.cp_times.clear();
        self.save = Save { s, speed: 0.0, boost: 0.0, score: 0 };
        self.boite.rapport = 0;
        self.events.push(Event::Count(3));
        self.place();
    }

    /// Retour au dernier checkpoint, avec la vitesse qu'on y avait.
    pub fn respawn(&mut self) {
        if self.phase != Phase::Running {
            return;
        }
        let sv = self.save;
        self.car.reset(0.0, sv.s, 0.0);
        self.car.vz = sv.speed;
        self.car.vf = sv.speed;
        self.car.speed = sv.speed;
        self.car.boost = sv.boost;
        self.car.score = sv.score;
        self.events.push(Event::Respawn);
        self.place();
    }

    /// Debogage : pose la voiture en `s`, lancee a `speed` m/s, course en
    /// cours (les checkpoints deja passes sont comptes comme franchis).
    pub fn seek(&mut self, s: f32, speed: f32) {
        self.car.reset(0.0, s.clamp(0.0, self.track.len - 10.0), 0.0);
        self.car.vz = speed;
        self.car.speed = speed;
        self.car.vf = speed;
        self.phase = Phase::Running;
        self.next_cp = self.track.checkpoints.iter().filter(|&&c| c < s).count();
        self.cp_times = vec![0.0; self.next_cp];
        self.place();
    }

    /// Recale vol, murs, suspension, camera et interpolation apres une
    /// teleportation.
    fn place(&mut self) {
        self.vol = None;
        self.mur = Mur::default();
        self.susp = Suspension::default();
        self.cam.snap();
        self.cur = Pose::of(self);
        self.prev = self.cur;
        self.acc = 0.0;
    }

    /// Avance d'une image de rendu ; renvoie la part du pas courant ecoulee,
    /// pour interpoler.
    pub fn advance(&mut self, frame_dt: f32) -> f32 {
        self.acc += frame_dt.clamp(0.0, 0.1);
        while self.acc >= DT {
            self.acc -= DT;
            self.prev = self.cur;
            self.tick();
            self.cur = Pose::of(self);
        }
        self.acc / DT
    }

    /// Pose interpolee de l'image en cours.
    pub fn pose(&self, alpha: f32) -> Pose {
        self.prev.lerp(&self.cur, alpha)
    }

    pub fn tick(&mut self) {
        let h = DT;
        // l'etagement suit la voiture, meme si les reglages changent en route
        self.boite.v_max = if self.classique {
            crate::car::PLAFOND
        } else {
            boite::vitesse_de_pointe(&self.tune)
        };
        match self.phase {
            Phase::Countdown => {
                let before = self.countdown.ceil() as u32;
                self.countdown -= h;
                let after = self.countdown.ceil() as u32;
                if self.countdown <= 0.0 {
                    self.phase = Phase::Running;
                    self.events.push(Event::Go);
                } else if after != before {
                    self.events.push(Event::Count(after));
                }
                let e = Entree { gaz: self.input.throttle, point_mort: true, ..Entree::default() };
                self.boite.maj(e, h);
                return;
            }
            Phase::Running => self.time += h,
            Phase::Finished => {}
        }

        let inp = if self.phase == Phase::Finished {
            Input { brake: 0.4, ..Input::default() }
        } else {
            self.input
        };

        if self.vol.is_some() {
            self.en_vol(h, inp);
        } else {
            self.au_sol(h, inp);
        }
        self.checkpoints();

        for e in self.car.events.drain(..) {
            self.events.push(match e {
                CarEvent::Boost => Event::Boost,
                CarEvent::Bank(p) => Event::Bank(p),
            });
        }
    }

    fn au_sol(&mut self, h: f32, inp: Input) {
        if self.classique {
            self.au_sol_classique(h, inp);
            return;
        }
        let s0 = self.car.z;
        let (g_t, g_r) = self.track.gravite(s0, self.tune.gravite);
        let contact = Contact {
            g_t,
            g_r,
            sol: profil(self.track.sol_at(s0)),
            coupure: if self.boite.coupure { self.tune.coupure_passage } else { 0.0 },
        };
        self.car.update_sur(h, inp, &self.tune, &contact);
        let glisse = if self.car.sliding { self.car.vl.abs() } else { 0.0 };
        let e = Entree { vitesse: self.car.vf, gaz: inp.throttle, frein: inp.brake, glisse, point_mort: false, boost: self.car.boosting };
        self.boite.maj(e, h);
        self.follow_track(s0);

        self.wall_hit = 0.0;
        if let Some(i) = self.mur.resoudre(&mut self.car, &self.tune, h, WALL) {
            self.wall_hit = i.normale;
            if i.normale > 2.0 {
                self.events.push(Event::Wall(i.normale));
                self.cam.choc(i.severite, &self.tune);
            }
        }
        self.bornes();
        self.susp.pas(h, &self.tune, self.car.accel, self.car.forces.laterale, true);

        // plus de route sous les roues : la voiture vole
        if self.track.dans_trou(self.car.z) {
            let f = self.track.frame_at(self.car.z);
            self.vol = Some(Vol::decolle(&self.car, &f));
            self.events.push(Event::Decollage);
        }
    }

    /// Le gameplay d'avant la refonte : sa conduite et ses murets, sans
    /// gravite le long de la piste. Vol, boite et camera restent communs.
    fn au_sol_classique(&mut self, h: f32, inp: Input) {
        let s0 = self.car.z;
        let r = &classique::REGLAGES;
        classique::pas(&mut self.car, h, inp, r);
        let glisse = if self.car.sliding { self.car.vl.abs() } else { 0.0 };
        let e = Entree { vitesse: self.car.vf, gaz: inp.throttle, frein: inp.brake, glisse, point_mort: false, boost: self.car.boosting };
        self.boite.maj(e, h);
        self.follow_track(s0);
        let (sortie, choc) = classique::murs(&mut self.car, h, WALL, r);
        self.wall_hit = sortie;
        if let Some(v) = choc {
            self.events.push(Event::Wall(v));
            self.cam.choc((v / 20.0).min(1.0), &self.tune);
        }
        self.bornes();
        self.susp.pas(h, &self.tune, self.car.accel, -self.car.vl * 3.0, true);
        if self.track.dans_trou(self.car.z) {
            let f = self.track.frame_at(self.car.z);
            self.vol = Some(Vol::decolle(&self.car, &f));
            self.events.push(Event::Decollage);
        }
    }

    fn en_vol(&mut self, h: f32, inp: Input) {
        let Some(mut v) = self.vol else { return };
        let issue = v.step(h, inp, &self.tune, &self.track);
        self.car.z = v.s;
        self.car.x = v.lat;
        self.car.speed = v.vel.len();
        self.susp.pas(h, &self.tune, 0.0, 0.0, false);
        let e = Entree { vitesse: self.car.speed, gaz: inp.throttle, point_mort: false, ..Entree::default() };
        self.boite.maj(e, h);
        match issue {
            Issue::EnVol => self.vol = Some(v),
            Issue::Reception { normale, travers } => {
                let f = self.track.frame_at(v.s);
                v.pose(&mut self.car, &f, self.tune.reception_perte * travers);
                self.vol = None;
                self.susp.reception(normale, &self.tune);
                self.events.push(Event::Reception(normale, travers));
            }
            Issue::Chute => {
                self.vol = None;
                if self.phase == Phase::Running {
                    self.respawn();
                } else {
                    // course finie : la voiture attend sur la ligne
                    self.car.reset(0.0, self.track.finish(), 0.0);
                    self.place();
                }
            }
        }
    }

    /// Corrige le pas que la voiture vient de faire dans le plan deplie.
    fn follow_track(&mut self, s0: f32) {
        let k = self.track.kappa_at(s0);
        let dz = self.car.z - s0;
        // a `x` m a droite du milieu, un metre de trace en vaut (1 - k x)
        let ds = dz / (1.0 - k * self.car.x).max(0.3);
        self.car.z = s0 + ds;
        self.car.rotate_frame(k * ds);
    }

    /// Pas de marche arriere au-dela de la grille, ni au-dela de la fin.
    fn bornes(&mut self) {
        let c = &mut self.car;
        let back = self.track.start_line - GRID - 8.0;
        if c.z < back {
            c.z = back;
            c.vz = c.vz.max(0.0);
        }
        let end = self.track.len - 6.0;
        if c.z > end {
            c.z = end;
            c.vz = c.vz.min(0.0);
        }
    }

    fn checkpoints(&mut self) {
        if self.phase != Phase::Running {
            return;
        }
        let cps = &self.track.checkpoints;
        while self.next_cp < cps.len() && self.car.z >= cps[self.next_cp] {
            let i = self.next_cp;
            self.cp_times.push(self.time);
            self.next_cp += 1;
            if self.next_cp == cps.len() {
                self.phase = Phase::Finished;
                self.events.push(Event::Finish(self.time));
            } else {
                self.events.push(Event::Checkpoint(i as u32, self.time));
                self.save = Save {
                    s: cps[i],
                    speed: self.car.vf.max(0.0),
                    boost: self.car.boost,
                    score: self.car.score,
                };
            }
        }
    }
}

#[cfg(test)]
impl Game {
    pub fn save_speed(&self) -> f32 {
        self.save.speed
    }
}
