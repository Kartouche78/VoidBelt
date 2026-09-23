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
    assert!(arena::conceded(b.pos, ball::RADIUS, &arena::Cage::FACTORY).is_none(), "but accorde sur le poteau");
    assert!(b.vel.x > -600.0, "la balle n'a pas ete deviee");
}

/// Tire la balle depuis `depart` vers `cible` et la laisse vivre une
/// seconde. Rend la balle, et si le but a ete accorde en chemin.
fn tir(depart: crate::vec::V2, cible: crate::vec::V2, vitesse: f32) -> (Ball, bool) {
    let mut b = Ball::new();
    b.pos = depart;
    b.vel = cible.sub(depart).norm().mul(vitesse);
    let mut but = false;
    for _ in 0..120 {
        b.step(DT, &T);
        but |= arena::conceded(b.pos, ball::RADIUS, &arena::Cage::FACTORY).is_some();
    }
    (b, but)
}

/// Une balle qui mord franchement le poteau, de face, doit repartir vers
/// le terrain : pas glisser le long du montant jusqu'au fond du filet.
#[test]
fn un_tir_sur_le_poteau_ressort() {
    let bouche = arena::goal_mouth(true);
    let poteau = arena::CY + arena::GOAL_HALF;
    let (b, but) = tir(v2(bouche + 200.0, poteau - 8.0), v2(bouche, poteau - 8.0), 900.0);
    assert!(!but, "but accorde sur le poteau");
    assert!(b.vel.x > 0.0, "la balle n'est pas ressortie : {:?}", b.vel);
}

/// Un tir croise qui vient mourir sur le poteau depuis l'axe du but doit
/// ricocher vers le terrain, pas se glisser dans le filet.
#[test]
fn un_tir_en_biais_sur_le_poteau_ricoche() {
    let bouche = arena::goal_mouth(true);
    let poteau = arena::CY + arena::GOAL_HALF;
    let depart = v2(bouche + 250.0, poteau - 140.0);
    let (b, but) = tir(depart, v2(bouche, poteau - 6.0), 1000.0);
    assert!(!but, "but accorde sur le poteau");
    assert!(b.vel.x > 0.0, "la balle n'est pas ressortie : {:?}", b.vel);
}

/// Un tir qui passe au ras du poteau sans le toucher reste un but.
#[test]
fn un_tir_au_ras_du_poteau_rentre() {
    let bouche = arena::goal_mouth(true);
    let y = arena::CY + arena::GOAL_HALF - ball::RADIUS - 3.0;
    let (_, but) = tir(v2(bouche + 200.0, y), v2(bouche, y), 900.0);
    assert!(but, "un tir cadre a ete refuse");
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

/// La balle doit rouler sans glisser : le point de contact avec le sol
/// reste immobile. C'est cette contrainte qui fixe l'axe et la vitesse de
/// rotation, et une balle qui tourne a l'envers se voit tout de suite.
#[test]
fn la_balle_roule_dans_le_bon_sens() {
    use crate::ball::Ball;
    let t = crate::tune::Tune::default();
    let mut b = Ball::new();
    // Lancee vers la droite : le sommet doit partir vers la droite aussi.
    b.vel = crate::vec::v2(200.0, 0.0);
    let avant = b.spin;
    b.step(1.0 / 60.0, &t);
    assert_ne!(b.spin, avant, "la balle ne tourne pas");

    // On fait tourner le sommet (0, 0, r) par le quaternion obtenu, puis on
    // regarde de quel cote il est parti. Repere du dessin : x a droite.
    let q = b.spin;
    let r = t.ball_radius;
    // v' = q * (0,0,r) * conj(q), developpe pour un vecteur pur.
    let (x, y, z, w) = (q.x, q.y, q.z, q.w);
    let sommet_x = 2.0 * (x * z + w * y) * r;
    assert!(
        sommet_x > 0.0,
        "le sommet part vers la gauche : la balle roule a l'envers ({sommet_x})",
    );

    // Immobile, elle ne doit plus tourner du tout.
    b.vel = crate::vec::V2::ZERO;
    let fige = b.spin;
    b.step(1.0 / 60.0, &t);
    assert_eq!(b.spin, fige, "elle tourne encore a l'arret");
}

/// Coincement contre un muret : la balle plaquee contre la paroi, une
/// voiture lancee dessus, elle doit repartir le long du mur bien plus vite
/// qu'une frappe ordinaire.
#[test]
fn le_coincement_propulse_la_balle() {
    use crate::{ball::Ball, car::Car, collide, vec::v2};
    let t = crate::tune::Tune::default();

    // Reference : la meme voiture, meme vitesse, mais en plein terrain.
    let mut libre_b = Ball::new();
    let mut libre_c = Car::new(0);
    libre_b.pos = v2(arena::CX, arena::CY);
    libre_c.pos = v2(arena::CX, arena::CY + t.car_half_wid + t.ball_radius - 2.0);
    libre_c.vel = v2(0.0, -500.0);
    collide::car_ball(&mut libre_c, &mut libre_b, &t);
    let sans_mur = libre_b.vel.len();

    // Coincement : la balle contre le muret du haut, la voiture qui monte.
    let mut b = Ball::new();
    let mut c = Car::new(0);
    b.pos = v2(arena::CX, arena::MIN_Y + t.ball_radius - 1.0);
    c.pos = v2(arena::CX, b.pos.y + t.car_half_wid + t.ball_radius - 2.0);
    c.vel = v2(60.0, -500.0);
    collide::car_ball(&mut c, &mut b, &t);
    let mur = arena::contact(b.pos, t.ball_radius, t.arena_corner, &t.cage())
        .expect("la balle devrait toucher le muret");
    let fuite = collide::pinch(&c, &mut b, &mur, &t);

    assert!(sans_mur > 1.0, "la frappe de reference n'a pas touche : test creux");
    assert!(fuite > 0.0, "aucun coincement declenche");
    assert!(
        b.vel.len() > sans_mur * 1.5,
        "a peine mieux qu'une frappe libre : {} contre {sans_mur}",
        b.vel.len(),
    );
    // Elle repart le long du muret, pas dedans ni en arriere.
    assert!(b.vel.x.abs() > b.vel.y.abs(), "elle ne longe pas la paroi");
    assert!(b.vel.y > 0.0, "elle repart dans le mur");
    assert!(b.vel.len() <= t.ball_max_speed + 0.01, "au-dela du plafond");
}

/// Longer un muret ne doit rien declencher : sans fermeture du coin, il n'y
/// a pas de coincement, juste une balle poussee.
#[test]
fn longer_le_mur_ne_coince_pas() {
    use crate::{ball::Ball, car::Car, collide, vec::v2};
    let t = crate::tune::Tune::default();
    let mut b = Ball::new();
    let mut c = Car::new(0);
    b.pos = v2(arena::CX, arena::MIN_Y + t.ball_radius - 1.0);
    c.pos = v2(arena::CX - t.car_half_len - t.ball_radius + 2.0, b.pos.y);
    // Vitesse parallele au muret : rien ne se referme.
    c.vel = v2(600.0, 0.0);
    collide::car_ball(&mut c, &mut b, &t);
    let mur = arena::contact(b.pos, t.ball_radius, t.arena_corner, &t.cage())
        .expect("la balle devrait toucher le muret");
    assert_eq!(
        collide::pinch(&c, &mut b, &mur, &t),
        0.0,
        "un mur longe ne devrait pas coincer",
    );
}

/// Une balle poussee le long d'un muret frotte contre la voiture a chaque
/// image : elle ne doit faire entendre qu'un seul choc, pas une rafale.
#[test]
fn pousser_la_balle_le_long_du_mur_ne_sonne_qu_une_fois() {
    use crate::game::ev;
    let mut g = super::started(0);
    g.bot_on = false;
    let r = g.tune.ball_radius;
    g.ball.pos = v2(arena::CX, arena::MIN_Y + r);
    g.ball.vel = v2(0.0, 0.0);
    g.cars[0].pos = v2(arena::CX - g.tune.car_half_len - r - 4.0, g.ball.pos.y);
    g.cars[0].yaw = 0.0;
    g.cars[0].vel = v2(150.0, -20.0);
    let mut chocs = 0;
    for _ in 0..(1.5 / DT) as usize {
        // La voiture colle au mur et pousse : la balle ne s'en detache pas.
        g.cars[0].input = drive(0.6, false);
        g.step(DT);
        chocs += g.events.iter().filter(|e| e.0 == ev::HIT).count();
    }
    assert_eq!(chocs, 1, "le frottement contre le mur rejoue le choc");
}

/// La forme des buts suit les reglages du stade : une cage plus ouverte
/// accepte un tir que celle d'usine renvoie sur le poteau.
#[test]
fn la_cage_suit_les_reglages_du_stade() {
    let bouche = arena::goal_mouth(true);
    let y = arena::CY + arena::GOAL_HALF - 8.0;
    let tirer = |t: &crate::tune::Tune| {
        let mut b = Ball::new();
        b.pos = v2(bouche + 200.0, y);
        b.vel = v2(-900.0, 0.0);
        (0..120).any(|_| {
            b.step(DT, t);
            arena::conceded(b.pos, ball::RADIUS, &t.cage()).is_some()
        })
    };
    assert!(!tirer(&T), "la cage d'usine devait renvoyer ce tir");
    let mut large = T;
    large.goal_half = arena::GOAL_HALF + 40.0;
    assert!(tirer(&large), "la cage elargie a refuse le tir");
}

/// Premier rebond d'une balle lancee de `depart` a la vitesse `vel`.
fn premier_rebond(depart: crate::vec::V2, vel: crate::vec::V2) -> ball::Rebond {
    let mut b = Ball::new();
    b.pos = depart;
    b.vel = vel;
    (0..120)
        .map(|_| b.step(DT, &T))
        .find(|r| r.force > 0.0)
        .expect("aucun rebond")
}

/// Le poteau se reconnait : c'est lui qui aura son bruit, pas le muret.
#[test]
fn le_poteau_se_distingue_du_muret() {
    let bouche = arena::goal_mouth(true);
    let poteau = arena::CY + arena::GOAL_HALF;
    let sur_le_poteau = premier_rebond(v2(bouche + 200.0, poteau), v2(-900.0, 0.0));
    assert!(sur_le_poteau.poteau, "le poteau n'a pas ete reconnu");
    let sur_le_muret = premier_rebond(v2(bouche + 200.0, poteau + 120.0), v2(-900.0, 0.0));
    assert!(!sur_le_muret.poteau, "le muret passe pour un poteau");
    let au_fond = premier_rebond(v2(bouche - 10.0, arena::CY), v2(-900.0, 0.0));
    assert!(!au_fond.poteau, "le fond du filet passe pour un poteau");
}

/// Le poteau s'epaissit vers la bouche du but, jamais vers le terrain :
/// une balle qui longe la ligne du muret ne le touche pas, une balle qui
/// frole la joue a deux unites pres le touche.
#[test]
fn le_poteau_affleure_le_muret_et_mord_sur_la_bouche() {
    let cage = arena::Cage::FACTORY;
    let r = ball::RADIUS;
    let bouche = arena::goal_mouth(true);
    let poteau = arena::CY + cage.half;
    // Cote terrain, au ras de la ligne du muret, a hauteur du poteau.
    for dy in [0.0, 3.0, 6.0, 9.0, 12.0] {
        let p = v2(bouche + r + 0.1, poteau + dy);
        assert!(
            arena::contact(p, r, T.arena_corner, &cage).is_none(),
            "le poteau deborde sur le terrain a {dy}",
        );
    }
    // Dans le filet, a une unite de la joue : c'est la surepaisseur qui
    // la renvoie, en face du centre du poteau.
    let p = v2(bouche - cage.post - arena::POST_BULGE, poteau - r - 1.0);
    let h = arena::contact(p, r, T.arena_corner, &cage).expect("la surepaisseur ne mord pas");
    assert!(h.post, "ce n'est pas le poteau qui a renvoye la balle");
}
