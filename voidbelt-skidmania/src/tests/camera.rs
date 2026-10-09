//! Camera (README-CONDUITE, verifications 9 et 10) : les trois modes sur
//! tout le circuit, loopings, wallride et saut compris.

use super::course::pilote;
use crate::camera::{Camera, EMBARQUEE, LOIN, PROCHE};
use crate::game::{Game, Phase, DT};
use crate::state::Pose;
use crate::track::{Track, HALF_WIDTH};

/// Hauteur d'un point au-dessus de la chaussee la plus proche de `s`.
fn hauteur(track: &Track, q: crate::vec::V3, s: f32) -> (f32, f32) {
    let mut sq = s;
    for _ in 0..3 {
        let f = track.frame_at(sq);
        sq += (q - f.p).dot(f.t);
    }
    let f = track.frame_at(sq);
    let d = q - f.p;
    (d.dot(f.u), d.dot(f.r))
}

/// Tour complet avec le pilote, la camera dans `mode` ; rend le pire
/// changement d'orientation d'une image et la plus basse hauteur au-dessus
/// de la chaussee.
fn tour(mode: u32) -> (f32, f32, f32, usize) {
    let mut g = Game::new(Track::build());
    g.phase = Phase::Running;
    let mut cam = Camera::new();
    cam.mode = mode;
    let (mut pire, mut bas, mut images) = (1.0f32, f32::MAX, 0);
    let mut proche = f32::MAX;
    let mut avant: Option<(crate::vec::V3, crate::vec::V3)> = None;
    while g.phase != Phase::Finished && images < 120 * 400 {
        g.input = pilote(&g);
        g.tick();
        let p = Pose::of(&g);
        cam.update(DT, &p, false, &g.tune, &g.track);
        let regard = (cam.target - cam.pos).norm();
        if let Some((u, r)) = avant {
            pire = pire.min(u.dot(cam.up)).min(r.dot(regard));
        }
        avant = Some((cam.up, regard));
        // dans les loopings, la camera passe dans la voiture
        if mode != EMBARQUEE && !cam.voiture_cachee() {
            proche = proche.min((cam.pos - p.pos).len());
            let (h, lat) = hauteur(&g.track, cam.pos, p.s);
            if lat.abs() < HALF_WIDTH {
                bas = bas.min(h);
            }
        }
        images += 1;
    }
    assert_eq!(g.phase, Phase::Finished, "le pilote n'a pas fini (s = {})", g.car.z);
    (pire, bas, proche, images)
}

#[test]
fn les_trois_cameras_ne_se_retournent_jamais() {
    for mode in [PROCHE, LOIN, EMBARQUEE] {
        let (pire, bas, proche, n) = tour(mode);
        println!("mode {mode} : pire ecart d'une image {:.2} deg, plus bas {bas:.2} m, plus pres {proche:.1} m, {n} images", pire.clamp(-1.0, 1.0).acos().to_degrees());
        // 120 images par seconde : jamais plus de quelques degres d'un coup
        assert!(pire > 0.995, "bascule de {} deg", pire.clamp(-1.0, 1.0).acos().to_degrees());
        if mode != EMBARQUEE {
            assert!(bas > 0.3, "camera sous la chaussee : {bas}");
            // jamais dans la voiture, meme en haut d'un looping
            assert!(proche > 3.0, "camera collee a la voiture : {proche} m");
        }
    }
}

#[test]
fn les_loopings_se_vivent_en_embarquee() {
    let mut g = Game::new(Track::build());
    let (entree, sortie) = g.track.loopings[0];
    g.seek(entree - 120.0, 140.0);
    let mut cam = Camera::new();
    let (mut dedans, mut apres_vu) = (false, None);
    for _ in 0..(8.0 / DT) as usize {
        g.input = pilote(&g);
        g.tick();
        let p = Pose::of(&g);
        cam.update(DT, &p, false, &g.tune, &g.track);
        let haut = (entree + sortie) / 2.0;
        if (p.s - haut).abs() < 5.0 {
            dedans = cam.mode_vu() == EMBARQUEE && cam.voiture_cachee();
        }
        if p.s > sortie + g.tune.cam_loop_apres + 40.0 && apres_vu.is_none() {
            apres_vu = Some(cam.mode_vu());
        }
        if p.s < entree - 60.0 {
            assert_eq!(cam.mode_vu(), PROCHE, "trop tot en embarquee");
        }
    }
    assert!(dedans, "au sommet du looping, la camera doit etre embarquee");
    assert_eq!(apres_vu, Some(PROCHE), "apres le looping, retour au mode choisi");
}

#[test]
fn changer_de_mode_ne_garde_aucun_lissage() {
    let mut g = Game::new(Track::build());
    g.seek(600.0, 120.0);
    let p = Pose::of(&g);
    let mut cam = Camera::new();
    for _ in 0..60 {
        cam.update(DT, &p, false, &g.tune, &g.track);
    }
    cam.mode = LOIN;
    cam.update(DT, &p, false, &g.tune, &g.track);
    let d = (cam.pos - p.pos).len();
    let t = &g.tune;
    let attendu = (t.cam1_dist + (t.cam1_dist_max - t.cam1_dist) * (p.speed / crate::car::PLAFOND)).hypot(t.cam1_haut);
    println!("apres le changement : {d:.2} m (attendu ~{attendu:.2})");
    assert!((d - attendu).abs() < 1.5, "{d} au lieu de {attendu}");
}

#[test]
fn regarder_derriere_place_la_camera_devant() {
    let mut g = Game::new(Track::build());
    g.seek(600.0, 80.0);
    let p = Pose::of(&g);
    let mut cam = Camera::new();
    cam.update(DT, &p, true, &g.tune, &g.track);
    assert!((cam.pos - p.pos).dot(p.fwd) > 2.0, "la camera doit passer devant la voiture");
    assert!((cam.target - cam.pos).dot(p.fwd) < 0.0, "et regarder vers l'arriere");
    cam.update(DT, &p, false, &g.tune, &g.track);
    assert!((cam.pos - p.pos).dot(p.fwd) < -2.0, "retour derriere immediat");
}

