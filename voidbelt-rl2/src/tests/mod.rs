//! Banc d'essai du moteur, et les aides partagees par les deux series.

mod physics;
mod rules;

use crate::arena;
use crate::car::{Car, Input};
use crate::game::{Game, Phase};
use crate::tune::Tune;
use crate::vec::v2;

pub(super) const DT: f32 = 1.0 / 120.0;

/// Reglages d'usine. Les tests mesurent le jeu tel qu'il sort de fabrique ;
/// `/admin` peut ensuite s'en ecarter, c'est justement son role.
pub(super) const T: Tune = Tune::FACTORY;

pub(super) fn drive(t: f32, boost: bool) -> Input {
    Input { throttle: t, brake: 0.0, steer: 0.0, boost, drift: false }
}

/// Fait tourner le moteur sans laisser la voiture quitter le rond central :
/// seul le comportement longitudinal nous interesse ici, pas le trajet.
pub(super) fn on_bench(c: &mut Car, steps: usize) {
    for _ in 0..steps {
        c.step(DT, &T);
        c.pos = v2(arena::CX, arena::CY);
    }
}

/// `Game::step` plafonne volontairement le temps avale d'un seul coup : on
/// alimente donc le match image par image, comme le fait le navigateur.
pub(super) fn run(g: &mut Game, seconds: f32) {
    for _ in 0..(seconds * 60.0).round() as usize {
        g.step(1.0 / 60.0);
    }
}

/// Fait avancer un match jusqu'a la fin du decompte d'engagement.
/// Joue `secs` en ramassant les evenements au passage : `Game::events` se
/// vide a chaque pas, un test qui le lit apres coup ne voit plus rien.
pub(super) fn harvest(g: &mut Game, secs: f32) -> Vec<(u32, f32)> {
    let mut out = Vec::new();
    let steps = (secs / DT).round() as usize;
    for _ in 0..steps {
        g.step(DT);
        out.extend_from_slice(&g.events);
    }
    out
}

pub(super) fn started(level: u32) -> Game {
    let mut g = Game::new(7, level, 300.0);
    // Juste apres le decompte, quelle que soit sa duree : en figer une ici
    // donnait au bot une avance d'une seconde le jour ou elle a change.
    run(&mut g, crate::game::COUNTDOWN + 0.2);
    assert_eq!(g.phase, Phase::Play);
    g
}

/// Deux voitures lancees a fond au centre, braquage a fond, l'une en appui
/// et l'autre en drift.
pub(super) fn hard_turn(steps: usize) -> (Car, Car) {
    let mut grip = Car::new(0);
    let mut drift = Car::new(0);
    for c in [&mut grip, &mut drift] {
        c.input = drive(1.0, false);
        on_bench(c, 600);
    }
    grip.input = Input { throttle: 1.0, brake: 0.0, steer: 1.0, boost: false, drift: false };
    drift.input = Input { drift: true, ..grip.input };
    for _ in 0..steps {
        grip.step(DT, &T);
        drift.step(DT, &T);
    }
    (grip, drift)
}

/// Lancee a fond, collee au mur du bas, avec le cap indique.
pub(super) fn along_wall(yaw: f32, steps: usize) -> (f32, f32) {
    let mut c = Car::new(0);
    c.input = drive(1.0, false);
    on_bench(&mut c, 600);
    let free = c.speed();
    c.pos = v2(arena::CX, arena::MAX_Y - crate::car::RADIUS - 1.0);
    c.yaw = yaw;
    c.vel = crate::vec::V2::dir(yaw).mul(free);
    for _ in 0..steps {
        c.step(DT, &T);
        c.pos.x = arena::CX;
        assert!(c.pos.y <= arena::MAX_Y + 0.5, "elle traverse le muret");
    }
    (c.speed(), free)
}
