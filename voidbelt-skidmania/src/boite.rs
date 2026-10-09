//! Boite de vitesses : de la vitesse de la voiture et des pedales, au regime,
//! au rapport et a ce que fait le moteur (coupure, frein moteur).
//!
//! Adaptee de la boite virtuelle de Skidball, mais etagee sur la voiture et
//! sa vraie vitesse de pointe (sans boost) : la premiere tient jusqu'a 20 %
//! de cette vitesse, l'avant-dernier rapport passe vers 95 %, et le dernier,
//! un cran plus long, recoit la vitesse de pointe. Progression geometrique
//! entre les deux. Pendant le boost, le moteur peut frôler la zone rouge sans
//! que l'injection ne coupe : la voiture va alors plus vite que sa boite.
//! Le moteur (ralenti, zone rouge, nombre de rapports, regime de passage,
//! duree du passage, reactivite) vient de la recette choisie dans la
//! Creation : `regler`.
//!
//! Le moteur a une inertie : il ne prend des tours qu'a un rythme borne,
//! l'embrayage absorbant l'ecart. Sans cela, la Koenigsegg accelere si fort
//! que chaque rapport serait balaye en un instant.

/// Ce que la recette du moteur impose a la boite.
#[derive(Clone, Copy, Debug)]
pub struct Moteur {
    pub ralenti: f32,
    pub zone_rouge: f32,
    pub rapports: u32,
    /// Regime de passage, en part de la zone rouge.
    pub passage: f32,
    /// Duree d'un passage (s), injection coupee.
    pub temps_passage: f32,
    /// 0 (lourd) a 1 (vif).
    pub reactivite: f32,
}

/// Le V8 a vilebrequin plat de la Koenigsegg (« Raptor » dans la Creation).
pub const RAPTOR: Moteur = Moteur {
    ralenti: 1000.0,
    zone_rouge: 9000.0,
    rapports: 6,
    passage: 0.93,
    temps_passage: 0.07,
    reactivite: 0.9,
};

/// Part de la vitesse de pointe couverte par la premiere.
const PREMIERE: f32 = 0.2;
/// Part de la vitesse de pointe ou l'avant-dernier rapport passe.
const AVANT_DERNIER: f32 = 0.95;

/// Regime du dernier rapport a la vitesse max sans boost, en part de la
/// zone rouge : le plus bas possible, juste au-dessus du seuil ou la boite
/// redescendrait (0,45). A fond sur le plat, le moteur cruise au lieu de
/// hurler ; au boost, il remonte un peu sans approcher la zone rouge.
const DERNIER_REGIME: f32 = 0.52;

/// Vitesse sur laquelle la boite s'etage (m/s) : la vitesse max sans boost.
pub fn vitesse_de_pointe(t: &crate::tune::Tuning) -> f32 {
    t.vmax()
}

#[derive(Clone, Copy, Debug, Default)]
pub struct Entree {
    /// Vitesse longitudinale (m/s, negative en marche arriere).
    pub vitesse: f32,
    pub gaz: f32,
    pub frein: f32,
    /// Glisse laterale (m/s) : en drift, les roues patinent, le regime monte.
    pub glisse: f32,
    /// Voiture immobilisee (compte a rebours) : point mort.
    pub point_mort: bool,
    /// Boost en cours : pas de rupteur.
    pub boost: bool,
}

#[derive(Clone, Debug)]
pub struct Boite {
    pub m: Moteur,
    /// Vitesse de pointe de la voiture, sans boost (m/s).
    pub v_max: f32,
    /// 0 = point mort, -1 = marche arriere, 1.. = rapports.
    pub rapport: i32,
    pub rpm: f32,
    pub coupure: bool,
    pub lever: bool,
    pub charge: f32,
    passage: f32,
    coup: f32,
    limite: f32,
    apres_passage: f32,
}

impl Boite {
    pub fn new(m: Moteur, v_max: f32) -> Boite {
        Boite {
            m,
            v_max,
            rapport: 0,
            rpm: m.ralenti,
            coupure: false,
            lever: false,
            charge: 0.24,
            passage: 0.0,
            coup: 0.0,
            limite: 0.0,
            apres_passage: m.ralenti,
        }
    }

    pub fn regler(&mut self, m: Moteur, v_max: f32) {
        self.m = m;
        self.v_max = v_max.max(1.0);
        self.rapport = self.rapport.min(m.rapports as i32);
        self.rpm = self.rpm.clamp(m.ralenti, m.zone_rouge);
    }

    /// Ecart geometrique entre deux rapports.
    fn q(&self) -> f32 {
        let n = self.m.rapports.max(1) as i32;
        let etendue = AVANT_DERNIER / PREMIERE;
        if n <= 2 { etendue } else { etendue.powf(1.0 / (n - 2) as f32) }
    }

    /// Regime par m/s sur le rapport `g` (1 a `rapports`).
    pub fn k(&self, g: i32) -> f32 {
        let m = &self.m;
        let n = m.rapports.max(1) as i32;
        let premiere = m.passage * m.zone_rouge / (PREMIERE * self.v_max);
        if n == 1 {
            return 0.85 * m.zone_rouge / self.v_max;
        }
        let g = g.clamp(1, n);
        let k = premiere / self.q().powi(g - 1);
        if g == n {
            // le dernier rapport, aussi long que possible
            k.min(DERNIER_REGIME * m.zone_rouge / self.v_max)
        } else {
            k
        }
    }

    pub fn maj(&mut self, e: Entree, dt: f32) {
        let m = self.m;
        let zr = m.zone_rouge;
        let gaz = e.gaz.clamp(0.0, 1.0);

        // Point mort : le moteur tourne a vide, on peut le faire rugir.
        if e.point_mort {
            self.rapport = 0;
            self.passage = 0.0;
            let cible = m.ralenti + gaz * (zr * 0.8 - m.ralenti);
            let vif = if cible > self.rpm { 2.5 + m.reactivite * 4.0 } else { 3.0 };
            self.rpm += (cible - self.rpm) * (vif * dt).min(1.0);
            self.finir(gaz, false, dt);
            return;
        }

        // Marche arriere : un seul rapport, court.
        if e.vitesse < -0.5 {
            self.rapport = -1;
            let cible = (-e.vitesse * self.k(1)).max(m.ralenti).min(zr);
            self.rpm += (cible - self.rpm) * (8.0 * dt).min(1.0);
            self.finir(e.frein.max(gaz), false, dt);
            return;
        }
        if self.rapport <= 0 {
            self.rapport = 1;
        }

        let v = e.vitesse.max(0.0);
        let mut coupure = false;
        if self.passage > 0.0 {
            self.passage -= dt;
            coupure = true;
        }
        if self.coup > 0.0 {
            self.coup -= dt;
        }
        let n = m.rapports as i32;
        let mut roue = v * self.k(self.rapport);
        if self.passage <= 0.0 {
            let seuil = m.passage * zr;
            if gaz > 0.15 && self.rpm >= seuil && roue > seuil * 0.7 && self.rapport < n {
                // Montee : coupure le temps du passage, le regime retombe de
                // l'ecart entre les deux rapports.
                self.apres_passage = (self.rpm * self.k(self.rapport + 1) / self.k(self.rapport)).max(m.ralenti);
                self.rapport += 1;
                self.passage = m.temps_passage;
                coupure = true;
            } else if self.rapport > 1 && roue < zr * 0.45 && v * self.k(self.rapport - 1) < zr * 0.85 {
                // Descente : petit coup de gaz pour caler le regime.
                self.rapport -= 1;
                self.coup = 0.12;
            }
            roue = v * self.k(self.rapport);
        }

        // Embrayage au depart : il patine vers un tiers de la zone rouge.
        let patine = m.ralenti + gaz * (zr * 0.33 - m.ralenti);
        let mut cible = roue.max(m.ralenti);
        if self.rapport == 1 && roue < patine {
            cible = patine;
        }
        // En drift, les roues arriere patinent : le regime s'envole un peu.
        cible += (e.glisse / 12.0).min(1.0) * gaz * zr * 0.12;
        if self.coup > 0.0 {
            cible += zr * 0.12;
        }
        cible = cible.min(zr);
        if self.passage > 0.0 {
            cible = self.apres_passage;
        }
        if cible > self.rpm {
            let rythme = (zr - m.ralenti) * (0.45 + m.reactivite * 0.65) / (self.rapport as f32).powf(0.75);
            // la Koenigsegg a 900 km/h prend ses rapports en une fraction de
            // seconde : l'inertie du moteur suit l'echelle de la voiture
            // (reglee pour une pointe de 60 m/s, celle d'une voiture normale)
            let echelle = (self.v_max / 60.0).max(1.0);
            let mult = echelle * if self.coup > 0.0 { 3.0 } else { 1.0 };
            self.rpm = cible.min(self.rpm + rythme * dt * mult);
        } else {
            let vif = if self.passage > 0.0 { 3.0 / m.temps_passage.max(0.04) } else { 4.0 + m.reactivite * 10.0 };
            self.rpm += (cible - self.rpm) * (vif * dt).min(1.0);
        }

        // Rupteur : l'injection se coupe et revient en rafale.
        let mut rupteur = false;
        if e.boost {
            self.rpm = self.rpm.min(zr * 0.99);
            self.limite = 0.0;
        } else if self.rpm >= zr * 0.995 && gaz > 0.15 {
            self.limite += dt;
            rupteur = ((self.limite * 16.0) as i32) % 2 == 0;
            if rupteur {
                self.rpm -= zr * 0.02;
            }
        } else {
            self.limite = 0.0;
        }
        let lever = gaz < 0.05 && v > 2.0;
        self.finir(gaz, coupure || rupteur, dt);
        self.lever = lever;
        // Frein moteur : plus d'injection au lever de pied a haut regime.
        if lever && self.rpm > m.ralenti * 1.6 {
            self.coupure = true;
        }
        if self.coup > 0.0 {
            self.coupure = false;
            self.charge = 0.7;
        }
    }

    fn finir(&mut self, gaz: f32, coupure: bool, _dt: f32) {
        self.coupure = coupure;
        self.lever = false;
        self.charge = if gaz > 0.05 { 0.3 + 0.7 * gaz } else { 0.22 };
        self.rpm = self.rpm.clamp(self.m.ralenti * 0.9, self.m.zone_rouge);
    }
}
