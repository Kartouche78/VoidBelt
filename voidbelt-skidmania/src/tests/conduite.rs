//! Conduite au sol (README-CONDUITE, verifications 1 a 4 et 11), sur la
//! voiture seule, route plate en asphalte, pas fixe de 1/120 s.

use crate::car::{Car, Input, PLAFOND};
use crate::game::{Game, Phase};
use crate::track::Track;
use crate::tune::TUNING;

const DT: f32 = 1.0 / 120.0;
const KMH: f32 = 3.6;

fn lance(v: f32) -> Car {
    let mut c = Car::new();
    c.vz = v;
    c.vf = v;
    c.speed = v;
    c
}

fn roule(c: &mut Car, secs: f32, inp: Input) {
    for _ in 0..(secs / DT).round() as usize {
        c.update(DT, inp, &TUNING);
    }
}

const GAZ: Input = Input { throttle: 1.0, brake: 0.0, steer: 0.0, handbrake: false, boost: false, look_back: false };

#[test]
fn l_acceleration_suit_la_courbe_et_approche_la_vitesse_max() {
    // l'acceleration mesuree colle a la courbe, etiree sur la vitesse max
    // sans boost : pas de trainee cachee
    let echelle = TUNING.vitesse_max / 600.0;
    for (kmh, attendu) in [(0.0, 14.0), (100.0, 12.0), (300.0, 6.0), (500.0, 2.0), (590.0, 0.3)] {
        let kmh = kmh * echelle;
        let mut c = lance(kmh / KMH);
        c.update(DT, GAZ, &TUNING);
        println!("{kmh} km/h : {:.2} m/s2", c.accel);
        assert!((c.accel - attendu).abs() < 0.15, "a {kmh} km/h : {} au lieu de {attendu}", c.accel);
    }
    let mut c = lance(0.0);
    let mut temps = [0.0f32; 3];
    let mut t = 0.0;
    while t < 120.0 {
        c.update(DT, GAZ, &TUNING);
        t += DT;
        for (i, seuil) in [100.0, 300.0, 500.0].iter().enumerate() {
            if temps[i] == 0.0 && c.speed * KMH >= *seuil {
                temps[i] = t;
            }
        }
    }
    println!("0-100 {:.1} s, 0-300 {:.1} s, 0-500 {:.1} s, {:.1} km/h apres 2 min", temps[0], temps[1], temps[2], c.speed * KMH);
    assert!(temps[0] > 1.5 && temps[0] < 3.0);
    let vmax = TUNING.vitesse_max;
    assert!(c.speed * KMH > vmax - 15.0, "sur le plat, la voiture doit approcher {vmax} km/h");
    assert!(c.speed * KMH <= vmax + 0.5, "sans boost, pas au-dela de la vitesse max");
    // au boost, elle monte jusqu'a la vitesse max au boost, pas plus
    c.boost = 1.0;
    for _ in 0..(10.0 / DT) as usize {
        c.boost = 1.0;
        c.update(DT, Input { boost: true, ..GAZ }, &TUNING);
    }
    println!("au boost : {:.1} km/h", c.speed * KMH);
    assert!(c.speed * KMH > TUNING.vitesse_max_boost - 10.0);
    assert!(c.speed <= TUNING.vmax_boost() + 1e-3 && c.speed <= PLAFOND + 1e-3);
    // boost relache : retour en douceur vers la vitesse max
    let haut = c.speed;
    c.update(DT, GAZ, &TUNING);
    assert!(c.speed < haut && haut - c.speed < 0.1);
}

#[test]
fn le_plafond_tient_au_boost_et_garde_la_direction() {
    let mut c = lance(160.0);
    c.vx = 20.0;
    c.boost = 1.0;
    let inp = Input { boost: true, ..GAZ };
    roule(&mut c, 2.0, inp);
    assert!(c.speed <= PLAFOND + 1e-3, "{} m/s", c.speed);
    // la norme est bornee, pas chaque axe : la glisse reste
    let mut d = lance(PLAFOND);
    d.vx = 30.0;
    let dir = d.vx.atan2(d.vz);
    d.update(DT, GAZ, &TUNING);
    assert!(d.speed <= PLAFOND + 1e-3);
    assert!((d.vx.atan2(d.vz) - dir).abs() < 0.05, "la direction a ete changee par le plafond");
}

#[test]
fn freiner_depuis_100_300_et_600() {
    for kmh in [100.0, 300.0, 600.0] {
        let mut c = lance(kmh / KMH);
        let mut dist = 0.0;
        let mut t = 0.0;
        let frein = Input { brake: 1.0, ..Input::default() };
        while c.speed > 0.5 && t < 30.0 {
            let z = c.z;
            c.update(DT, frein, &TUNING);
            dist += c.z - z;
            t += DT;
            assert!(c.vz >= -0.01, "le frein a fait reculer la voiture");
        }
        println!("freinage depuis {kmh} km/h : {dist:.0} m en {t:.1} s");
        let attendu = (kmh / KMH) / TUNING.frein;
        assert!((t - attendu).abs() < 0.3, "{t} s au lieu de {attendu}");
    }
    // pied leve : plus doux que le frein
    let mut libre = lance(50.0);
    roule(&mut libre, 1.0, Input::default());
    let mut frein = lance(50.0);
    roule(&mut frein, 1.0, Input { brake: 1.0, ..Input::default() });
    assert!(libre.speed > frein.speed + 15.0);
    assert!(libre.speed < 50.0);
}

#[test]
fn virage_en_grip_sans_glisse() {
    // a 150 km/h, un virage moyen se prend en adherence
    let mut c = lance(150.0 / KMH);
    roule(&mut c, 2.0, Input { steer: 0.35, ..GAZ });
    println!("grip : glisse {:.1} deg, {:.0} km/h", c.slip.to_degrees(), c.speed * KMH);
    assert!(c.slip.abs().to_degrees() < 6.0, "{}", c.slip.to_degrees());
    assert!(!c.sliding);
}

#[test]
fn la_touche_drift_lance_un_drift_controlable() {
    let mut c = lance(200.0 / KMH);
    roule(&mut c, 0.8, Input { steer: 1.0, handbrake: true, ..GAZ });
    let angle = c.slip.abs().to_degrees();
    println!("drift : {angle:.1} deg a {:.0} km/h", c.speed * KMH);
    assert!(c.sliding, "gaz + drift + volant doivent faire decrocher");
    assert!(angle > 10.0);
    // la caisse pointe ailleurs que la trajectoire : l'inertie est gardee
    assert!(c.yaw.abs() > c.vx.atan2(c.vz).abs());
    // sans la touche drift, la meme manoeuvre accroche davantage
    let mut g = lance(200.0 / KMH);
    roule(&mut g, 0.8, Input { steer: 1.0, ..GAZ });
    assert!(g.slip.abs() < c.slip.abs());
}

#[test]
fn le_frein_freine_sans_faire_drifter() {
    // frein et drift sont separes : gaz + frein + volant ralentit sans
    // retirer d'adherence, et glisse bien moins que la touche drift
    let mut f = lance(200.0 / KMH);
    roule(&mut f, 0.8, Input { steer: 1.0, brake: 1.0, ..GAZ });
    let mut g = lance(200.0 / KMH);
    roule(&mut g, 0.8, Input { steer: 1.0, ..GAZ });
    let mut d = lance(200.0 / KMH);
    roule(&mut d, 0.8, Input { steer: 1.0, handbrake: true, ..GAZ });
    println!("frein en virage : {:.1} deg a {:.0} km/h, touche drift {:.1} deg", f.slip.abs().to_degrees(), f.speed * KMH, d.slip.abs().to_degrees());
    assert!(f.speed < g.speed - 10.0, "le frein doit freiner meme gaz tenus");
    assert!((f.prise - 1.0).abs() < 1e-3, "le frein ne doit pas retirer d'adherence");
    assert!(f.slip.abs() < d.slip.abs() * 0.75, "freiner ne doit pas faire drifter");
}

#[test]
fn la_sortie_de_drift_est_progressive() {
    let mut c = lance(200.0 / KMH);
    roule(&mut c, 0.8, Input { steer: 1.0, handbrake: true, ..GAZ });
    let depart = c.slip.abs();
    // on relache tout sauf les gaz : la glisse decroit sans saut
    let mut avant = depart;
    let mut pas_max: f32 = 0.0;
    for _ in 0..120 {
        c.update(DT, GAZ, &TUNING);
        pas_max = pas_max.max((avant - c.slip.abs()).abs());
        avant = c.slip.abs();
    }
    println!("sortie : {:.1} -> {:.1} deg, pas max {:.2} deg", depart.to_degrees(), avant.to_degrees(), pas_max.to_degrees());
    assert!(avant < depart * 0.5, "la voiture doit raccrocher");
    assert!(pas_max.to_degrees() < 1.5, "realignement brutal : {} deg en un pas", pas_max.to_degrees());
    // contre-braquer raccroche plus vite que relacher
    let mut d = lance(200.0 / KMH);
    roule(&mut d, 0.8, Input { steer: 1.0, handbrake: true, ..GAZ });
    let mut r = lance(200.0 / KMH);
    roule(&mut r, 0.8, Input { steer: 1.0, handbrake: true, ..GAZ });
    roule(&mut d, 0.4, Input { steer: -1.0, ..GAZ });
    roule(&mut r, 0.4, GAZ);
    assert!(d.yaw_rate < r.yaw_rate, "le contre-braquage doit freiner la rotation");
}

#[test]
fn le_speedslide_aide_dans_sa_fenetre_seulement() {
    let essai = |angle: f32, gaz: f32| {
        let mut c = lance(300.0 / KMH);
        c.vx = c.vz * angle.tan();
        c.update(DT, Input { throttle: gaz, ..Input::default() }, &TUNING);
        c.forces.speedslide
    };
    let opt = TUNING.ss_angle(300.0 / KMH);
    let dedans = essai(opt, 1.0);
    let trop_peu = essai(opt * 0.3, 1.0);
    let trop = essai(opt * 3.0, 1.0);
    let sans_gaz = essai(opt, 0.0);
    println!("speedslide : dedans {dedans:.2}, trop peu {trop_peu:.2}, trop {trop:.2}, sans gaz {sans_gaz:.2}");
    assert!(dedans > 0.5);
    assert_eq!(trop_peu, 0.0);
    assert!(trop < 0.0, "trop d'angle doit couter");
    assert_eq!(sans_gaz, 0.0, "pas de bonus pied leve");
}

/// Etat apres `secs` de jeu, avec des images de rendu de `frame` s ; le
/// volant `steer` est tenu entre 1,0 et 1,5 s, sur la ligne droite du depart.
fn partie(frame: f32, secs: f32, steer: f32) -> (f32, f32, f32) {
    let mut g = Game::new(Track::build());
    g.phase = Phase::Running;
    // on compare au meme temps de jeu (meme nombre de pas de physique) :
    // la derniere image est raccourcie pour s'arreter au meme pas
    while g.time < secs {
        let t = g.time;
        g.input = Input { throttle: 1.0, steer: if t > 1.0 && t < 1.5 { steer } else { 0.0 }, ..Input::default() };
        g.advance(frame.min(secs - g.time + 1e-4));
    }
    (g.car.z, g.car.x, g.car.speed)
}

#[test]
fn meme_conduite_a_30_60_et_144_images_par_seconde() {
    // pas fixe : a entrees egales, le framerate ne change rien du tout
    let a = partie(1.0 / 30.0, 6.0, 0.0);
    let c = partie(1.0 / 144.0, 6.0, 0.0);
    assert_eq!(a, c, "meme partie, autre framerate");
    // avec un coup de volant, seul l'instant ou il est lu change (une image)
    let a = partie(1.0 / 30.0, 2.5, 0.3);
    let b = partie(1.0 / 60.0, 2.5, 0.3);
    let c = partie(1.0 / 144.0, 2.5, 0.3);
    println!("30 : {a:?}  60 : {b:?}  144 : {c:?}");
    for (x, y) in [(a, b), (b, c)] {
        assert!((x.0 - y.0).abs() < 0.5 && (x.1 - y.1).abs() < 0.3 && (x.2 - y.2).abs() < 0.2);
    }
}

#[test]
fn sans_la_touche_drift_la_voiture_ne_decroche_jamais() {
    for kmh in [120.0, 250.0, 400.0, 550.0] {
        let mut c = lance(kmh / KMH);
        roule(&mut c, 2.0, Input { steer: 1.0, ..GAZ });
        println!("volant a fond a {kmh} km/h : glisse {:.1} deg, rayon {:.0} m", c.slip.abs().to_degrees(), c.speed / c.yaw_rate.abs().max(1e-3));
        assert!(!c.sliding, "a {kmh} km/h, la voiture a decroche seule");
        assert!(c.slip.abs().to_degrees() < 5.0);
    }
}

#[test]
fn en_drift_la_trajectoire_suit_le_virage() {
    // la direction du deplacement tourne avec la voiture, pas seulement la caisse
    let mut c = lance(200.0 / KMH);
    roule(&mut c, 1.2, Input { steer: 1.0, handbrake: true, ..GAZ });
    let trajet = c.vx.atan2(c.vz).to_degrees();
    let caisse = c.yaw.to_degrees();
    println!("drift 1,2 s : trajectoire tournee de {trajet:.0} deg, caisse de {caisse:.0} deg");
    assert!(trajet > 40.0, "la trajectoire doit suivre le virage : {trajet}");
    assert!(caisse > trajet, "la caisse reste en travers");
}
