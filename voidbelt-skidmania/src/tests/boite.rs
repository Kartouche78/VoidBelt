//! La boite, sur la vraie voiture : pied au plancher, boost, freinage.

use crate::boite::{vitesse_de_pointe, Boite, Entree, RAPTOR};
use crate::car::{Car, Input};
use crate::tune::TUNING;

const DT: f32 = 1.0 / 120.0;

fn boite() -> Boite {
    Boite::new(RAPTOR, vitesse_de_pointe(&TUNING))
}

fn pas(car: &mut Car, b: &mut Boite, inp: Input) {
    car.update(DT, inp, &TUNING);
    b.maj(Entree { vitesse: car.vf, gaz: inp.throttle, frein: inp.brake, boost: car.boosting, ..Entree::default() }, DT);
}

/// Roule `secs` en ligne droite ; rend (rapport max, regime max, montees
/// suivies d'une vraie chute de regime).
fn roule(car: &mut Car, b: &mut Boite, secs: f32, inp: Input) -> (i32, f32, u32) {
    let (mut gmax, mut rmax, mut chutes) = (0, 0.0f32, 0);
    for _ in 0..(secs / DT) as usize {
        let avant = (b.rapport, b.rpm);
        pas(car, b, inp);
        if b.rapport > avant.0 && avant.0 >= 1 {
            // le regime doit retomber pendant le passage
            let (mut c2, mut b2) = (car.clone(), b.clone());
            for _ in 0..(RAPTOR.temps_passage / DT) as usize {
                pas(&mut c2, &mut b2, inp);
            }
            if b2.rpm < avant.1 * 0.95 {
                chutes += 1;
            }
        }
        gmax = gmax.max(b.rapport);
        rmax = rmax.max(b.rpm);
    }
    (gmax, rmax, chutes)
}

#[test]
fn pied_au_plancher_on_passe_tous_les_rapports_sans_rupteur() {
    let (mut car, mut b) = (Car::new(), boite());
    // la courbe Stadium Car (README-CONDUITE) atteint la 6e vers 525 km/h,
    // une trentaine de secondes pied au plancher sur le plat
    let (g, rmax, chutes) = roule(&mut car, &mut b, 45.0, Input { throttle: 1.0, ..Input::default() });
    println!("plancher : rapport max {g}, regime max {rmax:.0}, {chutes} passages, {:.0} km/h a {:.0} tr/min", car.speed * 3.6, b.rpm);
    assert_eq!(g, 6, "le dernier rapport doit etre atteint");
    assert_eq!(chutes, 5, "cinq montees, chacune avec sa chute de regime");
    assert!(rmax < RAPTOR.zone_rouge * 0.995, "pas de rupteur a fond sans boost");
    let haut = b.rpm / RAPTOR.zone_rouge;
    // le dernier rapport est le plus long possible : a la vitesse max, le
    // moteur tourne juste au-dessus du seuil de retrogradage (0,45)
    assert!((0.46..0.56).contains(&haut), "en 6e a pleine vitesse : {haut} de la zone rouge");
}

#[test]
fn le_boost_reste_sous_la_zone_rouge() {
    let (mut car, mut b) = (Car::new(), boite());
    roule(&mut car, &mut b, 15.0, Input { throttle: 1.0, ..Input::default() });
    car.boost = 1.0;
    let (_, rmax, _) = roule(&mut car, &mut b, 2.2, Input { throttle: 1.0, boost: true, ..Input::default() });
    println!("boost : {:.0} km/h, regime max {rmax:.0}", car.speed * 3.6);
    assert_eq!(b.rapport, 6);
    assert!(rmax <= RAPTOR.zone_rouge, "{rmax}");
}

#[test]
fn au_freinage_on_retrograde_jusqu_en_premiere() {
    let (mut car, mut b) = (Car::new(), boite());
    roule(&mut car, &mut b, 12.0, Input { throttle: 1.0, ..Input::default() });
    let haut = b.rapport;
    // freine jusqu'a l'arret (au-dela, le frein passe la marche arriere)
    while car.vf > 0.5 {
        pas(&mut car, &mut b, Input { brake: 1.0, ..Input::default() });
    }
    roule(&mut car, &mut b, 1.0, Input::default());
    println!("freinage : de {haut} a {} ({:.1} m/s, {:.0} tr/min)", b.rapport, car.speed, b.rpm);
    assert_eq!(b.rapport, 1);
    assert!(b.rpm < RAPTOR.ralenti * 1.5);
}

#[test]
fn au_lever_de_pied_le_frein_moteur_coupe_l_injection() {
    let (mut car, mut b) = (Car::new(), boite());
    roule(&mut car, &mut b, 6.0, Input { throttle: 1.0, ..Input::default() });
    roule(&mut car, &mut b, 0.3, Input::default());
    assert!(b.lever && b.coupure);
}

#[test]
fn au_point_mort_le_moteur_monte_et_redescend() {
    let mut b = boite();
    for _ in 0..120 {
        b.maj(Entree { gaz: 1.0, point_mort: true, ..Entree::default() }, DT);
    }
    let haut = b.rpm;
    for _ in 0..240 {
        b.maj(Entree { point_mort: true, ..Entree::default() }, DT);
    }
    assert_eq!(b.rapport, 0);
    assert!(haut > RAPTOR.zone_rouge * 0.6, "{haut}");
    assert!(b.rpm < RAPTOR.ralenti * 1.1, "{}", b.rpm);
}

#[test]
fn le_rapport_suit_la_vitesse_de_la_voiture() {
    // a chaque instant de l'acceleration, le rapport engage est celui que
    // la vitesse appelle (a un rapport pres, le temps d'un passage).
    // Depuis le plafond de 600 km/h, la boite s'etage sur 600 : ses deux
    // premiers rapports sont si courts que, depart arrete, la voiture les
    // franchit plus vite que le regime ne monte (0 a 440 km/h en une
    // seconde). On tolere donc deux rapports de retard pendant cette
    // premiere seconde, un seul ensuite.
    let (mut car, mut b) = (Car::new(), boite());
    let inp = Input { throttle: 1.0, ..Input::default() };
    let (mut lancer, mut pire) = (0, 0);
    for i in 0..(8.0 / DT) as usize {
        pas(&mut car, &mut b, inp);
        let ideal = (1..=6).find(|&g| car.vf * b.k(g) < RAPTOR.zone_rouge * RAPTOR.passage).unwrap_or(6);
        if (i as f32) * DT < 1.0 {
            lancer = lancer.max(ideal - b.rapport);
        } else {
            pire = pire.max(ideal - b.rapport);
        }
    }
    assert!(lancer <= 2, "au lancer, la boite a eu jusqu'a {lancer} rapports de retard");
    assert!(pire <= 1, "la boite a eu jusqu'a {pire} rapports de retard");
}
