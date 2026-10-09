//! Ecrit les reperes de la piste en JSON pour le script Blender qui
//! construit le modele 3D, et affiche un diagnostic du trace.
//!
//! `cargo run --release --bin piste -- <sortie.json>`

use voidbelt_skidmania::track::{Track, HALF_WIDTH, STEP};

fn main() {
    let out = std::env::args().nth(1);
    let tr = Track::build();
    let (mut lo, mut hi) = (f32::MAX, f32::MIN);
    for f in &tr.frames {
        lo = lo.min(f.p.y);
        hi = hi.max(f.p.y);
    }
    println!("longueur {:.0} m, {} reperes, hauteur {:.0}..{:.0} m", tr.len, tr.frames.len(), lo, hi);
    println!("checkpoints {:?}", tr.checkpoints.iter().map(|c| c.round()).collect::<Vec<_>>());
    for (i, j, d) in voidbelt_skidmania::track_check::close_pairs(&tr, 2.0 * HALF_WIDTH + 8.0, 100.0) {
        println!("  trop pres : s={i:.0} et s={j:.0} a {d:.1} m");
    }
    let Some(path) = out else { return };
    let mut s = String::with_capacity(tr.frames.len() * 160);
    s.push_str(&format!(
        "{{\"step\":{STEP},\"half_width\":{HALF_WIDTH},\"len\":{},\"checkpoints\":{:?},\"start\":{},\"trous\":{:?},\"frames\":[",
        tr.len,
        tr.checkpoints,
        tr.start_line,
        tr.trous.iter().map(|t| [t.0, t.1]).collect::<Vec<_>>()
    ));
    for (i, f) in tr.frames.iter().enumerate() {
        if i > 0 {
            s.push(',');
        }
        let q = |v: voidbelt_skidmania::vec::V3| format!("{:.4},{:.4},{:.4}", v.x, v.y, v.z);
        s.push_str(&format!("[{},{},{}]", q(f.p), q(f.r), q(f.u)));
    }
    s.push_str("]}");
    std::fs::write(&path, s).expect("ecriture du json");
    println!("ecrit {path}");
}
