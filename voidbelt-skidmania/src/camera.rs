//! Camera facon Trackmania : reactive, lisible, jamais cinematique.
//!
//! Trois modes : 0 exterieure proche (defaut), 1 exterieure haute et
//! eloignee, 2 embarquee. Cadrages approximatifs, sans video de reference :
//! tous les chiffres sont dans `tune.rs` (cam*).
//!
//! Elle tourne a chaque image de rendu, sur la pose interpolee de la voiture
//! (`state::Pose`), pas sur les pas de physique : pas de micro-saccades.
//! Ses lissages sont exponentiels, donc independants du framerate, et
//! separes : cap, haut, distance, point regarde, champ. Le suivi de position
//! reste colle a la voiture (aucun retard a 600 km/h) ; seule la composante
//! verticale est amortie, pour absorber les receptions.
//!
//! Le haut de la camera suit la normale de la piste sous la voiture : le
//! ruban du trace est continu, il n'y a ni triangle ni bloc a enjamber, donc
//! aucune bascule soudaine en loop ou en wallride. En vol, elle garde ce
//! dernier repere puis revient vers la verticale du monde.

use crate::car::PLAFOND;
use crate::state::Pose;
use crate::track::{Track, HALF_WIDTH};
use crate::tune::Tuning;
use crate::vec::{v3, V3};

pub const PROCHE: u32 = 0;
pub const LOIN: u32 = 1;
pub const EMBARQUEE: u32 = 2;

pub struct Camera {
    /// Mode choisi par le joueur.
    pub mode: u32,
    pub pos: V3,
    pub target: V3,
    pub up: V3,
    pub fov: f32,
    pub dist: f32,
    /// Part de la distance laissee libre par un obstacle (1 = rien).
    pub degage: f32,
    dir: V3,
    suivi: V3,
    regard: V3,
    /// Assistance loop : 0 = mode choisi, 1 = embarquee.
    bascule: f32,
    secousse: f32,
    secousse_amp: f32,
    horloge: f32,
    vu: Option<(u32, bool)>,
}

/// Facteur de lissage exponentiel pour un taux `k` (1/s) sur `dt`.
fn lisse(k: f32, dt: f32) -> f32 {
    1.0 - (-k * dt).exp()
}

/// `v` sans sa composante selon `n`, normalise ; `repli` si degenere.
fn plan(v: V3, n: V3, repli: V3) -> V3 {
    let p = v - n * v.dot(n);
    if p.len() > 1e-3 {
        p.norm()
    } else {
        repli
    }
}

/// Va de `a` vers `b` (unitaires) ; evite le demi-tour par un vecteur nul.
fn vers(a: V3, b: V3, k: f32) -> V3 {
    let m = a + (b - a) * k;
    if m.len() < 1e-3 {
        b
    } else {
        m.norm()
    }
}

impl Camera {
    pub fn new() -> Camera {
        Camera {
            mode: PROCHE,
            pos: V3::ZERO,
            target: V3::ZERO,
            up: v3(0.0, 1.0, 0.0),
            fov: 70.0,
            dist: 6.6,
            degage: 1.0,
            dir: v3(0.0, 0.0, 1.0),
            suivi: V3::ZERO,
            regard: V3::ZERO,
            bascule: 0.0,
            secousse: 0.0,
            secousse_amp: 0.0,
            horloge: 0.0,
            vu: None,
        }
    }

    /// La camera est dans (ou presque dans) la voiture : on ne la dessine pas.
    pub fn voiture_cachee(&self) -> bool {
        self.bascule > 0.3
    }

    /// Mode montre a l'ecran : l'embarquee pendant un looping.
    pub fn mode_vu(&self) -> u32 {
        if self.voiture_cachee() { EMBARQUEE } else { self.mode }
    }

    /// Oublie tout lissage : la prochaine image recale la camera.
    pub fn snap(&mut self) {
        self.vu = None;
    }

    /// Un choc : courte secousse, proportionnelle a sa severite.
    pub fn choc(&mut self, severite: f32, t: &Tuning) {
        self.secousse = 0.25;
        self.secousse_amp = t.cam_choc * severite.clamp(0.0, 1.0);
    }

    fn reglage(&self, t: &Tuning, mode: u32) -> (f32, f32, f32, f32, f32) {
        match mode {
            LOIN => (t.cam1_dist, t.cam1_dist_max, t.cam1_haut, t.cam1_fov, t.cam1_fov_max),
            EMBARQUEE => (0.0, 0.0, t.cam2_haut, t.cam2_fov, t.cam2_fov_max),
            _ => (t.cam0_dist, t.cam0_dist_max, t.cam0_haut, t.cam0_fov, t.cam0_fov_max),
        }
    }

    pub fn update(&mut self, dt: f32, p: &Pose, derriere: bool, t: &Tuning, track: &Track) {
        self.horloge += dt;
        let neuf = self.vu != Some((self.mode, derriere));
        if neuf {
            // changement de mode ou de sens : aucun lissage n'est garde
            self.vu = Some((self.mode, derriere));
            self.up = p.ref_up;
            self.dir = plan(p.fwd, p.ref_up, p.fwd) * if derriere { -1.0 } else { 1.0 };
            self.suivi = p.pos;
            self.regard = V3::ZERO;
            self.degage = 1.0;
            let (d, _, _, f, _) = self.reglage(t, self.mode);
            self.dist = d;
            self.fov = f;
            self.bascule = if self.mode == EMBARQUEE { 1.0 } else { 0.0 };
        }
        let k = |taux: f32| if neuf { 1.0 } else { lisse(taux, dt) };
        let v01 = (p.speed / PLAFOND).clamp(0.0, 1.0);

        // le haut : normale de la piste, puis la verticale apres un temps en vol
        let mut haut = p.ref_up;
        if p.air > 0.5 && p.air_t > t.cam_vol_retour {
            let r = ((p.air_t - t.cam_vol_retour) * 1.5).min(1.0);
            haut = vers(haut, v3(0.0, 1.0, 0.0), r);
        }
        self.up = vers(self.up, haut, k(t.cam_lissage_rot));

        // le cap : surtout la carrosserie, un peu la trajectoire ; a basse
        // vitesse ou en marche arriere, la carrosserie seule
        let avant = plan(p.fwd, self.up, self.dir);
        let roule = p.vel.dot(p.fwd) > 0.0 && p.speed > 5.0;
        let w = if roule { t.cam_vitesse_dir * ((p.speed - 5.0) / 10.0).clamp(0.0, 1.0) } else { 0.0 };
        let trajet = if roule { plan(p.vel, self.up, avant) } else { avant };
        let mut cap = vers(avant, trajet, w);
        if derriere {
            cap = cap * -1.0;
        }
        self.dir = vers(plan(self.dir, self.up, cap), cap, k(t.cam_lissage_rot));

        // suivi : colle a la voiture, la hauteur seule est amortie
        let ecart = p.pos - self.suivi;
        let vertical = ecart.dot(self.up);
        self.suivi = self.suivi + ecart - self.up * (vertical * (1.0 - k(t.cam_lissage_pos)));

        let (d, dmax, h, f, fmax) = self.reglage(t, self.mode);
        self.dist += (d + (dmax - d) * v01 - self.dist) * k(t.cam_lissage_pos * 0.3);
        self.fov += (f + (fmax - f) * v01 - self.fov) * k(t.cam_lissage_fov);

        // point regarde : au-dessus de la voiture, porte devant selon la vitesse
        let lead = (p.speed * t.cam_anticipation).min(t.cam_anticipation_max);
        let devant = if roule { trajet } else { avant };
        let regard = self.up * t.cam_cible_haut + devant * lead * if derriere { -1.0 } else { 1.0 };
        self.regard = self.regard + (regard - self.regard) * k(t.cam_lissage_cible);
        // dans un creux ou un looping, la tangente plonge sous la route qui
        // remonte : le point regarde reste au-dessus de la chaussee
        let cible = au_dessus(track, self.suivi + self.regard, p.s, t.cam_cible_haut * 0.8);

        // exterieure, rapprochee si la piste masque la voiture
        let libre = self.obstacle(cible, self.suivi - self.dir * self.dist + self.up * h, p.s, track);
        if libre < self.degage {
            self.degage = libre;
        } else {
            self.degage += (libre - self.degage) * k(2.0);
        }
        let ext = self.suivi - self.dir * (self.dist * self.degage) + self.up * (h * self.degage.max(0.5));
        let ext = au_dessus(track, ext, p.s, GARDE);

        // embarquee : dans la voiture, sur la pose sans suspension
        let int = p.pos + p.fwd * t.cam2_avant + p.up * t.cam2_haut;
        let int_cible = int + p.fwd * 20.0 * if derriere { -1.0 } else { 1.0 };

        // loopings : embarquee le temps du looping, puis retour au mode choisi
        let en_loop = t.cam_loop_auto > 0.5 && track.dans_looping(p.s, t.cam_loop_avant, t.cam_loop_apres);
        let veut = if self.mode == EMBARQUEE || en_loop { 1.0 } else { 0.0 };
        self.bascule += (veut - self.bascule) * if self.mode == EMBARQUEE { 1.0 } else { k(t.cam_loop_fondu) };
        let b = self.bascule;
        self.pos = ext + (int - ext) * b;
        self.target = cible + (int_cible - cible) * b;
        self.up = if b > 0.5 { vers(self.up, p.up, b) } else { self.up };
        if b > 0.0 {
            let (_, _, _, fi, fimax) = self.reglage(t, EMBARQUEE);
            self.fov += (fi + (fimax - fi) * v01 - self.fov) * b;
        }

        if self.secousse > 0.0 {
            self.secousse -= dt;
            let a = self.secousse_amp * (self.secousse / 0.25).max(0.0);
            self.pos = self.pos + self.up * ((self.horloge * 61.0).sin() * a) + self.dir.cross(self.up) * ((self.horloge * 47.0).sin() * a * 0.6);
        }
    }

    /// Part (0..1) du trajet cible -> camera libre de la piste : un point
    /// sous la chaussee voisine de la voiture masque la vue.
    fn obstacle(&self, cible: V3, cam: V3, s: f32, track: &Track) -> f32 {
        const N: usize = 6;
        for i in 1..=N {
            let k = i as f32 / N as f32;
            let q = cible + (cam - cible) * k;
            let mut sq = s;
            for _ in 0..4 {
                let f = track.frame_at(sq);
                sq += (q - f.p).dot(f.t);
            }
            let f = track.frame_at(sq);
            let d = q - f.p;
            // projection convergee (en loop, le repere tourne vite) et point
            // franchement sous la chaussee : la vue est coupee
            let converge = d.dot(f.t).abs() < 0.5;
            if converge && (sq - s).abs() < 40.0 && d.dot(f.r).abs() < HALF_WIDTH + 2.0 && d.dot(f.u) < -0.2 && d.dot(f.u) > -8.0 {
                return (k - 1.0 / N as f32).max(0.3) * 0.9;
            }
        }
        1.0
    }
}

/// Hauteur minimale de la camera au-dessus de la chaussee (m).
const GARDE: f32 = 0.6;

/// Repousse `q` a `garde` m au moins au-dessus de la chaussee voisine de
/// `s` s'il passe dessous (concavite d'un looping, bas d'une descente).
fn au_dessus(track: &Track, q: V3, s: f32, garde: f32) -> V3 {
    let mut sq = s;
    for _ in 0..4 {
        let f = track.frame_at(sq);
        sq += (q - f.p).dot(f.t);
    }
    if (sq - s).abs() > 40.0 {
        return q;
    }
    let f = track.frame_at(sq);
    let d = q - f.p;
    let h = d.dot(f.u);
    if h < garde && h > -6.0 && d.dot(f.r).abs() < HALF_WIDTH + 2.0 {
        q + f.u * (garde - h)
    } else {
        q
    }
}

impl Default for Camera {
    fn default() -> Self {
        Camera::new()
    }
}
