//! Ce que le rendu lit a chaque image : un tableau de `f32` a plat.
//!
//! Les indices sont un contrat avec `public/skidmania/js/moteur.js` (objet
//! `S`) : les deux listes doivent rester alignees.

use crate::camera::Camera;
use crate::game::{Event, Game};
use crate::vec::V3;

/// Pose d'un pas de simulation, interpolee ensuite pour le rendu et la
/// camera. `pos`/`fwd`/`up` : la voiture sans suspension (la camera la
/// suit) ; `body_*` : la caisse avec sa suspension (ce qu'on dessine).
#[derive(Clone, Copy, Debug, Default)]
pub struct Pose {
    pub pos: V3,
    pub fwd: V3,
    pub up: V3,
    pub vel: V3,
    /// Normale de la piste sous la voiture (meme en vol : la piste survolee).
    pub ref_up: V3,
    pub body_pos: V3,
    pub body_fwd: V3,
    pub body_up: V3,
    pub speed: f32,
    pub s: f32,
    pub air: f32,
    pub air_t: f32,
}

/// Tourne `v` de `a` radians autour de l'axe unitaire `k`.
fn tourne(v: V3, k: V3, a: f32) -> V3 {
    let (s, c) = a.sin_cos();
    v * c + k.cross(v) * s + k * (k.dot(v) * (1.0 - c))
}

impl Pose {
    pub fn of(g: &Game) -> Pose {
        let c = &g.car;
        let (pos, fwd, up, vel, s, air_t) = match &g.vol {
            Some(v) => (v.pos, v.fwd, v.up, v.vel, v.s, v.duree),
            None => {
                let f = g.track.frame_at(c.z);
                let (sy, cy) = c.yaw.sin_cos();
                (f.at(c.x, 0.0), f.t * cy + f.r * sy, f.u, f.t * c.vz + f.r * c.vx, c.z, 0.0)
            }
        };
        let ref_up = g.track.frame_at(s).u;
        // la caisse : tangage autour de la droite, roulis autour de l'avant
        let (h, tg, rl) = g.susp.pose();
        let right = fwd.cross(up).norm();
        let bf = tourne(fwd, right, tg);
        let bu = tourne(tourne(up, right, tg), bf, rl);
        Pose {
            pos,
            fwd,
            up,
            vel,
            ref_up,
            body_pos: pos + up * h,
            body_fwd: bf,
            body_up: bu,
            speed: vel.len(),
            s,
            air: if g.vol.is_some() { 1.0 } else { 0.0 },
            air_t,
        }
    }

    pub fn lerp(&self, o: &Pose, k: f32) -> Pose {
        let n = |a: V3, b: V3| {
            let m = a.lerp(b, k);
            if m.len() > 1e-4 { m.norm() } else { b }
        };
        Pose {
            pos: self.pos.lerp(o.pos, k),
            fwd: n(self.fwd, o.fwd),
            up: n(self.up, o.up),
            vel: self.vel.lerp(o.vel, k),
            ref_up: n(self.ref_up, o.ref_up),
            body_pos: self.body_pos.lerp(o.body_pos, k),
            body_fwd: n(self.body_fwd, o.body_fwd),
            body_up: n(self.body_up, o.body_up),
            speed: self.speed + (o.speed - self.speed) * k,
            s: self.s + (o.s - self.s) * k,
            air: o.air,
            air_t: self.air_t + (o.air_t - self.air_t) * k,
        }
    }
}

pub const PHASE: usize = 0;
pub const COUNTDOWN: usize = 1;
pub const TIME: usize = 2;
pub const SPEED: usize = 3;
pub const BOOST: usize = 4;
pub const BOOSTING: usize = 5;
pub const DRIFTING: usize = 6;
pub const SLIDING: usize = 7;
pub const DRIFT_POINTS: usize = 8;
pub const SCORE: usize = 9;
pub const SLIP: usize = 10;
pub const VL: usize = 11;
pub const STEER: usize = 12;
pub const HANDBRAKE: usize = 13;
pub const NEXT_CP: usize = 14;
pub const CP_COUNT: usize = 15;
pub const PROGRESS: usize = 16;
pub const LENGTH: usize = 17;
pub const WALL_HIT: usize = 18;
pub const VF: usize = 19;
pub const POS: usize = 20;
pub const FWD: usize = 23;
pub const UP: usize = 26;
pub const RIGHT: usize = 29;
pub const CAM_POS: usize = 32;
pub const CAM_TARGET: usize = 35;
pub const CAM_UP: usize = 38;
pub const FOV: usize = 41;
pub const LAT: usize = 42;
/// Boite et moteur : regime, rapport (0 point mort, -1 marche arriere),
/// injection coupee, lever de pied, charge, zone rouge.
pub const RPM: usize = 43;
pub const GEAR: usize = 44;
pub const ENG_CUT: usize = 45;
pub const ENG_LIFT: usize = 46;
pub const ENG_LOAD: usize = 47;
pub const REDLINE: usize = 48;
/// Speedslide en cours (la glisse fait gagner de la vitesse).
pub const SPEEDSLIDE: usize = 49;
// --- diagnostic ---------------------------------------------------------
/// 1 au sol, 0 en vol ; normale de la piste sous la voiture.
pub const CONTACT: usize = 50;
pub const NORMAL: usize = 51;
/// Acceleration mesuree (m/s2).
pub const ACCEL: usize = 54;
/// Forces principales (m/s2) : propulsion, freins, laterale, gravite,
/// speedslide.
pub const F_PROP: usize = 55;
pub const F_FREIN: usize = 56;
pub const F_LAT: usize = 57;
pub const F_GRAV: usize = 58;
pub const F_SS: usize = 59;
pub const CAM_MODE: usize = 60;
pub const CAM_DIST: usize = 61;
/// Propulsion retiree apres un choc (0..0,7).
pub const PENALITE: usize = 62;
pub const YAW_RATE: usize = 63;
/// Duree du vol en cours (s).
pub const AIR_T: usize = 64;
/// Sol sous la voiture (surface::Sol).
pub const SURFACE: usize = 65;
pub const LEN: usize = 66;

fn put(out: &mut [f32], i: usize, v: V3) {
    out[i] = v.x;
    out[i + 1] = v.y;
    out[i + 2] = v.z;
}

/// `p` : pose interpolee de cette image ; `cam` : camera deja mise a jour.
pub fn write(g: &Game, p: &Pose, cam: &Camera, out: &mut [f32]) {
    let c = &g.car;
    let b = |v: bool| if v { 1.0 } else { 0.0 };
    out[PHASE] = g.phase as u32 as f32;
    out[COUNTDOWN] = g.countdown.max(0.0);
    out[TIME] = g.time;
    out[SPEED] = p.speed;
    out[BOOST] = c.boost;
    out[BOOSTING] = b(c.boosting);
    out[DRIFTING] = b(c.drifting);
    out[SLIDING] = b(c.sliding);
    out[DRIFT_POINTS] = c.drift_points;
    out[SCORE] = c.score as f32;
    out[SLIP] = c.slip;
    out[VL] = c.vl;
    out[STEER] = c.steer;
    out[HANDBRAKE] = b(g.input.handbrake);
    out[NEXT_CP] = g.next_cp as f32;
    out[CP_COUNT] = g.track.checkpoints.len() as f32;
    out[PROGRESS] = p.s;
    out[LENGTH] = g.track.finish();
    out[WALL_HIT] = g.wall_hit;
    out[VF] = c.vf;
    out[LAT] = c.x;
    let bo = &g.boite;
    out[RPM] = bo.rpm;
    out[GEAR] = bo.rapport as f32;
    out[ENG_CUT] = b(bo.coupure);
    out[ENG_LIFT] = b(bo.lever);
    out[ENG_LOAD] = bo.charge;
    out[REDLINE] = bo.m.zone_rouge;
    out[SPEEDSLIDE] = b(c.speedslide);
    // la droite de la voiture : avant x haut, comme la droite du trace
    let right = p.body_fwd.cross(p.body_up).norm();
    put(out, POS, p.body_pos);
    put(out, FWD, p.body_fwd);
    put(out, UP, p.body_up);
    put(out, RIGHT, right);
    put(out, CAM_POS, cam.pos);
    put(out, CAM_TARGET, cam.target);
    put(out, CAM_UP, cam.up);
    out[FOV] = cam.fov;
    out[CONTACT] = 1.0 - p.air;
    put(out, NORMAL, p.ref_up);
    out[ACCEL] = c.accel;
    out[F_PROP] = c.forces.propulsion;
    out[F_FREIN] = c.forces.freinage;
    out[F_LAT] = c.forces.laterale;
    out[F_GRAV] = c.forces.gravite;
    out[F_SS] = c.forces.speedslide;
    // l'embarquee pendant un looping compte : le rendu y cache la voiture
    out[CAM_MODE] = cam.mode_vu() as f32;
    out[CAM_DIST] = cam.dist * cam.degage;
    out[PENALITE] = c.penalite;
    out[YAW_RATE] = c.yaw_rate;
    out[AIR_T] = p.air_t;
    out[SURFACE] = g.track.sol_at(p.s) as u32 as f32;
}

/// Evenements a plat, par triplets (type, a, b).
pub fn events(evs: &[Event], out: &mut Vec<f32>) {
    out.clear();
    for e in evs {
        let (t, a, b) = match *e {
            Event::Count(n) => (1.0, n as f32, 0.0),
            Event::Go => (2.0, 0.0, 0.0),
            Event::Checkpoint(i, t) => (3.0, i as f32, t),
            Event::Finish(t) => (4.0, t, 0.0),
            Event::Boost => (5.0, 0.0, 0.0),
            Event::Bank(p) => (6.0, p as f32, 0.0),
            Event::Wall(v) => (7.0, v, 0.0),
            Event::Respawn => (8.0, 0.0, 0.0),
            Event::Decollage => (9.0, 0.0, 0.0),
            Event::Reception(v, k) => (10.0, v, k),
        };
        out.extend_from_slice(&[t, a, b]);
    }
}
