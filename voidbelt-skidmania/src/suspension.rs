//! Suspension de la caisse : courte, ferme, amortie.
//!
//! Dans le plan deplie, la voiture n'a pas de roues physiques : la piste la
//! porte. La suspension anime donc la caisse par-dessus ce contact (tangage
//! a l'acceleration et au freinage, roulis en virage, enfoncement a la
//! reception), avec un ressort amorti pres du critique : pas de rebonds
//! repetes. La camera suit la voiture sans ces oscillations.

use crate::tune::Tuning;

#[derive(Clone, Copy, Debug, Default)]
struct Ressort {
    x: f32,
    v: f32,
}

impl Ressort {
    fn pas(&mut self, cible: f32, w: f32, z: f32, dt: f32) {
        let a = w * w * (cible - self.x) - 2.0 * z * w * self.v;
        self.v += a * dt;
        self.x += self.v * dt;
    }
}

#[derive(Clone, Copy, Debug, Default)]
pub struct Suspension {
    hauteur: Ressort,
    tangage: Ressort,
    roulis: Ressort,
}

impl Suspension {
    /// `long` et `lat` : accelerations de la caisse (m/s2), avant et vers
    /// la droite. En vol, la caisse revient au repos.
    pub fn pas(&mut self, dt: f32, t: &Tuning, long: f32, lat: f32, au_sol: bool) {
        let (w, z) = (t.susp_pulsation, t.susp_amorti);
        let (tg, rl) = if au_sol {
            ((long * t.susp_tangage).clamp(-0.06, 0.06), (-lat * t.susp_roulis).clamp(-0.08, 0.08))
        } else {
            (0.0, 0.0)
        };
        self.tangage.pas(tg, w, z, dt);
        self.roulis.pas(rl, w, z, dt);
        self.hauteur.pas(0.0, w, z, dt);
    }

    /// Reception : la caisse s'enfonce selon la vitesse verticale (m/s).
    pub fn reception(&mut self, normale: f32, t: &Tuning) {
        self.hauteur.x = (self.hauteur.x - normale.abs() * t.susp_reception).max(-0.3);
    }

    /// Enfoncement (m, negatif = plus bas), tangage et roulis (rad).
    pub fn pose(&self) -> (f32, f32, f32) {
        (self.hauteur.x, self.tangage.x, self.roulis.x)
    }
}
