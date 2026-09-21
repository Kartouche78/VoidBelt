//! Serialisation de l'etat vers l'hote : un simple tableau de `f32` relu
//! dans la memoire lineaire, sans binding genere ni allocation par image.

use crate::arena;
use crate::boost;
use crate::game::{Game, Phase};
use crate::pads::PADS;

/// Nombre de champs par voiture dans le tampon d'etat.
/// Dix champs de jeu, puis six compteurs personnels : points, buts, passes,
/// arrets, tirs, demolitions. Le tableau des joueurs les lit tels quels.
pub const CAR_STRIDE: usize = 16;
/// Effectif de la partie, en tete de l'etat : il change des qu'un joueur
/// rejoint un salon, et c'est lui qui dit ou commencent les plots. Le mettre
/// ici rend chaque image auto-descriptive, sans que l'hote ait a deviner.
pub const CAR_COUNT: usize = 12;
pub const CAR_BASE: usize = 13;

/// Les plots sont ranges derriere les voitures : leur depart depend donc de
/// l'effectif, qu'un salon en ligne fixe librement. L'hote lit ce depart
/// dans l'entete de l'etat plutot que de le supposer.
pub fn pad_base(cars: usize) -> usize {
    CAR_BASE + cars * CAR_STRIDE
}

pub fn state_len(cars: usize) -> usize {
    pad_base(cars) + boost::COUNT
}

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
    out[CAR_COUNT] = g.cars.len() as f32;

    for (i, c) in g.cars.iter().enumerate() {
        let b = CAR_BASE + i * CAR_STRIDE;
        out[b] = c.pos.x;
        out[b + 1] = c.pos.y;
        out[b + 2] = c.yaw;
        out[b + 3] = c.speed();
        out[b + 4] = c.boost;
        out[b + 5] = if c.drifting { 1.0 } else { 0.0 };
        out[b + 6] = c.demo;
        out[b + 7] = if c.supersonic(&g.tune) { 1.0 } else { 0.0 };
        out[b + 8] = c.flame;
        out[b + 9] = c.slip();
        let st = g
            .scoring
            .stats
            .get(i)
            .copied()
            .unwrap_or_default();
        out[b + 10] = st.points as f32;
        out[b + 11] = st.goals as f32;
        out[b + 12] = st.assists as f32;
        out[b + 13] = st.saves as f32;
        out[b + 14] = st.shots as f32;
        out[b + 15] = st.demos as f32;
    }

    let base = pad_base(g.cars.len());
    for (i, cd) in g.pads.cooldown.iter().enumerate() {
        out[base + i] = *cd;
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
/// Les valeurs reglables viennent des reglages en cours, pas des defauts :
/// sinon l'interface d'administration changerait la physique sans que le
/// dessin ni la jauge suivent.
pub fn geometry(t: &crate::tune::Tune) -> Vec<f32> {
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
        t.ball_radius,
        t.car_half_len,
        t.car_half_wid,
        t.boost_max,
        t.speed_max,
        boost::COUNT as f32,
        t.demo_speed,
        // Instant, dans le decompte, ou le premier chiffre s'affiche : la
        // seconde d'avance reste muette pour coller a la piste sonore.
        t.count_from(),
    ]
}
