//! Le modele de conduite, transpose de Rocket League a plat.
//!
//! Les constantes viennent des valeurs du jeu (uu/s) ramenees a l'echelle de
//! la planche : l'arene dessinee est plus courte qu'un vrai terrain, on garde
//! donc les rapports (accel / vitesse max, cout du boost) plutot que les
//! nombres bruts, et on resserre le braquage pour rester jouable.

use crate::arena;
use crate::tune::Tune;
use crate::vec::{wrap_angle, V2};

// Gabarit cale sur les planches `car_*.png`, au format 2:3 : la boite de
// collision a donc exactement les proportions de la voiture dessinee.
// Les trois cotes portent le meme demi pour cent de plus que la mesure
// d'origine (15.91 / 11.35 / 13.63) : la voiture grossit sans se deformer.
pub const HALF_LEN: f32 = 15.99;
pub const HALF_WID: f32 = 11.41;
/// Rayon du disque equivalent, utilise pour les contacts rapides.
pub const RADIUS: f32 = 13.70;
pub const MASS: f32 = 180.0;

pub const DRIVE_MAX: f32 = 380.0;
pub const SPEED_MAX: f32 = 620.0;
/// Seuil du supersonique. Rocket League le place a 95,7 % du plafond, soit
/// 592 chez nous ; on descend a 90 %, sinon il demande la moitie du terrain
/// rien que pour etre atteint et ne se voit presque jamais.
pub const SUPERSONIC: f32 = 558.0;
pub const THROTTLE_A: f32 = 431.0;
pub const BOOST_A: f32 = 267.0;
pub const BRAKE_A: f32 = 943.0;
pub const COAST_A: f32 = 141.0;

pub const BOOST_MAX: f32 = 100.0;
pub const BOOST_USE: f32 = 33.3;
pub const KICKOFF_BOOST: f32 = 33.0;

/// Courbures extremes : rayon de braquage a l'arret puis a pleine vitesse.
pub const TURN_SLOW: f32 = 0.023;
pub const TURN_FAST: f32 = 0.003275;
/// Braquage multiplie pendant un drift. A 2,4 le rayon tombe a 42 % de
/// celui en appui : la voiture pivote nettement plus court qu'elle ne
/// tourne (1,85 auparavant, soit 54 %).
pub const DRIFT_TURN: f32 = 2.4;
/// Amortissement de la vitesse laterale, par seconde. En appui la voiture
/// suit son nez en une cinquantaine de millisecondes ; en drift elle met
/// presque une demi-seconde, et c'est tout le glissement.
pub const GRIP: f32 = 18.0;
// La derive d'equilibre vaut a peu pres `vitesse de lacet / adherence` : 18
// donne les dix degres d'une voiture qui tient sa ligne, 6 le gros travers
// du powerslide. Descendre plus bas part en toupie.
pub const GRIP_DRIFT: f32 = 6.0;
/// Vitesse a laquelle le nez se realigne sur un muret longe, en rad/s.
pub const WALL_ALIGN: f32 = 6.0;

/// Exposant de la courbe de virage, ajuste sur la table de rayons de
/// Rocket League : 2,51 m a 18 km/h, 11,36 m a 82,8 km/h. A 1,1, la courbe
/// tournait trop court au milieu du domaine.
pub const TURN_CURVE: f32 = 2.25;
/// Rotation maximale de la voiture, en rad/s. Rocket League la plafonne a
/// 5,5 ; au sol la courbe de virage reste bien en dessous, mais le plafond
/// protege des reglages extremes.
pub const YAW_MAX: f32 = 5.5;

/// Part de la vitesse avant que la marche arriere peut atteindre. Rocket
/// League ne bride pas la marche arriere : elle plafonne au meme 1410 uu/s
/// que la marche avant, d'ou 1.
pub const REVERSE_RATIO: f32 = 1.0;

pub const DEMO_TIME: f32 = 3.0;
/// Rocket League exige le supersonique pour demolir : le seuil est donc le
/// meme, et non un chiffre a part. Un coequipier n'est jamais detruit, et
/// le sens du contact compte aussi (voir `collide`).
pub const DEMO_SPEED: f32 = SUPERSONIC;

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
    /// Rang dans son camp : sert a etaler engagements et reapparitions
    /// quand une equipe compte plus d'une voiture.
    pub rank: usize,
    pub input: Input,
    pub drifting: bool,
    pub demo: f32,
    /// Chronometre de l'effet visuel de boost, lu par le rendu.
    pub flame: f32,
}

impl Car {
    pub fn new(team: u8) -> Car {
        Car::nth(team, 0, 1)
    }

    /// `rank`-ieme voiture d'un camp qui en compte `count`.
    pub fn nth(team: u8, rank: usize, count: usize) -> Car {
        let (pos, yaw) = arena::kickoff_nth(team, rank, count);
        Car {
            pos,
            vel: V2::ZERO,
            yaw,
            boost: KICKOFF_BOOST,
            team,
            rank,
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
        // Le chronometre de reacteur ne s'eteint que dans `step`, qui ne
        // tourne pas pendant le decompte : laisse allume, il figeait la
        // flamme a l'ecran et tenait le souffle du boost pendant les trois
        // secondes de l'engagement.
        self.flame = 0.0;
    }

    pub fn fwd(&self) -> V2 {
        V2::dir(self.yaw)
    }

    pub fn speed(&self) -> f32 {
        self.vel.len()
    }

    pub fn supersonic(&self, t: &Tune) -> bool {
        self.demo <= 0.0 && self.speed() >= t.supersonic
    }

    /// Assez rapide pour detruire l'autre voiture au contact.
    pub fn lethal(&self, t: &Tune) -> bool {
        self.demo <= 0.0 && self.speed() >= t.demo_speed
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
    /// Ouvre la courbe d'acceleration aux tests, sans l'exposer au reste
    /// du moteur : c'est un detail interne de `step`.
    #[cfg(test)]
    pub fn essai_acceleration(v: f32, t: &Tune) -> f32 {
        Self::throttle_accel(v, t)
    }

    fn throttle_accel(v: f32, t: &Tune) -> f32 {
        let n = (v / t.drive_max.max(1.0)).clamp(0.0, 1.0);
        if n >= 1.0 {
            0.0
        } else {
            t.throttle_a * (1.0 - 0.9 * n)
        }
    }

    /// Courbure du virage : large a pleine vitesse, serree a l'arret.
    fn curvature(speed: f32, drift: bool, t: &Tune) -> f32 {
        let n = (speed / t.speed_max.max(1.0)).clamp(0.0, 1.0);
        let k = t.turn_fast + (t.turn_slow - t.turn_fast) * (1.0 - n).powf(t.turn_curve);
        if drift {
            k * t.drift_turn
        } else {
            k
        }
    }

    pub fn step(&mut self, dt: f32, t: &Tune) {
        if self.demo > 0.0 {
            self.demo -= dt;
            if self.demo <= 0.0 {
                let (p, a) = arena::respawn(self.team, self.rank);
                self.reset(p, a, t.kickoff_boost);
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
        let k = Self::curvature(speed, self.drifting, t);
        let rate = (inp.steer * k * heading).clamp(-t.yaw_max, t.yaw_max);
        self.yaw += rate * dt;

        let f = self.fwd();
        let lat = f.perp();
        let mut vf = self.vel.dot(f);
        let mut vt = self.vel.dot(lat);

        // Gachettes. Presser la gauche freine tant qu'on avance, puis
        // bascule en marche arriere une fois a l'arret, comme dans le jeu.
        let drive = inp.throttle - inp.brake;
        if drive.abs() > 0.02 {
            if vf * drive < -1.0 {
                vf += t.brake_a * dt * drive.signum();
            } else {
                vf += Self::throttle_accel(vf.abs(), t) * dt * drive;
            }
        } else if vf.abs() > 1.0 {
            vf -= t.coast_a * dt * vf.signum();
        } else {
            vf = 0.0;
        }

        self.flame = (self.flame - dt).max(0.0);
        let boosting = inp.boost && self.boost > 0.0;
        if boosting {
            vf += t.boost_a * dt;
            self.boost = (self.boost - t.boost_use * dt).max(0.0);
            self.flame = 0.12;
        }

        // Plafond : le boost autorise le supersonique, sinon la vitesse
        // excedentaire retombe en roue libre au lieu d'etre coupee net.
        if boosting {
            vf = vf.min(t.speed_max);
        } else if vf > t.drive_max {
            vf = (vf - t.coast_a * dt).max(t.drive_max);
        }
        vf = vf.max(-t.drive_max * t.reverse_ratio);

        let grip = if self.drifting { t.grip_drift } else { t.grip };
        vt *= (-grip * dt).exp();

        self.vel = f.mul(vf).add(lat.mul(vt)).clamp_len(t.speed_max);
        self.pos = self.pos.add(self.vel.mul(dt));

        if let Some(h) = arena::contact(self.pos, t.car_radius, t.arena_corner, &t.cage()) {
            self.ride(&h, dt, t);
        }
    }

    /// Contact avec l'enceinte. On ne rend pas la vitesse tangentielle et on
    /// pivote le nez vers le muret : la voiture le longe au lieu de rester
    /// plantee dessus, ce qui remplace la montee au mur du jeu d'origine.
    fn ride(&mut self, h: &arena::Hit, dt: f32, tune: &Tune) {
        arena::bounce(&mut self.pos, &mut self.vel, h, 0.05, 1.0);
        let t = h.n.perp();
        // On se range du cote ou l'on glisse deja ; nez pile perpendiculaire
        // au muret, la trajectoire tranche mieux que le cap, qui hesite.
        let cue = if self.speed() > 25.0 { self.vel } else { self.fwd() };
        let along = if cue.dot(t) >= 0.0 { t } else { t.mul(-1.0) };
        let err = wrap_angle(along.angle() - self.yaw);
        let rate = tune.wall_align * dt;
        self.yaw += err.clamp(-rate, rate);
    }

    /// Point du chassis le plus proche de `p` : la boite orientee rend les
    /// contacts du capot plus francs que ceux des flancs.
    pub fn nearest(&self, p: V2, t: &Tune) -> V2 {
        let d = p.sub(self.pos);
        let f = self.fwd();
        let lat = f.perp();
        let a = d.dot(f).clamp(-t.car_half_len, t.car_half_len);
        let b = d.dot(lat).clamp(-t.car_half_wid, t.car_half_wid);
        self.pos.add(f.mul(a)).add(lat.mul(b))
    }

    pub fn add_boost(&mut self, amount: f32, t: &Tune) {
        self.boost = (self.boost + amount).min(t.boost_max);
    }

    /// La carcasse garde sa position : c'est la que l'hote fait exploser la
    /// voiture. Elle ne gene personne, tous les contacts ignorent une
    /// voiture demolie.
    pub fn demolish(&mut self, tune: &Tune) {
        self.demo = tune.demo_time;
        self.vel = V2::ZERO;
    }
}
