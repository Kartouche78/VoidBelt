//! La geometrie du circuit : longueur, hauteur, aucun croisement.

use crate::track::{Track, STEP};
use crate::track_check::close_pairs;

#[test]
fn le_circuit_ne_se_croise_jamais() {
    let tr = Track::build();
    let close = close_pairs(&tr, 2.0 * crate::track::HALF_WIDTH + 8.0, 100.0);
    assert!(close.is_empty(), "troncons trop proches : {close:?}");
}

#[test]
fn le_circuit_reste_en_l_air() {
    let tr = Track::build();
    let low = tr.frames.iter().map(|f| f.p.y).fold(f32::MAX, f32::min);
    assert!(low > 25.0, "point le plus bas a {low} m");
}

#[test]
fn les_reperes_sont_orthonormes_et_continus() {
    let tr = Track::build();
    for w in tr.frames.windows(2) {
        let (a, b) = (w[0], w[1]);
        assert!((a.t.len() - 1.0).abs() < 1e-3 && (a.u.len() - 1.0).abs() < 1e-3);
        assert!(a.t.dot(a.u).abs() < 1e-3 && a.t.dot(a.r).abs() < 1e-3);
        let d = (b.p - a.p).len();
        assert!(d < STEP * 1.1, "saut de {d} m dans le trace");
        assert!(a.u.dot(b.u) > 0.99, "la normale tourne trop vite : {}", a.u.dot(b.u));
    }
}

#[test]
fn checkpoints_et_arrivee_dans_l_ordre() {
    let tr = Track::build();
    assert!(tr.checkpoints.len() >= 6);
    assert!(tr.checkpoints.windows(2).all(|w| w[1] > w[0] + 300.0));
    assert!(tr.finish() < tr.len - 50.0);
}

#[test]
fn les_loopings_se_referment() {
    // apres tous les loopings et pentes, la fin du trace est a plat
    let tr = Track::build();
    let f = tr.frames.last().unwrap();
    assert!(f.t.y.abs() < 1e-3 && f.u.y > 0.999, "{f:?}");
}
