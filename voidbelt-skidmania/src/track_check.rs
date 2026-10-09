//! Verifications geometriques du trace : rien ne doit se croiser.

use crate::track::Track;

/// Paires de points eloignes d'au moins `gap` m le long du trace mais a
/// moins de `min` m l'un de l'autre dans l'espace. Une paire par zone.
pub fn close_pairs(tr: &Track, min: f32, gap: f32) -> Vec<(f32, f32, f32)> {
    let step = 2usize;
    let f = &tr.frames;
    let skip = gap as usize;
    let mut out: Vec<(f32, f32, f32)> = vec![];
    let mut i = 0;
    while i < f.len() {
        let mut j = i + skip;
        while j < f.len() {
            let d = (f[i].p - f[j].p).len();
            if d < min {
                let s = (i as f32, j as f32, d);
                match out.last_mut() {
                    Some(l) if (l.0 - s.0).abs() < 60.0 && (l.1 - s.1).abs() < 60.0 => {
                        if d < l.2 {
                            *l = s;
                        }
                    }
                    _ => out.push(s),
                }
            }
            j += step;
        }
        i += step;
    }
    out
}
