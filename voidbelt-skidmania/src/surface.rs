//! Profils de surface : chaque sol module la conduite de base (`Tuning`).
//!
//! Seul l'asphalte est calibre ; c'est le seul sol du circuit actuel. Les
//! autres profils sont des estimations de depart pour Skid Mania, pas des
//! valeurs mesurees sur Trackmania : a regler le jour ou un trace les pose
//! (`Seg::Sol` dans trace.rs).

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum Sol {
    #[default]
    Asphalte = 0,
    Terre = 1,
    Herbe = 2,
    Glace = 3,
    Plastique = 4,
}

/// Coefficients d'un sol, appliques aux reglages de base.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Profil {
    /// Multiplie la courbe d'acceleration.
    pub propulsion: f32,
    /// Au-dela de cette vitesse (m/s), la propulsion decroit lineairement
    /// jusqu'a 0 a 600 km/h (un sol qui bride la vitesse de pointe).
    pub propulsion_coude: f32,
    /// Multiplie la capacite laterale.
    pub adherence: f32,
    /// Resistance au roulement (m/s2), ajoutee seulement pied leve.
    pub roulement: f32,
    /// Multiplie le freinage.
    pub freinage: f32,
    /// Multiplie le gain du speedslide, et l'angle optimal.
    pub ss_gain: f32,
    pub ss_angle: f32,
}

const SANS_COUDE: f32 = 1.0e6;

pub const fn profil(sol: Sol) -> Profil {
    match sol {
        Sol::Asphalte => Profil {
            propulsion: 1.0,
            propulsion_coude: SANS_COUDE,
            adherence: 1.0,
            roulement: 0.0,
            freinage: 1.0,
            ss_gain: 1.0,
            ss_angle: 1.0,
        },
        Sol::Terre => Profil {
            propulsion: 0.9,
            propulsion_coude: 90.0,
            adherence: 0.6,
            roulement: 1.0,
            freinage: 0.75,
            ss_gain: 1.3,
            ss_angle: 1.8,
        },
        Sol::Herbe => Profil {
            propulsion: 0.75,
            propulsion_coude: 70.0,
            adherence: 0.5,
            roulement: 2.0,
            freinage: 0.6,
            ss_gain: 1.0,
            ss_angle: 2.0,
        },
        Sol::Glace => Profil {
            propulsion: 0.8,
            propulsion_coude: SANS_COUDE,
            adherence: 0.12,
            roulement: 0.2,
            freinage: 0.2,
            ss_gain: 0.0,
            ss_angle: 1.0,
        },
        Sol::Plastique => Profil {
            propulsion: 0.85,
            propulsion_coude: 80.0,
            adherence: 0.8,
            roulement: 1.5,
            freinage: 0.9,
            ss_gain: 0.7,
            ss_angle: 1.2,
        },
    }
}

impl Profil {
    /// Facteur de propulsion a la vitesse `v`, coude compris.
    pub fn facteur(&self, v: f32) -> f32 {
        if v <= self.propulsion_coude {
            return self.propulsion;
        }
        let fin = crate::car::PLAFOND;
        let k = ((fin - v) / (fin - self.propulsion_coude).max(1.0)).clamp(0.0, 1.0);
        self.propulsion * k
    }
}
