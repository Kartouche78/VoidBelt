//! L'adversaire geré par la machine.
//!
//! Il ne triche pas : il ne dispose que des memes commandes que le joueur.
//! Sa boucle tient en trois decisions - defendre, attaquer, aller au boost -
//! puis un asservissement en cap vers le point choisi.

use crate::arena;
use crate::ball::Ball;
use crate::boost::Field;
use crate::car::{Car, Input, BOOST_MAX};
use crate::tune::Tune;
use crate::vec::{v2, wrap_angle, V2};

/// Distance a laquelle le bot se place derriere la balle quand il arrive
/// deja dans le bon axe : juste de quoi loger le capot et le ballon, pour
/// que changer le gabarit des voitures ne le decale pas.
pub const APPROACH: f32 = crate::car::HALF_LEN + crate::ball::RADIUS + 8.0;
/// Ecart lateral maximal pris pour contourner la balle par le cote.
pub const SWING: f32 = 70.0;

#[derive(Clone, Copy)]
pub struct Skill {
    /// Anticipation de la trajectoire de balle, en secondes.
    pub lookahead: f32,
    /// Gain du correcteur de cap.
    pub gain: f32,
    /// Contre-braquage : part de la derive retranchee a la consigne.
    pub counter: f32,
    /// Fraction de gachette utilisee.
    pub throttle: f32,
    /// Amplitude de l'erreur de visee, en unites monde.
    pub sloppy: f32,
    /// Seuil de boost en dessous duquel il part en chercher.
    pub greed: f32,
}

impl Skill {
    /// `0` debutant, `1` confirme, `2` impitoyable.
    pub fn new(level: u32) -> Skill {
        match level {
            0 => Skill { lookahead: 0.10, gain: 1.3, counter: 0.5, throttle: 0.70, sloppy: 70.0, greed: 12.0 },
            2 => Skill { lookahead: 0.42, gain: 2.2, counter: 1.1, throttle: 1.00, sloppy: 8.0, greed: 45.0 },
            _ => Skill { lookahead: 0.26, gain: 1.8, counter: 0.8, throttle: 0.88, sloppy: 30.0, greed: 28.0 },
        }
    }
}

pub struct Bot {
    pub skill: Skill,
    seed: u32,
    /// Bruit de visee lisse dans le temps, sinon le bot tremble.
    wobble: V2,
    timer: f32,
}

impl Bot {
    pub fn new(level: u32, seed: u32) -> Bot {
        Bot {
            skill: Skill::new(level),
            seed: seed | 1,
            wobble: V2::ZERO,
            timer: 0.0,
        }
    }

    fn rand(&mut self) -> f32 {
        self.seed = self.seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
        ((self.seed >> 8) as f32 / 8_388_608.0) - 1.0
    }

    /// But adverse, et centre du but a defendre.
    fn goals(team: u8) -> (V2, V2) {
        let own = v2(if team == 0 { arena::MIN_X } else { arena::MAX_X }, arena::CY);
        let foe = v2(if team == 0 { arena::MAX_X } else { arena::MIN_X }, arena::CY);
        (foe, own)
    }

    pub fn think(&mut self, car: &Car, ball: &Ball, pads: &Field, dt: f32, t: &Tune) -> Input {
        let mut out = Input::default();
        if car.demo > 0.0 {
            return out;
        }
        let s = self.skill;
        let (foe_goal, own_goal) = Self::goals(car.team);

        self.timer -= dt;
        if self.timer <= 0.0 {
            self.timer = 0.35;
            self.wobble = v2(self.rand(), self.rand()).mul(s.sloppy);
        }

        // Ou sera la balle quand on l'atteindra, plutot qu'ou elle est.
        let reach = car.pos.sub(ball.pos).len();
        let lead = (s.lookahead + reach / 900.0).min(0.8);
        let aim = ball.predict(lead, t).add(self.wobble);

        // La balle est-elle plus pres de notre but que nous ? Dans ce cas on
        // rentre se placer sur l'axe au lieu de la poursuivre.
        let ball_side = (aim.x - own_goal.x).abs();
        let car_side = (car.pos.x - own_goal.x).abs();
        // Marges exprimees en tailles de balle : elles suivent ainsi le
        // reglage. Figees, elles devenaient trop etroites des que la balle
        // grossissait, et le bot la poussait dans ses propres filets.
        let threatened = ball_side < car_side - t.ball_radius * 2.0;

        let target = if threatened {
            // Repli : point entre la balle et le but, legerement decale pour
            // ne pas pousser la balle dans ses propres filets.
            let axis = own_goal.sub(aim).norm();
            let mut p = aim.add(axis.mul(t.bot_approach() * 3.0));
            // Ecart lateral : il faut contourner la balle, donc franchir son
            // diametre, sinon le repli la percute vers sa propre cage.
            p.y += (aim.y - arena::CY).signum() * t.ball_radius * 2.2;
            clamp_field(p)
        } else if car.boost < s.greed && reach > t.bot_approach() * 6.5 {
            pads.best_for(car.pos, car.boost < BOOST_MAX * 0.25)
                .unwrap_or(aim)
        } else {
            // Attaque : viser un point derriere la balle, dans l'axe du but
            // adverse. Arriver de travers ne donne qu'un coup de pouce dans
            // une direction quelconque, alors plus l'angle d'arrivee est
            // mauvais, plus on se place loin derriere et decale sur le cote,
            // pour contourner la balle au lieu de la bousculer.
            let axis = foe_goal.sub(aim).norm();
            let align = aim.sub(car.pos).norm().dot(axis);
            let miss = (1.0 - align).clamp(0.0, 2.0);
            let side = axis.perp();
            let hand = side.dot(car.pos.sub(aim));
            let swing = side.mul(if hand >= 0.0 { 1.0 } else { -1.0 } * t.bot_swing * miss * 0.5);
            clamp_field(aim.sub(axis.mul(t.bot_approach() * (1.0 + 1.6 * miss))).add(swing))
        };

        let to = target.sub(car.pos);
        let dist = to.len();
        let err = wrap_angle(to.angle() - car.yaw);
        // Correcteur proportionnel amorti par la derive : sans ce terme la
        // voiture, qui glisse desormais, part en queue de poisson autour de
        // sa consigne au lieu de s'y poser.
        out.steer = (err * s.gain - car.slip() * s.counter).clamp(-1.0, 1.0);

        // Cible dans le dos et tout pres : marche arriere pour se degager,
        // c'est plus rapide qu'un demi-tour complet.
        if err.abs() > 2.2 && dist < 150.0 {
            out.brake = s.throttle;
            out.steer = -out.steer;
        } else {
            out.throttle = s.throttle * (1.0 - 0.45 * (err.abs() / std::f32::consts::PI));
        }

        // Le drift ne sert qu'aux demi-tours : declenche trop tot il coute
        // plus de vitesse qu'il ne fait gagner d'angle.
        out.drift = err.abs() > 1.35 && car.speed() > 210.0;
        out.boost = car.boost > 4.0
            && err.abs() < 0.28
            && dist > 130.0
            && !threatened
            && out.throttle > 0.5;
        out
    }
}

fn clamp_field(p: V2) -> V2 {
    v2(
        p.x.clamp(arena::MIN_X + 30.0, arena::MAX_X - 30.0),
        p.y.clamp(arena::MIN_Y + 30.0, arena::MAX_Y - 30.0),
    )
}
