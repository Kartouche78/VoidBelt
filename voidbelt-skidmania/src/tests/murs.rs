//! Murets (README-CONDUITE, verifications 7 et 8) : impacts frontaux,
//! obliques et frottements, a plusieurs vitesses ; aucune traversee.

use crate::car::{Car, Input};
use crate::game::{Event, Game, Phase, DT};
use crate::mur::Mur;
use crate::track::{Track, WALL};
use crate::tune::TUNING;

/// Voiture contre le muret de droite, a `v` m/s, arrivant a `angle` rad.
fn contre_le_mur(v: f32, angle: f32) -> Car {
    let mut c = Car::new();
    c.x = WALL + 0.2;
    c.vx = v * angle.sin();
    c.vz = v * angle.cos();
    c.yaw = angle;
    c
}

fn choc(v: f32, deg: f32) -> (f32, Car) {
    let mut c = contre_le_mur(v, deg.to_radians());
    let mut m = Mur::default();
    m.resoudre(&mut c, &TUNING, DT, WALL);
    (c.vx.hypot(c.vz) / v, c)
}

#[test]
fn la_perte_depend_de_l_angle_d_impact() {
    for v in [40.0, 100.0, 160.0] {
        let (frotte, a) = choc(v, 5.0);
        let (oblique, b) = choc(v, 35.0);
        let (face, _) = choc(v, 88.0);
        println!("{:.0} km/h : frottement garde {:.0} %, oblique {:.0} %, face {:.0} %", v * 3.6, frotte * 100.0, oblique * 100.0, face * 100.0);
        assert!(frotte > 0.9, "un frottement coute peu");
        assert!(oblique > 0.55 && oblique < 0.85, "oblique : {oblique}");
        assert!(face < 0.1, "de face, la voiture s'arrete presque");
        // pas de rebond puissant, ni gain de vitesse
        assert!(a.vx <= 0.0 && a.vx > -0.05 * v);
        assert!(b.vx.hypot(b.vz) <= v);
        // un frottement ne coupe pas la propulsion, un choc franc oui
        assert_eq!(a.penalite, 0.0);
        assert!(b.penalite > 0.2 && b.penalite <= 0.7);
    }
}

#[test]
fn un_contact_prolonge_frotte_selon_le_temps() {
    // une seconde de frottement coute pareil, quel que soit le pas
    let frotte = |dt: f32| {
        let mut c = contre_le_mur(100.0, 0.05);
        let mut m = Mur::default();
        m.resoudre(&mut c, &TUNING, dt, WALL);
        let v0 = c.vz;
        for _ in 0..(1.0 / dt).round() as usize {
            c.x = WALL + 0.01;
            c.vx = 1.0;
            m.resoudre(&mut c, &TUNING, dt, WALL);
        }
        c.vz / v0
    };
    let a = frotte(1.0 / 120.0);
    let b = frotte(1.0 / 30.0);
    println!("une seconde contre le mur : garde {:.3} (120 Hz) / {:.3} (30 Hz)", a, b);
    assert!((a - b).abs() < 0.01);
    assert!(a > 0.6 && a < 0.8);
}

#[test]
fn un_meme_contact_ne_compte_qu_une_fois() {
    let mut c = contre_le_mur(100.0, 0.6);
    let mut m = Mur::default();
    let mut impacts = 0;
    for _ in 0..30 {
        if m.resoudre(&mut c, &TUNING, DT, WALL).is_some() {
            impacts += 1;
        }
        c.x = WALL + 0.05;
        c.vx = c.vx.max(0.5);
    }
    assert_eq!(impacts, 1);
}

#[test]
fn la_propulsion_revient_apres_un_choc() {
    let (_, mut c) = choc(120.0, 60.0);
    let pen = c.penalite;
    let mut t = 0.0;
    while c.penalite > 0.0 && t < 2.0 {
        c.update(DT, Input { throttle: 1.0, ..Input::default() }, &TUNING);
        t += DT;
    }
    println!("penalite {:.0} %, rendue en {:.2} s", pen * 100.0, t);
    assert!(t >= 0.2 - 1e-3 && t <= 0.8 + 0.02, "{t} s");
}

#[test]
fn a_600_km_h_la_voiture_ne_traverse_jamais() {
    let mut g = Game::new(Track::build());
    g.phase = Phase::Running;
    g.car.z = 300.0;
    g.car.vz = 160.0;
    g.car.vx = 45.0;
    g.car.yaw = 0.3;
    let mut chocs = 0;
    for _ in 0..240 {
        g.input = Input { throttle: 1.0, steer: 1.0, ..Input::default() };
        g.tick();
        assert!(g.car.x.abs() <= WALL + 1e-4, "traverse : x = {}", g.car.x);
        chocs += g.events.drain(..).filter(|e| matches!(e, Event::Wall(_))).count();
    }
    assert!(chocs >= 1);
}
