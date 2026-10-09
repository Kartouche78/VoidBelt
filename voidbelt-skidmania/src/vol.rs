//! Le vol : au-dessus d'un trou du trace, la voiture quitte la piste.
//!
//! Au sol, elle est collee au ruban de la piste (adherence magnetique). Un
//! trou (`Seg::Trou` dans trace.rs) coupe ce lien : la voiture garde sa
//! vitesse et son orientation, la gravite du monde la reprend, la propulsion
//! s'arrete. Le volant la fait tourner un peu, le frein freine sa rotation
//! (airbrake) sans toucher a sa trajectoire.
//!
//! Elle ne se repose que sur sa propre piste, a l'abscisse qu'elle survole,
//! hors des trous : jamais sur une route voisine, au-dessus ou au-dessous.
//! Une reception alignee sur la trajectoire et la piste garde sa vitesse ; de
//! travers, elle en perd (`reception_perte`). La vitesse normale est absorbee
//! par la suspension, sans rebond.

use crate::car::{Car, Input};
use crate::track::{Frame, Track, HALF_WIDTH};
use crate::tune::Tuning;
use crate::vec::{v3, V3};

#[derive(Clone, Copy, Debug)]
pub struct Vol {
    pub pos: V3,
    pub vel: V3,
    pub fwd: V3,
    pub up: V3,
    /// Vitesse de rotation (rad/s) : tangage (autour de la droite), lacet
    /// (autour du haut), roulis (autour de l'avant).
    pub tangage: f32,
    pub lacet: f32,
    pub roulis: f32,
    /// Abscisse survolee, ecart lateral et hauteur au-dessus de la piste.
    pub s: f32,
    pub lat: f32,
    pub haut: f32,
    pub duree: f32,
}

/// Ou en est le vol apres un pas.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Issue {
    EnVol,
    /// Reposee : vitesse normale absorbee (m/s) et travers (0 = alignee, 1 = a 90 degres).
    Reception { normale: f32, travers: f32 },
    /// Tombee sous la piste ou dans la mer.
    Chute,
}

fn monde_droite(fwd: V3, up: V3) -> V3 {
    fwd.cross(up).norm()
}

/// Tourne `v` de `a` radians autour de l'axe unitaire `k` (Rodrigues).
fn tourne(v: V3, k: V3, a: f32) -> V3 {
    let (s, c) = a.sin_cos();
    v * c + k.cross(v) * s + k * (k.dot(v) * (1.0 - c))
}

impl Vol {
    /// Decolle : la pose et la vitesse de la voiture, en monde.
    pub fn decolle(car: &Car, f: &Frame) -> Vol {
        let (sy, cy) = car.yaw.sin_cos();
        Vol {
            pos: f.at(car.x, 0.0),
            vel: f.t * car.vz + f.r * car.vx,
            fwd: f.t * cy + f.r * sy,
            up: f.u,
            tangage: 0.0,
            lacet: car.yaw_rate,
            roulis: 0.0,
            s: car.z,
            lat: car.x,
            haut: 0.0,
            duree: 0.0,
        }
    }

    pub fn droite(&self) -> V3 {
        monde_droite(self.fwd, self.up)
    }

    pub fn step(&mut self, dt: f32, inp: Input, t: &Tuning, track: &Track) -> Issue {
        self.duree += dt;
        // translation : inertie et gravite du monde, rien d'autre
        self.vel.y -= t.gravite * dt;
        self.pos = self.pos + self.vel * dt;

        // rotation : controle limite, airbrake au frein
        self.lacet += inp.steer * t.air_lacet * dt;
        if inp.handbrake {
            self.roulis += inp.steer * t.air_roulis * dt;
        }
        if inp.brake > 0.3 {
            let k = (-t.airbrake * inp.brake * dt).exp();
            self.tangage *= k;
            self.roulis *= k;
            self.lacet *= k.sqrt();
        }
        let r = self.droite();
        self.fwd = tourne(self.fwd, self.up, -self.lacet * dt);
        self.fwd = tourne(self.fwd, r, self.tangage * dt);
        self.up = tourne(self.up, r, self.tangage * dt);
        self.up = tourne(self.up, self.fwd, self.roulis * dt);
        // reorthonormaliser
        self.fwd = self.fwd.norm();
        let r = monde_droite(self.fwd, self.up);
        self.up = r.cross(self.fwd).norm();

        // ou est-on au-dessus de sa piste ? on suit l'abscisse de proche en
        // proche : jamais de saut vers une autre portion du trace
        for _ in 0..3 {
            let f = track.frame_at(self.s);
            self.s = (self.s + (self.pos - f.p).dot(f.t)).clamp(0.0, track.len);
        }
        let f = track.frame_at(self.s);
        let d = self.pos - f.p;
        self.lat = d.dot(f.r);
        self.haut = d.dot(f.u);

        if self.pos.y < 1.0 || self.haut < -60.0 {
            return Issue::Chute;
        }
        let sur_piste = !track.dans_trou(self.s) && self.lat.abs() <= HALF_WIDTH + 0.5;
        // juste sous la surface : la voiture vient de la toucher
        if sur_piste && self.haut <= 0.0 && self.haut > -4.0 {
            return self.reception(&f);
        }
        Issue::EnVol
    }

    /// Reception : de combien la voiture arrive de travers.
    fn reception(&self, f: &Frame) -> Issue {
        let vn = self.vel.dot(f.u);
        let vt = self.vel - f.u * vn;
        let fp = (self.fwd - f.u * self.fwd.dot(f.u)).norm();
        let alignement = if vt.len() > 1.0 { fp.dot(vt.norm()).abs() } else { 1.0 };
        let assiette = self.up.dot(f.u).clamp(0.0, 1.0);
        let travers = (1.0 - alignement).max((1.0 - assiette) * 0.6).clamp(0.0, 1.0);
        Issue::Reception { normale: -vn, travers }
    }

    /// Repose la voiture sur la piste ; `perte` = part de vitesse perdue.
    pub fn pose(&self, car: &mut Car, f: &Frame, perte: f32) {
        let vn = self.vel.dot(f.u);
        let vt = (self.vel - f.u * vn) * (1.0 - perte);
        let fp = self.fwd - f.u * self.fwd.dot(f.u);
        car.x = self.lat.clamp(-HALF_WIDTH, HALF_WIDTH);
        car.z = self.s;
        car.yaw = fp.dot(f.r).atan2(fp.dot(f.t));
        car.yaw_rate = self.lacet;
        car.vx = vt.dot(f.r);
        car.vz = vt.dot(f.t);
        let (fx, fz) = (car.yaw.sin(), car.yaw.cos());
        car.vf = car.vx * fx + car.vz * fz;
        car.vl = car.vx * fz - car.vz * fx;
        car.speed = car.vx.hypot(car.vz);
    }
}

/// Le haut du monde, pour la camera en vol.
pub const HAUT_MONDE: V3 = v3(0.0, 1.0, 0.0);
