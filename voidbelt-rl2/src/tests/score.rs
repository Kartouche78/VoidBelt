//! Points personnels : chacun les siens, et une action ne compte qu'une
//! fois par appui.

use super::{drive, started, DT};
use crate::arena;
use crate::game::{ev, Game};
use crate::vec::v2;

/// Balle posee devant la voiture 0, face au but adverse (a droite), et la
/// voiture 1 garee loin de l'action. Bot coupe : on pilote tout.
fn pousseur() -> Game {
    let mut g = started(0);
    g.bot_on = false;
    g.ball.pos = v2(arena::MAX_X - 330.0, arena::CY);
    g.ball.vel = v2(0.0, 0.0);
    g.cars[0].pos = v2(arena::MAX_X - 330.0 - g.tune.car_half_len - g.tune.ball_radius - 2.0, arena::CY);
    g.cars[0].yaw = 0.0;
    g.cars[0].vel = v2(120.0, 0.0);
    g.cars[1].pos = v2(arena::MIN_X + 120.0, arena::MIN_Y + 120.0);
    g
}

/// Pousser la balle jusqu'au but la touche a chaque image : c'est un tir,
/// pas des dizaines. Avant, 9 s de poussee en rapportaient 73.
#[test]
fn une_poussee_au_but_ne_compte_qu_un_tir() {
    let mut g = pousseur();
    let mut tirs = 0;
    for _ in 0..(1.5 / DT) as usize {
        g.cars[0].input = drive(0.5, false);
        g.step(DT);
        tirs += g.events.iter().filter(|e| e.0 == ev::SHOT).count();
    }
    let s = g.scoring.stats[0];
    assert!(s.shots <= 1, "{} tirs comptes pour une seule poussee", s.shots);
    assert_eq!(tirs as u32, s.shots, "evenements et compteur divergent");
}

/// Les compteurs sont a chacun : ce que fait la voiture 0 ne profite pas a
/// la voiture 1, et inversement.
#[test]
fn chaque_joueur_a_ses_propres_points() {
    let mut g = pousseur();
    for _ in 0..(1.5 / DT) as usize {
        g.cars[0].input = drive(0.5, false);
        g.step(DT);
    }
    let (a, b) = (g.scoring.stats[0], g.scoring.stats[1]);
    assert!(a.points > 0 && a.touches > 0, "la voiture 0 n'a rien marque : {a:?}");
    assert_eq!(b, Default::default(), "la voiture 1 a recu des points sans jouer : {b:?}");
}

/// La meme chose en salon, comme le serveur la simule : la voiture 1 reste
/// garee sur la trajectoire et la balle se coince contre elle. Son contact
/// continu ne doit pas relancer un tir a chaque image pour l'autre.
#[test]
fn une_balle_coincee_contre_un_adversaire_ne_multiplie_pas_les_tirs() {
    use crate::car::Input;
    let mut g = Game::warmup_with(7, 300.0, &[0, 1]);
    g.begin();
    for _ in 0..(9.0 / 0.016) as usize {
        g.set_input(0, Input { throttle: 1.0, brake: 0.0, steer: 0.0, boost: true, drift: false });
        g.set_input(1, Input::default());
        g.step(0.016);
    }
    let (a, b) = (g.scoring.stats[0], g.scoring.stats[1]);
    assert!(a.shots <= 3, "{} tirs pour une seule poussee", a.shots);
    assert!(a.points < 200, "{} points pour une seule poussee", a.points);
    assert_eq!(b.shots, 0, "la voiture 1, immobile, a tire");
}

/// Un but devie par un defenseur revient au dernier attaquant qui a touche
/// la balle. Ici l'orange, gare sur la trajectoire, la touche en dernier.
#[test]
fn un_but_devie_par_un_defenseur_revient_a_l_attaquant() {
    use crate::car::Input;
    let mut g = Game::warmup_with(7, 300.0, &[0, 1]);
    g.begin();
    let mut buteur = None;
    for _ in 0..(9.0 / 0.016) as usize {
        g.set_input(0, Input { throttle: 1.0, brake: 0.0, steer: 0.0, boost: true, drift: false });
        g.set_input(1, Input::default());
        g.step(0.016);
        if let Some(e) = g.events.iter().find(|e| e.0 == ev::SCORER) {
            buteur = Some(e.1 as usize);
        }
    }
    assert_eq!(g.score, [1, 0], "le but n'a pas ete marque");
    assert_eq!(buteur, Some(0), "le but n'est pas revenu a l'attaquant");
    assert_eq!(g.scoring.stats[0].goals, 1);
    assert_eq!(g.scoring.stats[1].goals, 0, "le defenseur s'est vu crediter le but");
}
