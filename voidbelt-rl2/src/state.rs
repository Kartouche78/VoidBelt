//! Serialisation de l'etat vers l'hote : un simple tableau de `f32` relu
//! dans la memoire lineaire, sans binding genere ni allocation par image.

use crate::arena;
use crate::ball;
use crate::boost;
use crate::car;
use crate::game::{Game, Phase};
use crate::pads::PADS;

/// Nombre de champs par voiture dans le tampon d'etat.
pub const CAR_STRIDE: usize = 10;
pub const CAR_BASE: usize = 12;
pub const PAD_BASE: usize = CAR_BASE + crate::game::CARS * CAR_STRIDE;
pub const STATE_LEN: usize = PAD_BASE + boost::COUNT;

pub fn write_state(g: &Game, out: &mut [f32]) {
    out[0] = match g.phase {
        Phase::Countdown => 0.0,
        Phase::Play => 1.0,
        Phase::Goal => 2.0,
        Phase::Over => 3.0,
        Phase::Warmup => 4.0,
    };
    out[1] = g.clock;
    out[2] = g.score[0] as f32;
    out[3] = g.score[1] as f32;
    out[4] = g.timer;
    out[5] = if g.overtime { 1.0 } else { 0.0 };
    out[6] = g.ball.pos.x;
    out[7] = g.ball.pos.y;
    out[8] = g.ball.vel.x;
    out[9] = g.ball.vel.y;
    out[10] = g.ball.roll;
    out[11] = g.ball.last_touch as f32;

    for (i, c) in g.cars.iter().enumerate() {
        let b = CAR_BASE + i * CAR_STRIDE;
        out[b] = c.pos.x;
        out[b + 1] = c.pos.y;
        out[b + 2] = c.yaw;
        out[b + 3] = c.speed();
        out[b + 4] = c.boost;
        out[b + 5] = if c.drifting { 1.0 } else { 0.0 };
        out[b + 6] = c.demo;
        out[b + 7] = if c.supersonic() { 1.0 } else { 0.0 };
        out[b + 8] = c.flame;
        out[b + 9] = c.slip();
    }

    for (i, cd) in g.pads.cooldown.iter().enumerate() {
        out[PAD_BASE + i] = *cd;
    }
}

/// `[nombre, code, valeur, code, valeur, ...]`
pub fn write_events(g: &Game, out: &mut Vec<f32>) {
    out.clear();
    out.push(g.events.len() as f32);
    for &(code, value) in g.events.iter() {
        out.push(code as f32);
        out.push(value);
    }
}

/// Table figee des plots : `x, y, gros` par plot.
pub fn pad_table() -> Vec<f32> {
    let mut v = Vec::with_capacity(PADS.len() * 3);
    for &(x, y, big) in PADS.iter() {
        v.push(x);
        v.push(y);
        v.push(if big { 1.0 } else { 0.0 });
    }
    v
}

/// Constantes de terrain, pour que le rendu n'ait pas a les redeclarer.
pub fn geometry() -> Vec<f32> {
    vec![
        arena::BOARD_W,
        arena::BOARD_H,
        arena::MIN_X,
        arena::MAX_X,
        arena::MIN_Y,
        arena::MAX_Y,
        arena::CORNER,
        arena::GOAL_HALF,
        arena::GOAL_DEPTH,
        ball::RADIUS,
        car::HALF_LEN,
        car::HALF_WID,
        car::BOOST_MAX,
        car::SPEED_MAX,
        boost::COUNT as f32,
        car::DEMO_SPEED,
        // Instant, dans le decompte, ou le premier chiffre s'affiche : la
        // seconde d'avance reste muette pour coller a la piste sonore.
        crate::game::COUNTDOWN - crate::game::COUNTDOWN_LEAD,
    ]
}
