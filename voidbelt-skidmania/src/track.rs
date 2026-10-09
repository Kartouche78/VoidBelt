//! La piste : une suite de repères echantillonnes tous les metres.
//!
//! Le trace est construit par une « tortue » qui avance en integrant trois
//! angles : le cap (autour de la verticale du monde), le tangage (montees,
//! descentes, loopings) et le devers (roulis autour de la tangente). Chaque
//! repere donne la position du milieu de la route, sa tangente `t`, sa
//! droite `r` et sa normale `u` (le haut de la chaussee).
//!
//! La voiture vit dans le plan deplie de la route : x = decalage lateral,
//! z = abscisse curviligne. Seule la courbure *dans le plan de la route*
//! (geodesique) influe sur la conduite ; un looping ou une bosse ne change
//! rien au modele 2D, la voiture colle a la piste, comme dans Trackmania.

use crate::trace::{Seg, TRACE};
use crate::vec::{v3, V3};
use std::f32::consts::TAU;

/// Pas d'echantillonnage des reperes (m).
pub const STEP: f32 = 1.0;
/// Pas d'integration de la tortue (m).
const SUB: usize = 8;
/// Demi-largeur libre entre les murs (m) : la face interieure des murs est a
/// -10 et +10 m du centre, 20 m de passage, comme un bloc de Trackmania
/// (demande du 2026-10-09). Le script Blender pose le kit pour que ses
/// murets tombent exactement la.
pub const HALF_WIDTH: f32 = 10.0;
/// Demi-largeur de la voiture : son centre s'arrete a ce retrait du mur.
const CAR_HALF: f32 = 1.05;
/// Ecart maximal du centre de la voiture : elle touche le mur a cet endroit.
pub const WALL: f32 = HALF_WIDTH - CAR_HALF;
/// Hauteur du depart au-dessus du sol.
pub const START_HEIGHT: f32 = 460.0;

#[derive(Clone, Copy, Debug, Default)]
pub struct Frame {
    pub p: V3,
    pub t: V3,
    pub r: V3,
    pub u: V3,
}

impl Frame {
    /// Point de la route a `d` m a droite du milieu et `h` m au-dessus.
    pub fn at(&self, d: f32, h: f32) -> V3 {
        self.p + self.r * d + self.u * h
    }
}

pub struct Track {
    pub frames: Vec<Frame>,
    /// Courbure geodesique (rad/m, positive quand la route tourne a droite).
    pub kappa: Vec<f32>,
    pub len: f32,
    /// Abscisses des checkpoints, dans l'ordre ; la derniere est l'arrivee.
    pub checkpoints: Vec<f32>,
    pub start_line: f32,
    /// Trous du trace (debut, fin) : pas de route, la voiture vole.
    pub trous: Vec<(f32, f32)>,
    /// Loopings du trace (entree, sortie).
    pub loopings: Vec<(f32, f32)>,
    /// Changements de sol (abscisse, sol), dans l'ordre.
    pub sols: Vec<(f32, crate::surface::Sol)>,
}

/// Profil de vitesse angulaire le long d'un element : rampes douces aux deux
/// bouts (de moyenne 1), pour eviter les a-coups de courbure.
fn ramp(u: f32) -> f32 {
    const E: f32 = 0.18;
    let w = if u < E {
        u / E
    } else if u > 1.0 - E {
        (1.0 - u) / E
    } else {
        1.0
    };
    w / (1.0 - E)
}

/// Plateau de devers : monte, tient, redescend.
fn plateau(u: f32) -> f32 {
    let s = |x: f32| {
        let x = x.clamp(0.0, 1.0);
        x * x * (3.0 - 2.0 * x)
    };
    s(u / 0.3) * s((1.0 - u) / 0.3)
}

/// Etat de la tortue.
struct Turtle {
    p: V3,
    yaw: f32,
    pitch: f32,
    bank: f32,
}

impl Turtle {
    fn tangent(&self) -> V3 {
        let (sy, cy) = self.yaw.sin_cos();
        let (sp, cp) = self.pitch.sin_cos();
        v3(cp * sy, sp, cp * cy)
    }

    /// Droite horizontale (hors devers) : constante pendant un looping.
    fn right0(&self) -> V3 {
        let (sy, cy) = self.yaw.sin_cos();
        v3(-cy, 0.0, sy)
    }

    fn frame(&self) -> Frame {
        let t = self.tangent();
        let (sy, cy) = self.yaw.sin_cos();
        let (sp, cp) = self.pitch.sin_cos();
        let u0 = v3(-sp * sy, cp, -sp * cy);
        let r0 = t.cross(u0);
        let (sb, cb) = self.bank.sin_cos();
        Frame { p: self.p, t, r: r0 * cb - u0 * sb, u: u0 * cb + r0 * sb }
    }
}

/// Ce qu'un element impose sur un pas : vitesses angulaires (rad/m), devers
/// vise (rad) et glissement lateral (m/m).
struct Rates {
    yaw: f32,
    pitch: f32,
    bank: Option<f32>,
    shift: f32,
    /// Pente ajoutee a celle d'entree (rad) : un virage qui monte ou descend.
    lift: Option<f32>,
}

/// Moyenne de `plateau` sur [0, 1] : sert a convertir un denivele en pente.
const PLATEAU_MEAN: f32 = 0.7;

fn seg_len(s: &Seg) -> f32 {
    match *s {
        Seg::Straight(l) => l,
        Seg::Turn { deg, r, .. } => deg.abs().to_radians() * r,
        Seg::Pitch { deg, r } => deg.abs().to_radians() * r,
        Seg::Loop { r, .. } => TAU * r,
        Seg::Checkpoint | Seg::Trou(_) | Seg::Sol(_) => 0.0,
    }
}

fn rates(s: &Seg, u: f32) -> Rates {
    let len = seg_len(s).max(1e-3);
    let mut out = Rates { yaw: 0.0, pitch: 0.0, bank: None, shift: 0.0, lift: None };
    match *s {
        Seg::Straight(_) | Seg::Checkpoint | Seg::Trou(_) | Seg::Sol(_) => {}
        Seg::Turn { deg, bank, climb, .. } => {
            if climb != 0.0 {
                let slope = (climb / (len * PLATEAU_MEAN)).clamp(-0.8, 0.8).asin();
                out.lift = Some(slope * plateau(u));
            }
            // cap croissant = vers la gauche dans ce repere : un virage a
            // droite (deg > 0) fait donc decroitre le cap.
            out.yaw = -deg.to_radians() / len * ramp(u);
            out.bank = Some(bank.to_radians() * deg.signum() * plateau(u));
        }
        Seg::Pitch { deg, .. } => out.pitch = deg.to_radians() / len * ramp(u),
        Seg::Loop { shift, .. } => {
            out.pitch = TAU / len * ramp(u);
            out.shift = shift / len * ramp(u);
        }
    }
    out
}

impl Track {
    pub fn build() -> Track {
        Track::from_trace(TRACE)
    }

    pub fn from_trace(trace: &[Seg]) -> Track {
        let mut tu = Turtle { p: v3(0.0, START_HEIGHT, 0.0), yaw: 0.0, pitch: 0.0, bank: 0.0 };
        let mut frames = vec![tu.frame()];
        let mut checkpoints = vec![];
        let mut trous: Vec<(f32, f32)> = vec![];
        let mut loopings = vec![];
        let mut sols = vec![];
        let mut s_total = 0.0f32;
        let h = STEP / SUB as f32;
        // reliquat de distance pour poser un repere tous les STEP metres
        let mut acc = 0.0f32;
        for seg in trace {
            match *seg {
                Seg::Checkpoint => {
                    checkpoints.push(s_total);
                    continue;
                }
                Seg::Trou(true) => {
                    trous.push((s_total, f32::MAX));
                    continue;
                }
                Seg::Trou(false) => {
                    if let Some(t) = trous.last_mut() {
                        t.1 = s_total;
                    }
                    continue;
                }
                Seg::Sol(sol) => {
                    sols.push((s_total, sol));
                    continue;
                }
                _ => {}
            }
            let len = seg_len(seg);
            if let Seg::Loop { .. } = seg {
                loopings.push((s_total, s_total + len));
            }
            let n = (len / h).round().max(1.0) as usize;
            let pitch0 = tu.pitch;
            let dh = len / n as f32;
            for i in 0..n {
                let u = (i as f32 + 0.5) / n as f32;
                let r = rates(seg, u);
                let before = tu.frame();
                if let Some(l) = r.lift {
                    tu.pitch = pitch0 + l;
                }
                // demi-pas d'angle, deplacement, demi-pas : integration au
                // point milieu, pour que les loopings se referment proprement
                tu.yaw += r.yaw * dh * 0.5;
                tu.pitch += r.pitch * dh * 0.5;
                tu.p = tu.p + tu.tangent() * dh + tu.right0() * (r.shift * dh);
                tu.yaw += r.yaw * dh * 0.5;
                tu.pitch += r.pitch * dh * 0.5;
                tu.bank = r.bank.unwrap_or(0.0);
                s_total += dh;
                acc += dh;
                if acc >= STEP {
                    // le metre rond tombe dans ce sous-pas : on y interpole
                    let k = 1.0 - (acc - STEP) / dh;
                    frames.push(lerp_frame(&before, &tu.frame(), k));
                    acc -= STEP;
                }
            }
            // un looping complet ramene le tangage a zero
            if tu.pitch.abs() > 3.0 {
                tu.pitch -= TAU * tu.pitch.signum();
            }
        }
        let len = (frames.len() - 1) as f32 * STEP;
        let kappa = geodesic(&frames);
        for t in trous.iter_mut() {
            t.1 = t.1.min(len);
        }
        Track { frames, kappa, len, checkpoints, start_line: 40.0, trous, loopings, sols }
    }

    /// Repere interpole a l'abscisse `s`, prolonge en ligne droite au-dela
    /// des deux bouts (la camera recule parfois derriere le depart).
    pub fn frame_at(&self, s: f32) -> Frame {
        let last = self.frames.len() - 1;
        if s <= 0.0 {
            let f = self.frames[0];
            return Frame { p: f.p + f.t * s, ..f };
        }
        if s >= self.len {
            let f = self.frames[last];
            return Frame { p: f.p + f.t * (s - self.len), ..f };
        }
        let x = s / STEP;
        let i = (x as usize).min(last - 1);
        lerp_frame(&self.frames[i], &self.frames[i + 1], x - i as f32)
    }

    pub fn kappa_at(&self, s: f32) -> f32 {
        let x = (s / STEP).clamp(0.0, (self.kappa.len() - 1) as f32);
        let i = (x as usize).min(self.kappa.len() - 2);
        let k = x - i as f32;
        self.kappa[i] * (1.0 - k) + self.kappa[i + 1] * k
    }

    /// Dans un looping, ou a `avant` m de son entree, `apres` m de sa sortie.
    pub fn dans_looping(&self, s: f32, avant: f32, apres: f32) -> bool {
        self.loopings.iter().any(|&(a, b)| s >= a - avant && s < b + apres)
    }

    /// Pas de route a l'abscisse `s`.
    pub fn dans_trou(&self, s: f32) -> bool {
        self.trous.iter().any(|&(a, b)| s >= a && s < b)
    }

    /// Sol sous l'abscisse `s`.
    pub fn sol_at(&self, s: f32) -> crate::surface::Sol {
        self.sols.iter().rev().find(|&&(a, _)| s >= a).map(|&(_, sol)| sol).unwrap_or_default()
    }

    /// Gravite dans le plan de la route en `s` : le long du trace et vers
    /// sa droite (m/s2).
    pub fn gravite(&self, s: f32, g: f32) -> (f32, f32) {
        let f = self.frame_at(s);
        (-g * f.t.y, -g * f.r.y)
    }

    pub fn finish(&self) -> f32 {
        *self.checkpoints.last().unwrap_or(&self.len)
    }
}

/// Interpole deux reperes en gardant un trièdre orthonorme.
fn lerp_frame(a: &Frame, b: &Frame, k: f32) -> Frame {
    let t = a.t.lerp(b.t, k).norm();
    let u = a.u.lerp(b.u, k);
    let r = t.cross(u).norm();
    Frame { p: a.p.lerp(b.p, k), t, r, u: r.cross(t) }
}

/// Courbure geodesique : rotation de la tangente vers la droite de la route,
/// par metre. Les loopings et les bosses n'en ont pas.
fn geodesic(f: &[Frame]) -> Vec<f32> {
    let n = f.len();
    (0..n)
        .map(|i| {
            let a = f[i.saturating_sub(1)];
            let b = f[(i + 1).min(n - 1)];
            let ds = ((i + 1).min(n - 1) - i.saturating_sub(1)) as f32 * STEP;
            (b.t - a.t).dot(f[i].r) / ds
        })
        .collect()
}
