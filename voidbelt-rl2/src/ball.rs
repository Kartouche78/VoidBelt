//! La balle : elle roule, freine peu et rebondit fort sur les murs.

use crate::arena;
use crate::vec::{v2, V2};

pub const RADIUS: f32 = 14.0;
pub const MASS: f32 = 30.0;
pub const MAX_SPEED: f32 = 1200.0;
/// Frottement de roulement, en amortissement exponentiel par seconde.
const DRAG: f32 = 0.42;
const WALL_REST: f32 = 0.6;
const WALL_FRIC: f32 = 0.9;

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
    pub fn step(&mut self, dt: f32) -> f32 {
        self.vel = self.vel.mul((-DRAG * dt).exp()).clamp_len(MAX_SPEED);
        self.pos = self.pos.add(self.vel.mul(dt));
        self.roll += self.vel.len() / RADIUS * dt;
        match arena::contact(self.pos, RADIUS) {
            Some(h) => arena::bounce(&mut self.pos, &mut self.vel, &h, WALL_REST, WALL_FRIC),
            None => 0.0,
        }
    }

    /// Position approximative dans `t` secondes, frottement compris. Le bot
    /// s'en sert pour viser ou la balle sera, pas ou elle est.
    pub fn predict(&self, t: f32) -> V2 {
        let k = (1.0 - (-DRAG * t).exp()) / DRAG;
        let p = self.pos.add(self.vel.mul(k));
        v2(
            p.x.clamp(arena::MIN_X, arena::MAX_X),
            p.y.clamp(arena::MIN_Y, arena::MAX_Y),
        )
    }
}
