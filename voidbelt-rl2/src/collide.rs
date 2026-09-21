//! Contacts entre mobiles : frappe de balle, bourrade et demolition.

use crate::ball::{self, Ball};
use crate::car::{self, Car};

/// Restitution voiture / balle : presque nulle, Rocket League ajoute a la
/// place une poussee dediee (ci-dessous) pour donner du punch aux frappes.
const BALL_REST: f32 = 0.05;
const CAR_REST: f32 = 0.25;
/// Part de la vitesse de rapprochement rendue en poussee : une bourrade doit
/// s'entendre et se voir, meme a vitesse moderee.
const BUMP_GAIN: f32 = 0.95;
/// Poussee plancher, pour qu'un contact au ralenti ecarte quand meme.
const BUMP_FLOOR: f32 = 45.0;
const CAR_R: f32 = 14.0;

/// Poussee supplementaire d'une frappe selon la vitesse du chassis, reprise
/// de la table du jeu (0, 500, 1000, 1500, 1750, 2300 uu/s) ramenee a notre
/// echelle : elle croit vite puis sature, d'ou les frappes molles a l'arret.
const PUSH: [(f32, f32); 6] = [
    (0.0, 0.0),
    (134.7, 43.1),
    (269.5, 70.3),
    (404.3, 88.4),
    (471.6, 94.3),
    (619.8, 110.8),
];

fn push_scale(speed: f32) -> f32 {
    let mut prev = PUSH[0];
    for &cur in PUSH.iter().skip(1) {
        if speed <= cur.0 {
            let t = (speed - prev.0) / (cur.0 - prev.0).max(1e-6);
            return prev.1 + (cur.1 - prev.1) * t;
        }
        prev = cur;
    }
    PUSH[PUSH.len() - 1].1
}

/// Frappe de balle. Renvoie la force du contact, `0` s'il n'y a pas touche.
pub fn car_ball(c: &mut Car, b: &mut Ball) -> f32 {
    if c.demo > 0.0 {
        return 0.0;
    }
    let contact = c.nearest(b.pos);
    let d = b.pos.sub(contact);
    let dist = d.len();
    if dist >= ball::RADIUS {
        return 0.0;
    }
    // Chassis et balle confondus : on retombe sur l'axe centre a centre.
    let n = if dist > 1e-4 {
        d.mul(1.0 / dist)
    } else {
        let away = b.pos.sub(c.pos);
        if away.len() > 1e-4 {
            away.norm()
        } else {
            c.fwd()
        }
    };
    b.pos = b.pos.add(n.mul(ball::RADIUS - dist));

    let vn = b.vel.sub(c.vel).dot(n);
    let mut impact = 0.0;
    if vn < 0.0 {
        let j = -(1.0 + BALL_REST) * vn * (car::MASS / (car::MASS + ball::MASS));
        b.vel = b.vel.add(n.mul(j));
        c.vel = c.vel.sub(n.mul(j * ball::MASS / car::MASS));
        impact = -vn;
    }
    let dir = b.pos.sub(c.pos).norm();
    let extra = push_scale(c.speed());
    b.vel = b.vel.add(dir.mul(extra)).clamp_len(ball::MAX_SPEED);
    b.last_touch = c.team as i8;
    impact + extra
}

/// Resultat d'une bourrade : intensite du choc et sort de chaque voiture.
pub struct Bump {
    pub force: f32,
    pub demo_a: bool,
    pub demo_b: bool,
}

impl Bump {
    pub fn any_demo(&self) -> bool {
        self.demo_a || self.demo_b
    }
}

/// Contact entre deux voitures. Au-dela du seuil de vitesse, le choc
/// demolit : la victime repart de son fond de terrain apres trois secondes.
/// Un frontal entre deux voitures lancees fait sauter les deux.
pub fn car_car(a: &mut Car, b: &mut Car) -> Option<Bump> {
    if a.demo > 0.0 || b.demo > 0.0 {
        return None;
    }
    let d = b.pos.sub(a.pos);
    let dist = d.len();
    if dist >= CAR_R * 2.0 {
        return None;
    }
    let n = if dist > 1e-4 {
        d.mul(1.0 / dist)
    } else {
        a.fwd()
    };
    let overlap = CAR_R * 2.0 - dist;
    a.pos = a.pos.sub(n.mul(overlap * 0.5));
    b.pos = b.pos.add(n.mul(overlap * 0.5));

    let vn = b.vel.sub(a.vel).dot(n);
    if vn >= 0.0 {
        return None;
    }

    // Le verdict se lit sur les vitesses d'avant le choc : l'impulsion qui
    // suit ralentit justement celui qui arrive, et masquerait le contact.
    let a_hits = a.lethal() && a.vel.dot(n) > 0.0;
    let b_hits = b.lethal() && b.vel.dot(n) < 0.0;

    let j = -(1.0 + CAR_REST) * vn * 0.5;
    a.vel = a.vel.sub(n.mul(j));
    b.vel = b.vel.add(n.mul(j));

    // Chacun detruit l'autre s'il arrive assez vite dessus : le frontal
    // entre deux lancees ne fait donc pas de survivant.
    if b_hits {
        a.demolish();
    }
    if a_hits {
        b.demolish();
    }
    if !a_hits && !b_hits {
        let kick = ((-vn) * BUMP_GAIN).max(BUMP_FLOOR);
        a.vel = a.vel.sub(n.mul(kick * 0.5));
        b.vel = b.vel.add(n.mul(kick * 0.5));
    }
    Some(Bump {
        force: -vn,
        demo_a: b_hits,
        demo_b: a_hits,
    })
}
