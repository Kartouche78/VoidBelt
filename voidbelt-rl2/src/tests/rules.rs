//! Regles du match : plots, demolitions, buts, chrono, bot.

use super::{drive, harvest, run, started, DT};
use crate::arena;
use crate::ball::{self, Ball};
use crate::boost::Field;
use crate::car::{self, Car};
use crate::collide;
use crate::game::{self, ev, Game, Phase};
use crate::vec::v2;

#[test]
fn but_valide_seulement_une_fois_la_ligne_franchie() {
    let bouche = arena::goal_mouth(true);
    let sur_la_ligne = v2(bouche - ball::RADIUS + 2.0, arena::CY);
    assert_eq!(arena::conceded(sur_la_ligne, ball::RADIUS), None);
    let dedans = v2(bouche - ball::RADIUS - 2.0, arena::CY);
    assert_eq!(arena::conceded(dedans, ball::RADIUS), Some(0));
    let hors_cage = v2(bouche - 40.0, arena::CY + arena::GOAL_HALF + 30.0);
    assert_eq!(arena::conceded(hors_cage, ball::RADIUS), None);
}

#[test]
fn le_plot_donne_du_boost_puis_se_recharge() {
    let mut f = Field::new();
    let (x, y, big) = crate::pads::PADS[0];
    let mut c = Car::new(0);
    c.pos = v2(x, y);
    c.boost = 0.0;
    let taken = f.collect(&mut c).expect("plot non ramasse");
    assert_eq!(c.boost, if big { 100.0 } else { 12.0 });
    c.boost = 0.0;
    assert!(f.collect(&mut c).is_none(), "ramasse deux fois de suite");
    f.tick(if big { 10.1 } else { 4.1 });
    assert!(f.collect(&mut c).is_some(), "plot {taken} jamais revenu");
}

#[test]
fn six_gros_plots_et_vingt_huit_petits() {
    let big = crate::pads::PADS.iter().filter(|p| p.2).count();
    assert_eq!((big, crate::pads::PADS.len()), (6, 34));
    for &(x, y, _) in crate::pads::PADS.iter() {
        assert!(x > arena::MIN_X && x < arena::MAX_X, "plot hors terrain en x: {x}");
        assert!(y > arena::MIN_Y && y < arena::MAX_Y, "plot hors terrain en y: {y}");
    }
}

#[test]
fn au_dela_de_cent_cinquante_le_choc_demolit() {
    let mut a = Car::new(0);
    let mut b = Car::new(1);
    a.pos = v2(arena::CX - 10.0, arena::CY);
    a.vel = v2(car::DEMO_SPEED + 6.0, 0.0);
    b.pos = v2(arena::CX + 10.0, arena::CY);
    let bump = collide::car_car(&mut a, &mut b).expect("pas de contact");
    assert!(bump.demo_b && !bump.demo_a, "mauvaise victime");
    assert!(b.demo > 0.0);
    for _ in 0..(120 * 4) {
        b.step(DT);
    }
    assert_eq!(b.demo, 0.0, "jamais reapparu");
}

#[test]
fn un_choc_lent_bouscule_sans_demolir() {
    let mut a = Car::new(0);
    let mut b = Car::new(1);
    a.pos = v2(arena::CX - 10.0, arena::CY);
    a.vel = v2(car::DEMO_SPEED - 30.0, 0.0);
    b.pos = v2(arena::CX + 10.0, arena::CY);
    let bump = collide::car_car(&mut a, &mut b).expect("pas de contact");
    assert!(!bump.any_demo(), "il demolit sous le seuil");
    assert!(b.vel.x > 60.0, "bourrade trop molle: {}", b.vel.x);
}

#[test]
fn un_frontal_lance_fait_sauter_les_deux() {
    let mut a = Car::new(0);
    let mut b = Car::new(1);
    a.pos = v2(arena::CX - 10.0, arena::CY);
    a.vel = v2(car::DEMO_SPEED + 40.0, 0.0);
    b.pos = v2(arena::CX + 10.0, arena::CY);
    b.vel = v2(-(car::DEMO_SPEED + 40.0), 0.0);
    let bump = collide::car_car(&mut a, &mut b).expect("pas de contact");
    assert!(bump.demo_a && bump.demo_b, "un survivant au frontal");
    assert!(a.demo > 0.0 && b.demo > 0.0);
}

#[test]
fn la_carcasse_reste_ou_elle_a_explose() {
    let mut a = Car::new(0);
    let mut b = Car::new(1);
    a.pos = v2(arena::CX - 10.0, arena::CY);
    a.vel = v2(car::SPEED_MAX, 0.0);
    b.pos = v2(arena::CX + 10.0, arena::CY);
    let ou = b.pos;
    collide::car_car(&mut a, &mut b).expect("pas de contact");
    // L'hote lit cette position pour y poser l'explosion : elle doit rester
    // sur les lieux, au degagement des chassis pres.
    assert!(b.pos.sub(ou).len() < car::HALF_LEN, "la carcasse a ete teleportee");
    assert!(b.demo > 0.0);
}

#[test]
fn une_voiture_demolie_ne_gene_plus_personne() {
    let mut a = Car::new(0);
    let mut b = Car::new(1);
    b.demolish();
    b.pos = v2(arena::CX, arena::CY);
    a.pos = v2(arena::CX, arena::CY);
    a.vel = v2(300.0, 0.0);
    assert!(collide::car_car(&mut a, &mut b).is_none(), "on percute une carcasse");
    let mut ball = Ball::new();
    ball.pos = v2(arena::CX, arena::CY);
    assert_eq!(collide::car_ball(&mut b, &mut ball), 0.0, "une carcasse frappe la balle");
}

#[test]
fn l_echauffement_laisse_jouer_sans_compter() {
    let mut g = Game::warmup(5, 300.0);
    assert_eq!(g.phase, Phase::Warmup);
    // On roule tout de suite, sans decompte.
    g.cars[0].input = drive(1.0, false);
    run(&mut g, 1.0);
    assert!(g.cars[0].speed() > 50.0, "on ne peut pas rouler au salon");
    assert!((g.clock - 300.0).abs() < 1e-3, "le chrono tourne deja");

    // Un but ne compte pas et la balle repart du centre, sans figer la scene.
    g.ball.pos = v2(arena::goal_mouth(false) - 4.0, arena::CY);
    g.ball.vel = v2(900.0, 0.0);
    run(&mut g, 0.3);
    assert_eq!(g.score, [0, 0], "le but a ete compte a l echauffement");
    assert_eq!(g.phase, Phase::Warmup, "la scene s est figee");
    assert!((g.ball.pos.x - arena::CX).abs() < 60.0, "balle non recentree");
}

#[test]
fn l_hote_lance_le_match_depuis_l_echauffement() {
    let mut g = Game::warmup(5, 300.0);
    run(&mut g, 2.0);
    g.begin();
    assert_eq!(g.phase, Phase::Countdown);
    run(&mut g, 4.2);
    assert_eq!(g.phase, Phase::Play);
    run(&mut g, 1.0);
    assert!(g.clock < 300.0, "le chrono ne demarre pas");

    // Retour au salon : tout est remis a plat.
    g.score = [3, 1];
    g.back_to_warmup();
    assert_eq!(g.phase, Phase::Warmup);
    assert_eq!(g.score, [0, 0]);
    assert!((g.clock - 300.0).abs() < 1e-3);
}

#[test]
fn le_salon_n_a_pas_de_machine_aux_commandes() {
    let mut g = Game::warmup(5, 300.0);
    assert!(!g.bot_on, "un bot pilote le siege du second joueur");
    let start = g.cars[1].pos;
    run(&mut g, 3.0);
    assert!(g.cars[1].pos.sub(start).len() < 1.0, "la voiture libre a bouge seule");
}

#[test]
fn l_engagement_d_ouverture_est_annonce() {
    // Il nait dans `Game::new`, hors d'un pas : sans report il serait efface
    // avant que l'hote ait pu lancer la piste du decompte.
    let mut g = Game::new(1, 1, 300.0);
    g.step(1.0 / 60.0);
    assert!(g.events.iter().any(|e| e.0 == ev::KICKOFF), "aucun engagement annonce");
    g.step(1.0 / 60.0);
    assert!(!g.events.iter().any(|e| e.0 == ev::KICKOFF), "annonce repetee");
}

#[test]
fn les_phases_collent_aux_pistes_sonores() {
    // L'habillage sonore se cale sur ces deux durees : la fete doit tenir
    // `goal.ogg` en entier, et le decompte s'entend jusqu'au coup d'envoi.
    // On les mesure ici plutot que de les recopier, pour que le jour ou une
    // piste change le test suive la constante au lieu de mentir.
    let mut g = Game::new(1, 1, 300.0);
    run(&mut g, game::COUNTDOWN - 0.1);
    assert_eq!(g.phase, Phase::Countdown, "decompte trop court");
    run(&mut g, 0.3);
    assert_eq!(g.phase, Phase::Play);

    g.ball.pos = v2(arena::goal_mouth(false) - 4.0, arena::CY);
    g.ball.vel = v2(900.0, 0.0);
    run(&mut g, 0.2);
    assert_eq!(g.phase, Phase::Goal);
    run(&mut g, game::CELEBRATE - 0.4);
    assert_eq!(g.phase, Phase::Goal, "fete trop courte pour l'ovation");
    run(&mut g, 0.5);
    assert_eq!(g.phase, Phase::Countdown);
}

#[test]
fn le_match_demarre_par_un_decompte() {
    let mut g = Game::new(1, 1, 300.0);
    assert_eq!(g.phase, Phase::Countdown);
    run(&mut g, 1.0);
    assert_eq!(g.phase, Phase::Countdown);
    assert!((g.clock - 300.0).abs() < 1e-3, "le chrono ne doit pas courir");
    run(&mut g, 3.4);
    assert_eq!(g.phase, Phase::Play);
}

#[test]
fn un_but_remet_en_jeu_au_centre() {
    let mut g = started(1);
    g.ball.pos = v2(arena::goal_mouth(false) - 4.0, arena::CY);
    g.ball.vel = v2(900.0, 0.0);
    let mut marque = false;
    for _ in 0..12 {
        g.step(1.0 / 60.0);
        marque |= g.events.iter().any(|e| e.0 == ev::GOAL);
    }
    assert!(marque, "aucun evenement de but emis");
    assert_eq!(g.score, [1, 0], "but bleu non compte");
    assert_eq!(g.phase, Phase::Goal);
    run(&mut g, 4.8);
    assert_eq!(g.phase, Phase::Countdown);
    assert!((g.ball.pos.x - arena::CX).abs() < 1e-3, "balle non recentree");
}

#[test]
fn score_nul_a_zero_le_match_part_en_prolongation() {
    let mut g = Game::new(3, 1, 4.0);
    run(&mut g, 15.0);
    assert!(g.overtime, "pas de prolongation sur egalite");
    assert_ne!(g.phase, Phase::Over);
}

#[test]
fn un_but_en_prolongation_termine_le_match() {
    let mut g = Game::new(3, 1, 4.0);
    run(&mut g, 15.0);
    assert!(g.overtime);
    g.ball.pos = v2(arena::goal_mouth(false) - 4.0, arena::CY);
    g.ball.vel = v2(900.0, 0.0);
    run(&mut g, 5.2);
    assert_eq!(g.phase, Phase::Over);
}

#[test]
fn le_chrono_epuise_conclut_un_match_non_nul() {
    let mut g = Game::new(3, 1, 4.0);
    run(&mut g, 4.2);
    g.score = [2, 1];
    run(&mut g, 6.0);
    assert_eq!(g.phase, Phase::Over);
}

#[test]
fn le_bot_va_chercher_la_balle() {
    let mut g = started(1);
    let start = g.cars[1].pos.sub(g.ball.pos).len();
    run(&mut g, 3.0);
    let now = g.cars[1].pos.sub(g.ball.pos).len();
    assert!(now < start * 0.6, "il n'avance pas: {start} -> {now}");
}

#[test]
fn le_bot_finit_par_marquer_contre_un_joueur_passif() {
    let mut g = started(2);
    for _ in 0..(60 * 60) {
        g.step(1.0 / 60.0);
        if g.score[1] > 0 {
            return;
        }
    }
    panic!("aucun but en une minute, score {:?}", g.score);
}

#[test]
fn le_bot_ne_marque_pas_contre_son_camp() {
    let mut g = started(2);
    for _ in 0..(90 * 60) {
        g.step(1.0 / 60.0);
        assert_eq!(g.score[0], 0, "csc du bot a {} s restantes", g.clock);
    }
}

#[test]
fn la_simulation_est_deterministe() {
    let run = || {
        let mut g = Game::new(42, 1, 300.0);
        for i in 0..900 {
            g.cars[0].input = drive(1.0, i % 3 == 0);
            g.step(1.0 / 60.0);
        }
        (g.ball.pos, g.cars[1].pos, g.score)
    };
    let a = run();
    let b = run();
    assert_eq!((a.0.x, a.0.y), (b.0.x, b.0.y));
    assert_eq!((a.1.x, a.1.y), (b.1.x, b.1.y));
    assert_eq!(a.2, b.2);
}

#[test]
fn le_tampon_d_etat_a_la_bonne_taille() {
    let g = Game::new(1, 1, 300.0);
    let mut out = vec![0.0; crate::state::STATE_LEN];
    crate::state::write_state(&g, &mut out);
    assert_eq!(crate::state::STATE_LEN, 32 + 34);
    assert_eq!(out[6], arena::CX);
    assert_eq!(crate::state::pad_table().len(), 34 * 3);
    assert_eq!(crate::state::geometry().len(), 17);
}

#[test]
fn un_degagement_sur_la_ligne_compte_comme_un_arret() {
    // Balle cadree, lancee vers le but bleu, et une voiture bleue qui vient
    // la chercher : c'est un arret.
    let mut g = started(0);
    let goal = arena::goal_mouth(true);
    g.ball.pos = v2(goal + 180.0, arena::CY + 10.0);
    g.ball.vel = v2(-700.0, 0.0);
    g.cars[0].pos = v2(goal + 150.0, arena::CY + 10.0);
    g.cars[0].vel = v2(300.0, 0.0);
    g.cars[0].yaw = 0.0;
    let seen = harvest(&mut g, 0.3);
    assert!(seen.iter().any(|e| e.0 == ev::SAVE), "aucun arret signale");
}

#[test]
fn une_balle_non_cadree_ne_donne_pas_d_arret() {
    // Meme geste, mais la balle filait a cote du poteau : c'est du jeu.
    let mut g = started(0);
    let goal = arena::goal_mouth(true);
    g.ball.pos = v2(goal + 180.0, arena::CY + arena::GOAL_HALF + 90.0);
    g.ball.vel = v2(-700.0, 0.0);
    g.cars[0].pos = v2(goal + 150.0, arena::CY + arena::GOAL_HALF + 90.0);
    g.cars[0].vel = v2(300.0, 0.0);
    g.cars[0].yaw = 0.0;
    let seen = harvest(&mut g, 0.3);
    assert!(!seen.iter().any(|e| e.0 == ev::SAVE), "arret signale a tort");
}

#[test]
fn un_arret_loin_du_but_n_en_est_pas_un() {
    // Cadree mais prise au milieu du terrain : trop loin pour un arret.
    let mut g = started(0);
    let goal = arena::goal_mouth(true);
    g.ball.pos = v2(goal + 700.0, arena::CY);
    g.ball.vel = v2(-700.0, 0.0);
    g.cars[0].pos = v2(goal + 670.0, arena::CY);
    g.cars[0].vel = v2(300.0, 0.0);
    g.cars[0].yaw = 0.0;
    let seen = harvest(&mut g, 0.3);
    assert!(!seen.iter().any(|e| e.0 == ev::SAVE), "arret signale au milieu");
}

#[test]
fn le_seuil_de_demolition_vaut_bien_cent_cinquante_au_compteur() {
    // Le HUD affiche `vitesse * 300 / SPEED_MAX`. Si l'un des deux bouge
    // sans l'autre, le seuil annonce au joueur cesse d'etre celui du moteur.
    let kmh = car::DEMO_SPEED * 300.0 / car::SPEED_MAX;
    assert!((kmh - 150.0).abs() < 0.5, "seuil a {kmh} km/h au lieu de 150");
}

#[test]
fn la_bousculade_pousse_celui_qui_l_encaisse() {
    // A fonce sur B a l'arret, sous le seuil : B part dans la direction du
    // choc, et A garde son elan au lieu de rebondir en arriere.
    let mut a = Car::new(0);
    let mut b = Car::new(1);
    a.pos = v2(500.0, 400.0);
    b.pos = v2(526.0, 400.0);
    a.vel = v2(car::DEMO_SPEED - 60.0, 0.0);
    b.vel = v2(0.0, 0.0);
    let bump = collide::car_car(&mut a, &mut b).expect("pas de contact");
    assert!(!bump.any_demo(), "il demolit sous le seuil");
    assert!(b.vel.x > 100.0, "la victime n'est pas poussee: {}", b.vel.x);
    assert!(a.vel.x > 0.0, "l'assaillant repart en arriere: {}", a.vel.x);
    assert!(b.vel.x > a.vel.x, "la victime doit partir devant l'assaillant");
}

#[test]
fn un_frontal_sous_le_seuil_repousse_les_deux_a_parts_egales() {
    let mut a = Car::new(0);
    let mut b = Car::new(1);
    a.pos = v2(500.0, 400.0);
    b.pos = v2(526.0, 400.0);
    let v = car::DEMO_SPEED - 80.0;
    a.vel = v2(v, 0.0);
    b.vel = v2(-v, 0.0);
    let bump = collide::car_car(&mut a, &mut b).expect("pas de contact");
    assert!(!bump.any_demo(), "il demolit sous le seuil");
    assert!(a.vel.x < 0.0 && b.vel.x > 0.0, "ils ne se repoussent pas");
    assert!(
        (a.vel.x + b.vel.x).abs() < 1.0,
        "repartition asymetrique: {} / {}",
        a.vel.x,
        b.vel.x
    );
}

#[test]
fn la_bousculade_reste_une_bousculade_juste_sous_le_seuil() {
    // Sans plafond, un choc a 149 km/h catapulterait la victime.
    let mut a = Car::new(0);
    let mut b = Car::new(1);
    a.pos = v2(500.0, 400.0);
    b.pos = v2(526.0, 400.0);
    a.vel = v2(car::DEMO_SPEED - 2.0, 0.0);
    b.vel = v2(0.0, 0.0);
    collide::car_car(&mut a, &mut b).expect("pas de contact");
    assert!(
        b.vel.x < car::DEMO_SPEED,
        "la victime part plus vite que l'assaillant: {}",
        b.vel.x
    );
}
