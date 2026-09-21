//! Reglages du jeu, modifiables a chaud depuis `/admin`.
//!
//! Tout ce qui se regle vit ici, dans une seule structure. Les valeurs par
//! defaut sont exactement celles qui etaient jusqu'ici ecrites en dur dans
//! chaque module : sans reglage charge, le jeu se comporte a l'identique.
//!
//! La macro ci-dessous engendre d'un coup la structure, ses valeurs par
//! defaut, la liste ordonnee des noms et la conversion vers un tableau de
//! `f32`. C'est volontaire : l'hote lit ces champs par leur position dans le
//! tableau, et une liste tenue a la main finirait par se desynchroniser du
//! jour ou l'on ajoute un reglage au milieu.

use crate::{ball, boost, bot, car, collide, game};

macro_rules! reglages {
    ($($key:ident = $val:expr,)*) => {
        #[derive(Clone, Copy, Debug, PartialEq)]
        pub struct Tune {
            $(pub $key: f32,)*
        }

        impl Tune {
            /// Valeurs de fabrique. Constante, pour que les tests et le
            /// bouton de remise a zero partent exactement du meme point.
            pub const FACTORY: Tune = Tune { $($key: $val,)* };
        }

        impl Default for Tune {
            fn default() -> Tune {
                Tune::FACTORY
            }
        }

        /// Noms des reglages, dans l'ordre du tableau. L'hote les lit depuis
        /// le wasm plutot que de les recopier : impossible de deriver.
        pub const KEYS: &[&str] = &[$(stringify!($key)),*];

        impl Tune {
            /// Ecrit les reglages dans `out`, dans l'ordre de `KEYS`.
            pub fn write(&self, out: &mut [f32]) {
                let mut i = 0;
                $(
                    if i < out.len() {
                        out[i] = self.$key;
                    }
                    i += 1;
                )*
                let _ = i;
            }

            /// Relit les reglages depuis `v`. Une valeur absente ou aberrante
            /// laisse le champ inchange : une interface qui envoie un
            /// tableau tronque ou un `NaN` ne doit pas casser la partie.
            pub fn read(&mut self, v: &[f32]) {
                let mut i = 0;
                $(
                    if let Some(&x) = v.get(i) {
                        if x.is_finite() {
                            self.$key = x;
                        }
                    }
                    i += 1;
                )*
                let _ = i;
            }
        }
    };
}

reglages! {
    // ------------------------------------------------------------ voiture --
    drive_max = car::DRIVE_MAX,
    speed_max = car::SPEED_MAX,
    supersonic = car::SUPERSONIC,
    throttle_a = car::THROTTLE_A,
    boost_a = car::BOOST_A,
    brake_a = car::BRAKE_A,
    coast_a = car::COAST_A,
    turn_slow = car::TURN_SLOW,
    turn_fast = car::TURN_FAST,
    drift_turn = car::DRIFT_TURN,
    grip = car::GRIP,
    grip_drift = car::GRIP_DRIFT,
    wall_align = car::WALL_ALIGN,
    car_mass = car::MASS,
    car_half_len = car::HALF_LEN,
    car_half_wid = car::HALF_WID,
    car_radius = car::RADIUS,

    // -------------------------------------------------------------- boost --
    boost_max = car::BOOST_MAX,
    boost_use = car::BOOST_USE,
    kickoff_boost = car::KICKOFF_BOOST,

    // --------------------------------------------------------- demolition --
    demo_speed = car::DEMO_SPEED,
    demo_time = car::DEMO_TIME,

    // ---------------------------------------------------------- collisions -
    car_rest = collide::CAR_REST,
    ball_rest = collide::BALL_REST,
    bump_gain = collide::BUMP_GAIN,
    bump_floor = collide::BUMP_FLOOR,
    bump_cap = collide::BUMP_CAP,
    contact_radius = collide::CAR_R,

    // --------------------------------------------------------------- balle -
    ball_radius = ball::RADIUS,
    ball_mass = ball::MASS,
    ball_max_speed = ball::MAX_SPEED,
    ball_drag = ball::DRAG,
    ball_wall_rest = ball::WALL_REST,
    ball_wall_fric = ball::WALL_FRIC,

    // Poussee d'une frappe selon la vitesse du chassis, reprise de la table
    // du vrai jeu : elle croit vite puis sature, d'ou les frappes molles a
    // l'arret. Six paliers, aux vitesses fixes de `collide::PUSH_AT`.
    push_0 = collide::PUSH[0].1,
    push_1 = collide::PUSH[1].1,
    push_2 = collide::PUSH[2].1,
    push_3 = collide::PUSH[3].1,
    push_4 = collide::PUSH[4].1,
    push_5 = collide::PUSH[5].1,

    // --------------------------------------------------------------- plots -
    pad_big_amount = boost::BIG_AMOUNT,
    pad_small_amount = boost::SMALL_AMOUNT,
    pad_big_delay = boost::BIG_DELAY,
    pad_small_delay = boost::SMALL_DELAY,
    pad_big_radius = boost::BIG_R,
    pad_small_radius = boost::SMALL_R,

    // --------------------------------------------------------------- match -
    countdown = game::COUNTDOWN,
    countdown_lead = game::COUNTDOWN_LEAD,
    celebrate = game::CELEBRATE,
    save_range = game::SAVE_RANGE,

    // ----------------------------------------------------------------- bot -
    bot_swing = bot::SWING,
    bot_approach_pad = 8.0,
}

pub const FIELDS: usize = KEYS.len();

impl Tune {
    /// Tableau des reglages, prêt a etre lu par l'hote.
    pub fn to_vec(&self) -> Vec<f32> {
        let mut v = vec![0.0; FIELDS];
        self.write(&mut v);
        v
    }

    /// Distance a laquelle le bot vise le ballon : derivee de la taille de
    /// la voiture et de la balle, pour qu'un changement de gabarit ne le
    /// laisse pas viser dans le vide.
    pub fn bot_approach(&self) -> f32 {
        self.car_half_len + self.ball_radius + self.bot_approach_pad
    }

    /// Instant, dans le decompte, ou le premier chiffre s'affiche.
    pub fn count_from(&self) -> f32 {
        self.countdown - self.countdown_lead
    }
}

/// Noms mis bout a bout, separes par des sauts de ligne. L'hote relit ce
/// bloc d'octets pour connaitre l'ordre exact des reglages sans avoir a le
/// redeclarer de son cote.
pub fn keys_blob() -> Vec<u8> {
    KEYS.join("\n").into_bytes()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn un_aller_retour_ne_perd_rien() {
        let mut t = Tune::default();
        t.drive_max = 512.0;
        t.bump_cap = 7.5;
        let v = t.to_vec();
        let mut back = Tune::default();
        back.read(&v);
        assert_eq!(t, back);
    }

    #[test]
    fn les_noms_suivent_les_champs() {
        assert_eq!(KEYS.len(), FIELDS);
        assert_eq!(Tune::default().to_vec().len(), FIELDS);
        // Un doublon ferait pointer deux reglages sur la meme case.
        let mut vus: Vec<&str> = KEYS.to_vec();
        vus.sort_unstable();
        vus.dedup();
        assert_eq!(vus.len(), FIELDS, "deux reglages portent le meme nom");
    }

    #[test]
    fn une_valeur_aberrante_est_ignoree() {
        let mut t = Tune::default();
        let avant = t.drive_max;
        let mut v = t.to_vec();
        v[0] = f32::NAN;
        t.read(&v);
        assert_eq!(t.drive_max, avant, "un NaN a traverse");
    }

    #[test]
    fn un_tableau_tronque_laisse_le_reste_intact() {
        let mut t = Tune::default();
        let attendu = t.celebrate;
        t.read(&[999.0]);
        assert_eq!(t.drive_max, 999.0);
        assert_eq!(t.celebrate, attendu, "la troncature a efface la suite");
    }
}
