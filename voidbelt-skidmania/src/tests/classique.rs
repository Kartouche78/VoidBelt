//! Le gameplay classique (F1) : la conduite d'avant la refonte.

use crate::car::{Car, Input, PLAFOND};
use crate::classique::{pas, REGLAGES};
use crate::game::{Game, Phase, DT};
use crate::track::Track;

#[test]
fn le_classique_retrouve_la_conduite_d_avant() {
    // 180 m/s2 au depart : 300 km/h en moins d'une seconde
    let mut c = Car::new();
    let gaz = Input { throttle: 1.0, ..Input::default() };
    let mut t = 0.0;
    while c.speed * 3.6 < 300.0 && t < 5.0 {
        pas(&mut c, DT, gaz, &REGLAGES);
        t += DT;
    }
    println!("classique : 0-300 km/h en {t:.2} s");
    assert!(t < 1.0);
    for _ in 0..(10.0 / DT) as usize {
        pas(&mut c, DT, gaz, &REGLAGES);
    }
    assert!(c.speed <= PLAFOND + 1e-3 && c.speed * 3.6 > 590.0, "{}", c.speed * 3.6);
    // le drift y part tout seul, volant a fond
    let mut d = Car::new();
    d.vz = 60.0;
    for _ in 0..(1.5 / DT) as usize {
        pas(&mut d, DT, Input { steer: 1.0, ..gaz }, &REGLAGES);
    }
    assert!(d.sliding, "dans le classique, braquer fort fait decrocher");
}

#[test]
fn f1_bascule_dans_les_deux_sens() {
    let mut g = Game::new(Track::build());
    g.phase = Phase::Running;
    g.classique = true;
    g.input = Input { throttle: 1.0, ..Input::default() };
    for _ in 0..60 {
        g.tick();
    }
    let vite = g.car.speed;
    let mut h = Game::new(Track::build());
    h.phase = Phase::Running;
    h.input = Input { throttle: 1.0, ..Input::default() };
    for _ in 0..60 {
        h.tick();
    }
    println!("apres 0,5 s : classique {:.0} km/h, defaut {:.0} km/h", vite * 3.6, h.car.speed * 3.6);
    assert!(vite > h.car.speed * 5.0);
    g.classique = false;
    let v0 = g.car.speed;
    g.tick();
    assert!(g.car.speed - v0 < 0.2, "retour au defaut : plus que 14 m/s2 au plus");
}
