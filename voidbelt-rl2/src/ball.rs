//! La balle : elle roule, freine peu et rebondit fort sur les murs.

use crate::arena;
use crate::tune::Tune;
use crate::vec::{v2, V2};

pub const RADIUS: f32 = 24.60;
pub const MASS: f32 = 30.0;
/// Rocket League plafonne la balle a 6000 uu/s pour une voiture a 2300 :
/// la balle va donc 2,6 fois plus vite que la voiture. A notre echelle,
/// cela fait 1617 et non 1200, qui bridait les tirs.
pub const MAX_SPEED: f32 = 1617.0;
/// Frottement de roulement, en amortissement exponentiel par seconde.
pub const DRAG: f32 = 0.03056;
pub const WALL_REST: f32 = 0.6;
/// Rotation maximale de la balle, en rad/s. Purement visuel chez nous.
pub const SPIN_MAX: f32 = 6.0;
pub const WALL_FRIC: f32 = 0.715;

#[derive(Clone, Copy)]
pub struct Ball {
    pub pos: V2,
    pub vel: V2,
    /// Angle de roulement cumule, purement visuel.
    pub roll: f32,
    /// Derniere equipe a avoir touche, pour l'attribution du but.
    pub last_touch: i8,
}

impl Ball {
    pub fn new() -> Ball {
        Ball {
            pos: v2(arena::CX, arena::CY),
            vel: V2::ZERO,
            roll: 0.0,
            last_touch: -1,
        }
    }

    pub fn reset(&mut self) {
        self.pos = v2(arena::CX, arena::CY);
        self.vel = V2::ZERO;
        self.last_touch = -1;
    }

    /// Avance la balle et renvoie la vitesse d'impact d'un eventuel mur,
    /// que l'appelant traduit en son de rebond.
    pub fn step(&mut self, dt: f32, t: &Tune) -> f32 {
        self.vel = self.vel.mul((-t.ball_drag * dt).exp()).clamp_len(t.ball_max_speed);
        self.pos = self.pos.add(self.vel.mul(dt));
        let spin = (self.vel.len() / t.ball_radius.max(1.0)).min(t.ball_spin_max);
        self.roll += spin * dt;
        match arena::contact(self.pos, t.ball_radius) {
            Some(h) => {
                arena::bounce(&mut self.pos, &mut self.vel, &h, t.ball_wall_rest, t.ball_wall_fric)
            }
            None => 0.0,
        }
    }

    /// Position approximative dans `t` secondes, frottement compris. Le bot
    /// s'en sert pour viser ou la balle sera, pas ou elle est.
    pub fn predict(&self, t: f32, tune: &Tune) -> V2 {
        let drag = tune.ball_drag.max(1e-3);
        let k = (1.0 - (-drag * t).exp()) / drag;
        let p = self.pos.add(self.vel.mul(k));
        v2(
            p.x.clamp(arena::MIN_X, arena::MAX_X),
            p.y.clamp(arena::MIN_Y, arena::MAX_Y),
        )
    }
}
