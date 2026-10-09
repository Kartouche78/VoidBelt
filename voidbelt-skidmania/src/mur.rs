//! Murets : la voiture vit dans le plan deplie, les murs sont donc deux
//! droites a `x = -WALL` et `x = +WALL`. La position est bornee a chaque pas :
//! meme a 600 km/h (1,39 m par pas), la voiture ne peut pas les traverser.
//!
//! La reponse separe la vitesse normale (vers le mur, retiree avec une petite
//! restitution) et tangentielle (le long du mur). Un nouvel impact coute de 5
//! a 20 % de la tangentielle selon sa severite (le sinus de l'angle
//! d'impact) ; un contact prolonge frotte, en fonction du temps ecoule. Un
//! choc franc coupe une partie de la propulsion, rendue en 0,2 a 0,8 s ; un
//! frottement ne la coupe pas. Un meme contact n'est compte qu'une fois.

use crate::car::Car;
use crate::tune::Tuning;
use crate::vec::clamp;

#[derive(Clone, Copy, Debug, Default)]
pub struct Mur {
    /// En contact au pas precedent.
    pub contact: bool,
    /// Severite du dernier impact (0..1), pour le diagnostic et la camera.
    pub severite: f32,
}

/// Un nouvel impact : vitesse normale (m/s) et severite (0..1).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Impact {
    pub normale: f32,
    pub severite: f32,
}

impl Mur {
    /// Resout le contact avec les murets ; `wall` = ecart maximal du centre.
    pub fn resoudre(&mut self, c: &mut Car, t: &Tuning, dt: f32, wall: f32) -> Option<Impact> {
        if c.x.abs() <= wall {
            self.contact = false;
            return None;
        }
        let side = c.x.signum();
        c.x = wall * side;
        // vitesse vers le mur (normale) et le long du mur (tangentielle)
        let out = c.vx * side;
        let mut impact = None;
        if out > 0.0 {
            let v = c.vx.hypot(c.vz).max(1.0);
            let sev = clamp(out / v, 0.0, 1.0);
            c.vx = -t.mur_restitution.clamp(0.0, 0.05) * out * side;
            if !self.contact {
                // nouvel impact : perte tangentielle selon la severite
                let perte = t.mur_perte_min + (t.mur_perte_max - t.mur_perte_min) * sev;
                c.vz *= 1.0 - perte;
                if sev > t.mur_seuil_choc {
                    let k = clamp((sev - t.mur_seuil_choc) / (1.0 - t.mur_seuil_choc).max(0.01), 0.0, 1.0);
                    let pen = t.mur_penalite.min(0.7) * (0.4 + 0.6 * k);
                    let duree = t.mur_recup_min + (t.mur_recup_max - t.mur_recup_min) * k;
                    if pen > c.penalite {
                        c.penalite = pen;
                        c.penalite_retour = pen / duree.max(0.05);
                    }
                }
                // impact decentre : le nez est renvoye le long du mur
                let dir = if c.vz >= 0.0 { 1.0 } else { -1.0 };
                c.yaw_rate -= side * dir * t.mur_rotation * sev * (out / 10.0).min(3.0);
                if out > 2.0 {
                    c.cancel_drift();
                }
                self.severite = sev;
                impact = Some(Impact { normale: out, severite: sev });
            }
        }
        // frottement en contact prolonge : fonction du temps, pas du pas
        c.vz *= (-t.mur_friction * dt).exp();
        self.contact = true;
        // vitesse et glisse restent coherentes avec le cap
        let (fx, fz) = (c.yaw.sin(), c.yaw.cos());
        c.vf = c.vx * fx + c.vz * fz;
        c.vl = c.vx * fz - c.vz * fx;
        c.speed = c.vx.hypot(c.vz);
        impact
    }
}
