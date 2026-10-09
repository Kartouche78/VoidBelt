//! Sauts, airbrake et receptions (README-CONDUITE, verification 5), sur le
//! saut du circuit, avant l'arrivee.

use crate::car::Input;
use crate::game::{Event, Game};
use crate::track::Track;

/// Partie lancee a `v` m/s sur la ligne droite du tremplin, 85 m avant le
/// trou du saut.
fn avant_le_saut(v: f32) -> Game {
    let mut g = Game::new(Track::build());
    let (debut, _) = g.track.trous[0];
    g.seek(debut - 85.0, v);
    g
}

/// Roule jusqu'a la reception ou la chute ; rend les evenements de vol.
fn saute(g: &mut Game, inp: impl Fn(&Game) -> Input) -> Vec<Event> {
    let mut evs = vec![];
    for _ in 0..(15.0 * 120.0) as usize {
        g.input = inp(g);
        g.tick();
        for e in g.events.drain(..) {
            if matches!(e, Event::Decollage | Event::Reception(..) | Event::Respawn) {
                evs.push(e);
            }
        }
        if evs.iter().any(|e| matches!(e, Event::Reception(..) | Event::Respawn)) {
            break;
        }
    }
    evs
}

#[test]
fn le_saut_decolle_vole_et_se_repose_apres_le_trou() {
    let mut g = avant_le_saut(130.0);
    let (_, fin) = g.track.trous[0];
    let evs = saute(&mut g, |_| Input { throttle: 1.0, ..Input::default() });
    assert_eq!(evs.first(), Some(&Event::Decollage), "{evs:?}");
    let Some(Event::Reception(vn, travers)) = evs.last().copied() else { panic!("pas de reception : {evs:?}") };
    println!("reception a s = {:.0} (fin du trou {fin:.0}), {vn:.1} m/s absorbes, travers {travers:.2}, {:.0} km/h", g.car.z, g.car.speed * 3.6);
    assert!(g.car.z >= fin, "la voiture s'est posee dans le trou");
    assert!(travers < 0.1, "un saut droit se pose aligne");
    assert!(g.car.speed > 110.0, "une reception alignee garde sa vitesse : {}", g.car.speed);
    assert!(g.vol.is_none());
}

#[test]
fn en_vol_pas_de_propulsion_et_l_airbrake_fige_la_rotation_pas_le_vol() {
    let mut g = avant_le_saut(130.0);
    while g.vol.is_none() {
        g.input = Input { throttle: 1.0, ..Input::default() };
        g.tick();
    }
    // on lance une rotation, puis airbrake
    g.vol.as_mut().unwrap().tangage = 1.5;
    let v0 = g.vol.unwrap().vel;
    for _ in 0..30 {
        g.input = Input { throttle: 1.0, brake: 1.0, ..Input::default() };
        g.tick();
    }
    let v = g.vol.expect("toujours en vol");
    println!("airbrake : tangage {:.3} rad/s, vitesse horizontale {:.1} -> {:.1}", v.tangage, v0.x.hypot(v0.z), v.vel.x.hypot(v.vel.z));
    assert!(v.tangage.abs() < 0.2, "l'airbrake doit freiner le tangage");
    // la translation continue : gravite seule, aucune poussee
    assert!((v.vel.x.hypot(v.vel.z) - v0.x.hypot(v0.z)).abs() < 0.01);
    assert!(v.vel.y < v0.y);
}

#[test]
fn une_reception_de_travers_coute_de_la_vitesse() {
    let mut droit = avant_le_saut(130.0);
    saute(&mut droit, |_| Input { throttle: 1.0, ..Input::default() });
    let mut travers = avant_le_saut(130.0);
    while travers.vol.is_none() {
        travers.input = Input { throttle: 1.0, ..Input::default() };
        travers.tick();
    }
    // un coup de volant bref fait tourner la voiture en l'air
    let evs = saute(&mut travers, |g| {
        let tourne = g.vol.map(|v| v.duree < 0.5).unwrap_or(false);
        Input { steer: if tourne { 1.0 } else { 0.0 }, ..Input::default() }
    });
    let Some(Event::Reception(_, k)) = evs.last().copied() else { panic!("{evs:?}") };
    println!("travers {k:.2} : {:.0} km/h contre {:.0} droit", travers.car.speed * 3.6, droit.car.speed * 3.6);
    assert!(k > 0.1);
    assert!(travers.car.speed < droit.car.speed * 0.95);
}

#[test]
fn trop_lent_la_voiture_tombe_et_revient_au_checkpoint() {
    let mut g = avant_le_saut(30.0);
    let evs = saute(&mut g, |_| Input::default());
    println!("trop lent : {evs:?}");
    assert!(evs.contains(&Event::Respawn), "{evs:?}");
    assert!(g.vol.is_none());
}
