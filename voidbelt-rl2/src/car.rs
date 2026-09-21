//! Le modele de conduite, transpose de Rocket League a plat.
//!
//! Les constantes viennent des valeurs du jeu (uu/s) ramenees a l'echelle de
//! la planche : l'arene dessinee est plus courte qu'un vrai terrain, on garde
//! donc les rapports (accel / vitesse max, cout du boost) plutot que les
//! nombres bruts, et on resserre le braquage pour rester jouable.

use crate::arena;
use crate::vec::{wrap_angle, V2};

// Gabarit cale sur les planches `car_*.png`, au format 2:3 : la boite de
// collision a donc exactement les proportions de la voiture dessinee.
pub const HALF_LEN: f32 = 18.0;
pub const HALF_WID: f32 = 12.0;
/// Rayon du disque equivalent, utilise pour les contacts rapides.
pub const RADIUS: f32 = 15.0;
pub const MASS: f32 = 180.0;

pub const DRIVE_MAX: f32 = 380.0;
pub const SPEED_MAX: f32 = 620.0;
pub const SUPERSONIC: f32 = 592.0;
const THROTTLE_A: f32 = 431.0;
const BOOST_A: f32 = 267.0;
const BRAKE_A: f32 = 943.0;
const COAST_A: f32 = 141.0;

pub const BOOST_MAX: f32 = 100.0;
const BOOST_USE: f32 = 33.3;
pub const KICKOFF_BOOST: f32 = 33.0;

/// Courbures extremes : rayon de braquage a l'arret puis a pleine vitesse.
const TURN_SLOW: f32 = 1.0 / 55.0;
const TURN_FAST: f32 = 1.0 / 210.0;
const DRIFT_TURN: f32 = 1.85;
/// Amortissement de la vitesse laterale, par seconde. En appui la voiture
/// suit son nez en une cinquantaine de millisecondes ; en drift elle met
/// presque une demi-seconde, et c'est tout le glissement.
const GRIP: f32 = 18.0;
// La derive d'equilibre vaut a peu pres `vitesse de lacet / adherence` : 18
// donne les dix degres d'une voiture qui tient sa ligne, 6 le gros travers
// du powerslide. Descendre plus bas part en toupie.
const GRIP_DRIFT: f32 = 6.0;
/// Vitesse a laquelle le nez se realigne sur un muret longe, en rad/s.
const WALL_ALIGN: f32 = 6.0;

pub const DEMO_TIME: f32 = 3.0;
/// 90 km/h sur le compteur : au-dela, un contact demolit l'adversaire.
pub const DEMO_SPEED: f32 = 186.0;

#[derive(Clone, Copy, Default)]
pub struct Input {
    /// Gachette droite, 0..1.
    pub throttle: f32,
    /// Gachette gauche : freine puis enclenche la marche arriere.
    pub brake: f32,
    /// Stick horizontal, -1..1.
    pub steer: f32,
    pub boost: bool,
    pub drift: bool,
}

#[derive(Clone, Copy)]
pub struct Car {
    pub pos: V2,
    pub vel: V2,
    pub yaw: f32,
    pub boost: f32,
    pub team: u8,
    pub input: Input,
    pub drifting: bool,
    pub demo: f32,
    /// Chronometre de l'effet visuel de boost, lu par le rendu.
    pub flame: f32,
}

impl Car {
    pub fn new(team: u8) -> Car {
        let (pos, yaw) = arena::kickoff(team);
        Car {
            pos,
            vel: V2::ZERO,
            yaw,
            boost: KICKOFF_BOOST,
            team,
            input: Input::default(),
            drifting: false,
            demo: 0.0,
            flame: 0.0,
        }
    }

    pub fn reset(&mut self, pos: V2, yaw: f32, boost: f32) {
        self.pos = pos;
        self.vel = V2::ZERO;
        self.yaw = yaw;
        self.boost = boost;
        self.demo = 0.0;
        self.drifting = false;
        self.input = Input::default();
    }

    pub fn fwd(&self) -> V2 {
        V2::dir(self.yaw)
    }

    pub fn speed(&self) -> f32 {
        self.vel.len()
    }

    pub fn supersonic(&self) -> bool {
        self.demo <= 0.0 && self.speed() >= SUPERSONIC
    }

    /// Assez rapide pour detruire l'autre voiture au contact.
    pub fn lethal(&self) -> bool {
        self.demo <= 0.0 && self.speed() >= DEMO_SPEED
    }

    /// Angle entre le cap et la trajectoire reelle : c'est lui qu'on voit
    /// quand la voiture part en travers.
    ///
    /// Mesure faite par rapport au sens de marche, marche arriere comprise :
    /// sinon reculer donnerait une derive de 180 degres, qui n'a aucun sens
    /// et qui saturerait tout correcteur s'appuyant dessus.
    pub fn slip(&self) -> f32 {
        if self.speed() < 20.0 {
            return 0.0;
        }
        let a = wrap_angle(self.vel.angle() - self.yaw);
        if a.abs() > std::f32::consts::FRAC_PI_2 {
            wrap_angle(a - std::f32::consts::PI)
        } else {
            a
        }
    }

    /// Acceleration disponible a cette vitesse : pleine a l'arret, elle
    /// s'effondre en approchant du plafond sans boost.
    fn throttle_accel(v: f32) -> f32 {
        let n = (v / DRIVE_MAX).clamp(0.0, 1.0);
        if n >= 1.0 {
            0.0
        } else {
            THROTTLE_A * (1.0 - 0.9 * n)
        }
    }

    /// Courbure du virage : large a pleine vitesse, serree a l'arret.
    fn curvature(speed: f32, drift: bool) -> f32 {
        let n = (speed / SPEED_MAX).clamp(0.0, 1.0);
        let k = TURN_FAST + (TURN_SLOW - TURN_FAST) * (1.0 - n).powf(1.1);
        if drift {
            k * DRIFT_TURN
        } else {
            k
        }
    }

    pub fn step(&mut self, dt: f32) {
        if self.demo > 0.0 {
            self.demo -= dt;
            if self.demo <= 0.0 {
                let (p, a) = arena::respawn(self.team);
                self.reset(p, a, KICKOFF_BOOST);
            }
            return;
        }

        let inp = self.input;

        // Le cap tourne en premier, et la vitesse, elle, reste dans le repere
        // du monde : c'est cet ecart entre le nez et la trajectoire qui rend
        // le drift possible. Le corriger avant de tourner reviendrait a faire
        // pivoter la vitesse avec la voiture, donc a coller aux rails.
        let speed = self.speed();
        self.drifting = inp.drift && speed > 25.0;
        let heading = self.vel.dot(self.fwd());
        let k = Self::curvature(speed, self.drifting);
        self.yaw += inp.steer * k * heading * dt;

        let f = self.fwd();
        let t = f.perp();
        let mut vf = self.vel.dot(f);
        let mut vt = self.vel.dot(t);

        // Gachettes. Presser la gauche freine tant qu'on avance, puis
        // bascule en marche arriere une fois a l'arret, comme dans le jeu.
        let drive = inp.throttle - inp.brake;
        if drive.abs() > 0.02 {
            if vf * drive < -1.0 {
                vf += BRAKE_A * dt * drive.signum();
            } else {
                vf += Self::throttle_accel(vf.abs()) * dt * drive;
            }
        } else if vf.abs() > 1.0 {
            vf -= COAST_A * dt * vf.signum();
        } else {
            vf = 0.0;
        }

        self.flame = (self.flame - dt).max(0.0);
        let boosting = inp.boost && self.boost > 0.0;
        if boosting {
            vf += BOOST_A * dt;
            self.boost = (self.boost - BOOST_USE * dt).max(0.0);
            self.flame = 0.12;
        }

        // Plafond : le boost autorise le supersonique, sinon la vitesse
        // excedentaire retombe en roue libre au lieu d'etre coupee net.
        if boosting {
            vf = vf.min(SPEED_MAX);
        } else if vf > DRIVE_MAX {
            vf = (vf - COAST_A * dt).max(DRIVE_MAX);
        }
        vf = vf.max(-DRIVE_MAX * 0.45);

        let grip = if self.drifting { GRIP_DRIFT } else { GRIP };
        vt *= (-grip * dt).exp();

        self.vel = f.mul(vf).add(t.mul(vt)).clamp_len(SPEED_MAX);
        self.pos = self.pos.add(self.vel.mul(dt));

        if let Some(h) = arena::contact(self.pos, RADIUS) {
            self.ride(&h, dt);
        }
    }

    /// Contact avec l'enceinte. On ne rend pas la vitesse tangentielle et on
    /// pivote le nez vers le muret : la voiture le longe au lieu de rester
    /// plantee dessus, ce qui remplace la montee au mur du jeu d'origine.
    fn ride(&mut self, h: &arena::Hit, dt: f32) {
        arena::bounce(&mut self.pos, &mut self.vel, h, 0.05, 1.0);
        let t = h.n.perp();
        // On se range du cote ou l'on glisse deja ; nez pile perpendiculaire
        // au muret, la trajectoire tranche mieux que le cap, qui hesite.
        let cue = if self.speed() > 25.0 { self.vel } else { self.fwd() };
        let along = if cue.dot(t) >= 0.0 { t } else { t.mul(-1.0) };
        let err = wrap_angle(along.angle() - self.yaw);
        let rate = WALL_ALIGN * dt;
        self.yaw += err.clamp(-rate, rate);
    }

    /// Point du chassis le plus proche de `p` : la boite orientee rend les
    /// contacts du capot plus francs que ceux des flancs.
    pub fn nearest(&self, p: V2) -> V2 {
        let d = p.sub(self.pos);
        let f = self.fwd();
        let t = f.perp();
        let a = d.dot(f).clamp(-HALF_LEN, HALF_LEN);
        let b = d.dot(t).clamp(-HALF_WID, HALF_WID);
        self.pos.add(f.mul(a)).add(t.mul(b))
    }

    pub fn add_boost(&mut self, amount: f32) {
        self.boost = (self.boost + amount).min(BOOST_MAX);
    }

    /// La carcasse garde sa position : c'est la que l'hote fait exploser la
    /// voiture. Elle ne gene personne, tous les contacts ignorent une
    /// voiture demolie.
    pub fn demolish(&mut self) {
        self.demo = DEMO_TIME;
        self.vel = V2::ZERO;
    }
}
