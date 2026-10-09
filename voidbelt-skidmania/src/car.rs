//! Conduite au sol, facon Stadium Car (voir README-CONDUITE.md).
//!
//! La voiture vit dans le plan deplie de la piste : x = decalage lateral
//! (vers la droite du trace), z = abscisse. Elle y est collee par
//! construction : c'est l'adherence magnetique du jeu, qui la tient dans les
//! loopings et les portions inversees. Le vol (trous du trace) est dans
//! `vol.rs`, les murs dans `mur.rs`.
//!
//! Chaque pas, la vitesse est decomposee dans le repere de la caisse en `vf`
//! (avant) et `vl` (lateral). La caisse a sa propre vitesse de rotation :
//! elle peut pointer ailleurs que la trajectoire (drift), et la force
//! laterale, bornee par une capacite, ramene `vl` vers zero sans jamais la
//! remettre a zero d'un coup. Quand la demande depasse la capacite (vitesse,
//! touche drift), la voiture glisse : il n'y a pas d'etat « drift » dans la
//! physique, seulement une capacite saturee. Le frein ne fait que freiner ;
//! le drift a sa propre touche (`handbrake`).
//!
//! Repere : `forward = (sin yaw, cos yaw)`, `right = (cos yaw, -sin yaw)`.

use crate::surface::Profil;
use crate::tune::Tuning;
use crate::vec::clamp;

/// Plafond absolu : 600 km/h, sur la norme de la vitesse totale. Les
/// reglages `vitesse_max` (sans boost) et `vitesse_max_boost` restent dessous.
pub const PLAFOND: f32 = 600.0 / 3.6;

#[derive(Clone, Copy, Debug, Default)]
pub struct Input {
    /// 0..1
    pub throttle: f32,
    /// 0..1
    pub brake: f32,
    /// -1 (gauche) .. 1 (droite)
    pub steer: f32,
    pub handbrake: bool,
    pub boost: bool,
    /// Regarder derriere (camera seulement).
    pub look_back: bool,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum CarEvent {
    /// Le boost vient de s'allumer.
    Boost,
    /// Fin d'un drift : ses points sont valides.
    Bank(u32),
}

/// Ce que la piste impose a la voiture sur ce pas.
#[derive(Clone, Copy, Debug)]
pub struct Contact {
    /// Gravite le long du trace (m/s2, negative en montee).
    pub g_t: f32,
    /// Gravite vers la droite du trace (m/s2), devers et wallrides.
    pub g_r: f32,
    pub sol: Profil,
    /// Part de la propulsion coupee par la boite (passage de rapport).
    pub coupure: f32,
}

impl Default for Contact {
    fn default() -> Contact {
        Contact { g_t: 0.0, g_r: 0.0, sol: crate::surface::profil(crate::surface::Sol::Asphalte), coupure: 0.0 }
    }
}

/// Forces principales du dernier pas (m/s2), pour le diagnostic.
#[derive(Clone, Copy, Debug, Default)]
pub struct Forces {
    pub propulsion: f32,
    pub freinage: f32,
    pub laterale: f32,
    pub gravite: f32,
    pub speedslide: f32,
}

#[derive(Clone, Debug, Default)]
pub struct Car {
    pub x: f32,
    pub z: f32,
    pub yaw: f32,
    /// Vitesse de rotation de la caisse (rad/s).
    pub yaw_rate: f32,
    pub vx: f32,
    pub vz: f32,
    pub steer: f32,
    /// Glisse franche (score, effets) : seuil avec hysteresis sur l'angle.
    pub sliding: bool,
    pub drifting: bool,
    /// Angle de glisse signe (rad) : direction de la vitesse par rapport au cap.
    pub slip: f32,
    pub speed: f32,
    pub vf: f32,
    pub vl: f32,
    /// Acceleration mesuree le long de la trajectoire (m/s2).
    pub accel: f32,
    pub forces: Forces,
    /// Part de la capacite laterale disponible (touche drift), filtree : on
    /// ne passe pas d'un coup du grip au drift.
    pub prise: f32,
    /// Propulsion retiree apres un choc (0..0,7), et sa vitesse de retour.
    pub penalite: f32,
    pub penalite_retour: f32,
    pub drift_points: f32,
    pub drift_end_timer: f32,
    pub score: u32,
    /// Jauge 0..1, remplie en driftant, depensee a la demande.
    pub boost: f32,
    pub boosting: bool,
    /// Speedslide en cours : la glisse fait gagner de la vitesse.
    pub speedslide: bool,
    was_boosting: bool,
    pub events: Vec<CarEvent>,
}

/// Retire `d` (>= 0) a `v` sans le faire changer de signe.
fn vers_zero(v: f32, d: f32) -> f32 {
    if v > 0.0 {
        (v - d).max(0.0)
    } else {
        (v + d).min(0.0)
    }
}

impl Car {
    pub fn new() -> Car {
        Car { prise: 1.0, ..Car::default() }
    }

    pub fn reset(&mut self, x: f32, z: f32, yaw: f32) {
        *self = Car { x, z, yaw, prise: 1.0, ..Car::default() };
    }

    /// Un pas sur route plate, en asphalte : pour les tests et le banc.
    pub fn update(&mut self, dt: f32, input: Input, t: &Tuning) {
        self.update_sur(dt, input, t, &Contact::default());
    }

    pub fn update_sur(&mut self, dt: f32, input: Input, t: &Tuning, c: &Contact) {
        let speed0 = self.speed;
        self.volant(dt, input, t);

        // gravite dans le plan de la piste, en repere du trace
        self.vz += c.g_t * dt;
        self.vx += c.g_r * t.gravite_laterale * dt;

        self.lacet(dt, input, t);

        let (fx, fz) = (self.yaw.sin(), self.yaw.cos());
        let (rx, rz) = (self.yaw.cos(), -self.yaw.sin());
        let mut vf = self.vx * fx + self.vz * fz;
        let mut vl = self.vx * rx + self.vz * rz;
        let spd = vf.hypot(vl);
        self.forces = Forces { gravite: c.g_t * fz + c.g_r * t.gravite_laterale * fx, ..Forces::default() };

        vf = self.longitudinal(dt, input, t, c, vf, spd);
        let (vf2, vl2) = self.lateral(dt, input, t, c, vf, vl, spd);
        vf = vf2;
        vl = vl2;

        // plafond sur la norme, boost et descentes compris : la direction du
        // deplacement est conservee
        let cap = t.vmax_boost();
        let v = vf.hypot(vl);
        if v > cap {
            vf *= cap / v;
            vl *= cap / v;
        }

        self.vx = fx * vf + rx * vl;
        self.vz = fz * vf + rz * vl;
        self.x += self.vx * dt;
        self.z += self.vz * dt;

        self.vf = vf;
        self.vl = vl;
        self.speed = self.vx.hypot(self.vz);
        self.accel = (self.speed - speed0) / dt;
        self.slip = if vf.abs() > 0.5 { vl.atan2(vf.abs()) } else { 0.0 };
        let angle = self.slip.abs();
        if !self.sliding && angle > t.glisse_entree && self.speed > 10.0 {
            self.sliding = true;
        } else if self.sliding && (angle < t.glisse_sortie || self.speed < 6.0) {
            self.sliding = false;
        }

        if self.penalite > 0.0 {
            self.penalite = (self.penalite - self.penalite_retour * dt).max(0.0);
        }
        self.drift_logic(dt, t);
    }

    /// Volant : vitesse vers l'entree et retour au centre, separes.
    fn volant(&mut self, dt: f32, input: Input, t: &Tuning) {
        let monte = input.steer.abs() > self.steer.abs() && input.steer * self.steer >= 0.0;
        let rate = if monte { t.braquage_vitesse } else { t.braquage_retour };
        self.steer += clamp(input.steer - self.steer, -rate * dt, rate * dt);
    }

    /// Rotation de la caisse : elle suit le volant avec un court retard, plus
    /// d'autorite en glisse, et revient vers la trajectoire quand on relache.
    /// Contre-braquer reduit donc la rotation et fait sortir du drift.
    fn lacet(&mut self, dt: f32, input: Input, t: &Tuning) {
        let (fx, fz) = (self.yaw.sin(), self.yaw.cos());
        let vf = self.vx * fx + self.vz * fz;
        let vl = self.vx * fz - self.vz * fx;
        let spd = vf.hypot(vl);
        let dir = if vf >= -0.5 { 1.0 } else { -1.0 };
        // a l'arret, braquer ne fait pas tourner la voiture
        let roule = clamp(spd / 4.0, 0.0, 1.0);
        let glisse = if vf > 1.0 { clamp(vl.atan2(vf).abs() / 0.35, 0.0, 1.0) } else { 0.0 };
        let mut cible = self.steer * t.lacet_max(spd) * roule * dir;
        cible *= 1.0 + (t.lacet_drift - 1.0) * glisse;
        if input.handbrake {
            cible *= 1.3;
        }
        if vf > 1.0 {
            cible += vl.atan2(vf) * t.alignement * glisse;
        }
        self.yaw_rate += (cible - self.yaw_rate) * (t.lacet_reponse * dt).min(1.0);
        self.yaw += self.yaw_rate * dt;
    }

    /// Propulsion, freinage, roue libre, boost. Renvoie la nouvelle `vf`.
    fn longitudinal(&mut self, dt: f32, input: Input, t: &Tuning, c: &Contact, vf: f32, spd: f32) -> f32 {
        let mut vf = vf;
        let gaz = input.throttle;
        let frein = input.brake;
        let pousse = c.sol.facteur(spd) * (1.0 - self.penalite) * (1.0 - c.coupure);

        // propulsion nette : la courbe est deja l'acceleration voulue
        let mut a = 0.0;
        if gaz > 0.0 {
            if vf >= -1.0 {
                a += t.courbe(vf.max(0.0)) * gaz * pousse;
            } else {
                a += t.frein * c.sol.freinage * gaz;
            }
        }
        self.forces.propulsion = a;

        // freins : ils ne font jamais changer le sens de marche d'un coup
        let mut retire = 0.0;
        if frein > 0.0 {
            if vf > 1.0 {
                retire += t.frein * c.sol.freinage * frein;
            } else if gaz < 0.1 {
                // a l'arret, le frein enclenche la marche arriere
                a -= t.recul_accel * frein * (1.0 - clamp(-vf / t.recul_max, 0.0, 1.0));
            }
        }
        if input.handbrake {
            retire += t.drift_ralenti;
        }
        if gaz < 0.05 && frein < 0.05 {
            retire += t.roue_libre + c.sol.roulement;
        }
        self.forces.freinage = -retire;

        let boosting = input.boost && self.boost > 0.0;
        self.boosting = boosting;
        if boosting && !self.was_boosting {
            self.events.push(CarEvent::Boost);
        }
        self.was_boosting = boosting;
        if boosting {
            // la poussee s'eteint en approchant la vitesse max au boost
            let reste = (t.vmax_boost() - spd) / (t.vmax_boost() * 0.08);
            a += t.boost_accel * reste.clamp(0.0, 1.0);
            self.boost = (self.boost - dt / t.boost_drain).max(0.0);
        } else if vf > t.vmax() {
            // au-dessus de la vitesse max sans boost : retour en douceur
            a -= t.sur_vitesse * ((vf - t.vmax()) / 8.0).min(1.0);
        }

        vf += a * dt;
        vers_zero(vf, retire * dt)
    }

    /// Force laterale bornee, glisse rendue, trainee du drift, speedslide.
    #[allow(clippy::too_many_arguments)]
    fn lateral(&mut self, dt: f32, input: Input, t: &Tuning, c: &Contact, vf: f32, vl: f32, spd: f32) -> (f32, f32) {
        let mut vf = vf;
        let mut vl = vl;
        // capacite reduite par la touche drift seule, filtree
        let voulu = if input.handbrake { t.drift_adherence } else { 1.0 };
        self.prise += (voulu - self.prise) * (8.0 * dt).min(1.0);
        let cap = t.capacite(spd) * c.sol.adherence * self.prise;

        let avant = vl;
        let a_l = clamp(-vl * t.raideur, -cap, cap);
        vl += a_l * dt;
        if vl * avant < 0.0 {
            vl = 0.0;
        }
        self.forces.laterale = a_l;
        if vf > 0.0 {
            vf += (avant.abs() - vl.abs()).max(0.0) * t.glisse_rendue;
            let s = vl.atan2(vf).sin();
            vf -= vf * t.trainee_drift * s * s * dt;
        }

        // speedslide : une glisse dans la fenetre optimale pousse un peu, a
        // condition de tenir les gaz ; trop d'angle coute
        self.speedslide = false;
        self.forces.speedslide = 0.0;
        if t.speedslide > 0.0 && c.sol.ss_gain > 0.0 && input.throttle > 0.9 && vf > 20.0 {
            let angle = vl.atan2(vf).abs();
            let opt = t.ss_angle(spd) * c.sol.ss_angle;
            let ecart = angle - opt;
            let gain = if angle > opt - t.ss_largeur {
                t.speedslide * c.sol.ss_gain * (1.0 - ecart.abs() / t.ss_largeur).max(0.0)
            } else {
                0.0
            };
            let perte = if ecart > t.ss_largeur { (t.ss_exces * (ecart - t.ss_largeur)).min(4.0) } else { 0.0 };
            let a = (gain * input.throttle * (1.0 - self.penalite) - perte) * (1.0 - spd / PLAFOND).max(0.0).sqrt();
            vf += a * dt;
            self.forces.speedslide = a;
            self.speedslide = gain > 0.0;
        }
        (vf, vl)
    }

    fn drift_logic(&mut self, dt: f32, t: &Tuning) {
        let drifting = self.sliding
            && self.slip.abs() > t.drift_min_angle
            && self.speed > t.drift_min_speed;
        if drifting {
            self.drift_end_timer = 0.0;
            let a = self.slip.abs();
            self.boost = (self.boost + dt * clamp(a / 0.5, 0.5, 1.5) / t.drift_fill).min(1.0);
            self.drift_points += self.speed * a * dt * 3.0;
        } else if self.drift_points > 0.0 {
            self.drift_end_timer += dt;
            if self.drift_end_timer > 0.25 {
                self.end_drift();
            }
        }
        self.drifting = drifting;
    }

    fn end_drift(&mut self) {
        let pts = self.drift_points.round() as u32;
        if pts > 0 {
            self.score += pts;
            self.events.push(CarEvent::Bank(pts));
        }
        self.drift_points = 0.0;
        self.drift_end_timer = 0.0;
    }

    /// Un choc dans un muret annule les points du drift en cours.
    pub fn cancel_drift(&mut self) {
        self.drift_points = 0.0;
        self.drift_end_timer = 0.0;
    }

    /// Fait tourner le repere sous la voiture de `a` radians vers la droite :
    /// le cap et la vitesse, exprimes dans ce repere, tournent de `-a`. C'est
    /// ce qui rend un virage de la piste reellement a negocier.
    pub fn rotate_frame(&mut self, a: f32) {
        if a == 0.0 {
            return;
        }
        let (s, c) = a.sin_cos();
        let (vx, vz) = (self.vx, self.vz);
        self.vx = vx * c - vz * s;
        self.vz = vz * c + vx * s;
        self.yaw -= a;
    }
}
