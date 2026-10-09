//! Une course complete, menee par un pilote automatique rudimentaire.

use crate::car::Input;
use crate::game::{Event, Game, Phase, DT};
use crate::track::Track;

/// Suit le milieu de la route et freine avant les virages trop serres.
pub(super) fn pilote(g: &Game) -> Input {
    let c = &g.car;
    let t = &g.tune;
    let v = c.speed.max(1.0);
    let avail = t.lacet_max(v) * (v / 4.0).min(1.0);
    let k_now = g.track.kappa_at(c.z + 4.0);
    let k_far = (0..6)
        .map(|i| g.track.kappa_at(c.z + 10.0 + i as f32 * v * 0.15).abs())
        .fold(0.0, f32::max);
    let heading = if c.vf > 1.0 { c.vx.atan2(c.vz) } else { c.yaw };
    // revenir au milieu sans osciller : la caisse a de l'inertie de
    // rotation, on amortit donc sur l'ecart a la rotation du trace
    let want = (-c.x * 0.02 - c.vx * 0.01).clamp(-0.25, 0.25);
    let suivre = k_now * v;
    let rate = suivre + (want - heading) * 2.5 - (c.yaw_rate - suivre) * 0.25;
    let steer = (rate / avail.max(0.1)).clamp(-1.0, 1.0);
    let fast = k_far * v > avail * 1.15;
    Input {
        throttle: if fast { 0.0 } else { 1.0 },
        brake: if fast && v > 25.0 { 0.5 } else { 0.0 },
        steer,
        ..Input::default()
    }
}

fn course(max_secs: f32) -> (Game, Vec<Event>) {
    let mut g = Game::new(Track::build());
    let mut evs = vec![];
    let mut t = 0.0;
    while g.phase != Phase::Finished && t < max_secs {
        g.input = pilote(&g);
        g.tick();
        evs.append(&mut g.events);
        t += DT;
    }
    (g, evs)
}

#[test]
fn un_pilote_prudent_boucle_le_circuit() {
    let (g, evs) = course(400.0);
    let walls = evs.iter().filter(|e| matches!(e, Event::Wall(_))).count();
    println!(
        "arrivee en {:.1} s, checkpoints {:?}, {walls} chocs",
        g.time,
        g.cp_times.iter().map(|t| (t * 10.0).round() / 10.0).collect::<Vec<_>>()
    );
    assert_eq!(g.phase, Phase::Finished, "bloque a s = {}", g.car.z);
    // conduite Stadium Car (README-CONDUITE) : 14 m/s2 au depart, 600 km/h
    // au mieux ; ce pilote prudent met environ deux minutes, un joueur moins
    assert!((70.0..180.0).contains(&g.time), "duree du tour : {}", g.time);
    assert_eq!(g.cp_times.len(), g.track.checkpoints.len());
    assert!(evs.contains(&Event::Go));
}

#[test]
fn le_compte_a_rebours_bloque_la_voiture() {
    let mut g = Game::new(Track::build());
    let s0 = g.car.z;
    g.input = Input { throttle: 1.0, ..Input::default() };
    for _ in 0..(2.9 / DT) as usize {
        g.tick();
    }
    assert_eq!(g.phase, Phase::Countdown);
    assert_eq!(g.car.z, s0);
    for _ in 0..(0.5 / DT) as usize {
        g.tick();
    }
    assert_eq!(g.phase, Phase::Running);
    assert!(g.car.z > s0);
}

#[test]
fn le_respawn_ramene_au_dernier_checkpoint_avec_sa_vitesse() {
    let (mut g, _) = {
        let mut g = Game::new(Track::build());
        let first = g.track.checkpoints[0];
        while g.car.z < first + 40.0 {
            g.input = pilote(&g);
            g.tick();
        }
        (g, ())
    };
    let speed = g.save_speed();
    g.respawn();
    assert_eq!(g.car.z, g.track.checkpoints[0]);
    assert!((g.car.speed - speed).abs() < 1e-3 && speed > 20.0);
    assert!(g.events.contains(&Event::Respawn));
}

#[test]
fn un_muret_retire_la_vitesse_sortante_et_le_drift() {
    let mut g = Game::new(Track::build());
    g.phase = Phase::Running;
    g.car.z = 100.0;
    g.car.vz = 40.0;
    g.car.vx = 15.0;
    g.car.x = crate::track::WALL - 0.05;
    g.car.drift_points = 500.0;
    for _ in 0..10 {
        g.tick();
    }
    assert!(g.car.x <= crate::track::WALL + 1e-4);
    assert!(g.car.vx <= 0.0, "la vitesse sortante doit etre retiree : vx = {}", g.car.vx);
    assert_eq!(g.car.drift_points, 0.0);
    // un choc a 20 degres coute 5 a 20 % de la vitesse le long du mur
    assert!(g.car.vz > 30.0 && g.car.vz < 39.0, "vitesse apres le choc : {}", g.car.vz);
}

