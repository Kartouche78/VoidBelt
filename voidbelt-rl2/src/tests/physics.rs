//! Conduite, drift, murs et contacts : le comportement physique.

use super::{along_wall, drive, hard_turn, on_bench, DT, T};
use crate::arena;
use crate::ball::{self, Ball};
use crate::car::{self, Car, Input};
use crate::collide;
use crate::vec::v2;

#[test]
fn accelere_jusqu_au_plafond_sans_boost() {
    let mut c = Car::new(0);
    c.input = drive(1.0, false);
    on_bench(&mut c, 600);
    let v = c.speed();
    assert!(v > car::DRIVE_MAX * 0.97, "trop lent: {v}");
    assert!(v <= car::DRIVE_MAX + 1.0, "depasse le plafond sans boost: {v}");
}

#[test]
fn le_boost_depasse_le_plafond_et_se_consomme() {
    let mut c = Car::new(0);
    c.boost = 100.0;
    c.input = drive(1.0, true);
    on_bench(&mut c, 360);
    assert!(c.speed() > car::DRIVE_MAX + 40.0, "pas de gain: {}", c.speed());
    assert!(c.speed() <= car::SPEED_MAX + 1.0);
    assert!(c.boost < 100.0 && c.boost > 0.0, "consommation: {}", c.boost);
}

#[test]
fn le_supersonique_retombe_en_roue_libre() {
    let mut c = Car::new(0);
    c.boost = 100.0;
    c.input = drive(1.0, true);
    on_bench(&mut c, 240);
    let fast = c.speed();
    c.input = drive(0.0, false);
    c.step(DT, &T);
    assert!(c.speed() < fast, "la vitesse doit decroitre");
    assert!(c.speed() > car::DRIVE_MAX, "coupure trop brutale");
}

#[test]
fn immobile_la_voiture_ne_pivote_pas() {
    let mut c = Car::new(0);
    let yaw = c.yaw;
    c.input = Input { throttle: 0.0, brake: 0.0, steer: 1.0, boost: false, drift: false };
    for _ in 0..120 {
        c.step(DT, &T);
    }
    assert!((c.yaw - yaw).abs() < 1e-3, "elle tourne sur place");
}

#[test]
fn en_marche_arriere_le_braquage_s_inverse() {
    let mut avant = Car::new(0);
    let mut arriere = Car::new(0);
    avant.input = Input { throttle: 1.0, brake: 0.0, steer: 1.0, boost: false, drift: false };
    arriere.input = Input { throttle: 0.0, brake: 1.0, steer: 1.0, boost: false, drift: false };
    for _ in 0..120 {
        avant.step(DT, &T);
        arriere.step(DT, &T);
    }
    assert!(avant.yaw > 0.05, "pas de virage en avant: {}", avant.yaw);
    assert!(arriere.yaw < -0.05, "pas de contre-braquage: {}", arriere.yaw);
}

/// Deux voitures lancees a fond au centre, braquage a fond, l'une en appui

#[test]
fn le_drift_serre_le_virage() {
    let (grip, drift) = hard_turn(60);
    assert!(drift.yaw > grip.yaw, "drift {} vs appui {}", drift.yaw, grip.yaw);
}

#[test]
fn le_drift_met_vraiment_la_voiture_en_travers() {
    let (grip, drift) = hard_turn(90);
    // En appui la trajectoire colle au nez ; en drift elle part de cote.
    assert!(grip.slip().abs() < 0.3, "ca glisse deja sans drift: {}", grip.slip());
    assert!(drift.slip().abs() > 0.45, "aucune glisse en drift: {}", drift.slip());
    assert!(drift.slip().abs() < 1.3, "la voiture part en toupie: {}", drift.slip());
}

#[test]
fn en_marche_arriere_la_derive_reste_nulle() {
    let mut c = Car::new(0);
    c.input = Input { throttle: 0.0, brake: 1.0, steer: 0.0, boost: false, drift: false };
    for _ in 0..240 {
        c.step(DT, &T);
        c.pos = v2(arena::CX, arena::CY);
    }
    assert!(c.speed() > 50.0, "elle ne recule pas");
    assert!(c.slip().abs() < 0.1, "reculer ne doit pas compter comme une glisse: {}", c.slip());
}

#[test]
fn le_drift_coute_de_la_vitesse() {
    let (grip, drift) = hard_turn(90);
    assert!(drift.speed() < grip.speed(), "{} vs {}", drift.speed(), grip.speed());
}

#[test]
fn sans_drift_la_voiture_suit_son_nez() {
    let mut c = Car::new(0);
    c.input = drive(1.0, false);
    on_bench(&mut c, 600);
    c.input = Input { throttle: 1.0, brake: 0.0, steer: 0.35, boost: false, drift: false };
    for _ in 0..120 {
        c.step(DT, &T);
        c.pos = v2(arena::CX, arena::CY);
    }
    assert!(c.slip().abs() < 0.16, "elle sous-vire en appui: {}", c.slip());
}

#[test]
fn la_voiture_reste_dans_l_enceinte() {
    let mut c = Car::new(0);
    c.boost = 1e9;
    c.input = Input { throttle: 1.0, brake: 0.0, steer: 0.4, boost: true, drift: false };
    for _ in 0..3000 {
        c.step(DT, &T);
        let dedans = c.pos.x > arena::goal_mouth(true) - arena::GOAL_DEPTH - 30.0
            && c.pos.x < arena::goal_mouth(false) + arena::GOAL_DEPTH + 30.0
            && c.pos.y > arena::MIN_Y - 30.0
            && c.pos.y < arena::MAX_Y + 30.0;
        assert!(dedans, "sortie du stade en {:?}", (c.pos.x, c.pos.y));
    }
}

#[test]
fn colle_au_muret_la_voiture_continue_de_rouler() {
    // Bien parallele : le mur ne doit rien couter du tout.
    let (v, free) = along_wall(0.0, 240);
    assert!(v > free * 0.97, "frein fantome le long du mur: {v} vs {free}");
}

#[test]
fn le_muret_redresse_la_voiture_au_lieu_de_la_bloquer() {
    // Nez bien rentre dans le muret, gaz maintenus : au bout d'une seconde
    // elle doit longer la paroi et non y rester collee.
    let (v, free) = along_wall(0.7, 180);
    assert!(v > free * 0.7, "elle se bloque contre le muret: {v} vs {free}");
}

#[test]
fn meme_de_face_le_muret_ne_cloue_pas_la_voiture() {
    let mut c = Car::new(0);
    c.input = drive(1.0, false);
    on_bench(&mut c, 600);
    let free = c.speed();
    // Cap plein sud, pile dans le mur du bas.
    c.pos = v2(arena::CX, arena::MAX_Y - crate::car::RADIUS - 1.0);
    c.yaw = std::f32::consts::FRAC_PI_2;
    c.vel = crate::vec::V2::dir(c.yaw).mul(free);
    for _ in 0..360 {
        c.step(DT, &T);
        assert!(c.pos.y <= arena::MAX_Y + 0.5, "elle traverse le muret");
    }
    assert!(c.speed() > free * 0.5, "toujours plantee apres 3 s: {}", c.speed());
    // Peu importe de quel cote elle s'est degagee : ce qui compte est
    // qu'elle ne pousse plus dans la paroi.
    let into = crate::vec::V2::dir(c.yaw).y;
    assert!(into < 0.5, "le nez pousse encore dans le muret: {}", c.yaw);
}

#[test]
fn la_balle_rebondit_sur_le_mur_du_fond() {
    let mut b = Ball::new();
    b.pos = v2(arena::CX, arena::MIN_Y + 20.0);
    b.vel = v2(0.0, -400.0);
    for _ in 0..30 {
        b.step(DT, &T);
    }
    assert!(b.vel.y > 0.0, "pas de rebond");
    assert!(b.pos.y >= arena::MIN_Y, "la balle a traverse le mur");
}

#[test]
fn la_balle_ralentit_toute_seule() {
    // Rocket League freine tres peu la balle : une trainee de 0,0306 par
    // seconde, soit environ 3 % de vitesse perdue en une seconde. On verifie
    // l'ordre de grandeur plutot qu'un chiffre, pour que le test suive le
    // reglage si on le change.
    let mut b = Ball::new();
    b.vel = v2(500.0, 0.0);
    for _ in 0..120 {
        b.step(DT, &T);
    }
    let attendu = 500.0 * (-T.ball_drag).exp();
    assert!(
        (b.vel.x - attendu).abs() < 2.0,
        "apres une seconde : {} au lieu de {attendu}",
        b.vel.x,
    );
    assert!(b.vel.x > 470.0, "la balle freine bien trop : {}", b.vel.x);
}

#[test]
fn le_poteau_renvoie_la_balle() {
    let mut b = Ball::new();
    b.pos = v2(arena::goal_mouth(true) + 40.0, arena::CY + arena::GOAL_HALF - 2.0);
    b.vel = v2(-600.0, 0.0);
    for _ in 0..60 {
        b.step(DT, &T);
    }
    assert!(arena::conceded(b.pos, ball::RADIUS).is_none(), "but accorde sur le poteau");
    assert!(b.vel.x > -600.0, "la balle n'a pas ete deviee");
}

#[test]
fn la_balle_ressort_du_filet() {
    let mut b = Ball::new();
    let fond = arena::goal_mouth(true) - arena::GOAL_DEPTH;
    b.pos = v2(fond + 20.0, arena::CY);
    b.vel = v2(-800.0, 0.0);
    for _ in 0..40 {
        b.step(DT, &T);
    }
    assert!(b.pos.x >= fond - 1.0, "traverse le fond du filet");
    assert!(b.vel.x > 0.0, "pas de rebond au fond");
}

#[test]
fn une_frappe_rapide_envoie_plus_loin_qu_une_lente() {
    let mut vite = 0.0;
    let mut lent = 0.0;
    for (speed, out) in [(560.0f32, &mut vite), (120.0f32, &mut lent)] {
        let mut c = Car::new(0);
        c.pos = v2(arena::CX - 60.0, arena::CY);
        c.vel = v2(speed, 0.0);
        let mut b = Ball::new();
        b.pos = v2(arena::CX - 60.0 + car::HALF_LEN + ball::RADIUS - 2.0, arena::CY);
        assert!(collide::car_ball(&mut c, &mut b, &T) > 0.0, "pas de contact");
        *out = b.vel.x;
    }
    assert!(vite > lent + 80.0, "vite {vite} / lent {lent}");
    assert!(lent > 0.0, "la balle doit partir vers l'avant");
}

#[test]
fn a_l_arret_la_voiture_ne_catapulte_pas_la_balle() {
    let mut c = Car::new(0);
    c.pos = v2(arena::CX, arena::CY);
    let mut b = Ball::new();
    b.pos = v2(arena::CX + car::HALF_LEN + ball::RADIUS - 3.0, arena::CY);
    collide::car_ball(&mut c, &mut b, &T);
    assert!(b.vel.len() < 20.0, "frappe fantome: {}", b.vel.len());
}
