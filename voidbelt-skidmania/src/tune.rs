//! Tous les reglages de conduite et de camera, au meme endroit.
//!
//! Ce sont des reglages de depart pour Skid Mania, choisis pour approcher la
//! Stadium Car de Trackmania 2020 (voir README-CONDUITE.md) : aucun n'est une
//! constante officielle de Trackmania, tous sont a calibrer.
//!
//! La structure est `repr(C)` et ne contient que des `f32` : le navigateur la
//! voit comme un tableau dans la memoire du module et peut la modifier en
//! direct (`skidmania.tuning.adherence = 30` dans la console). Les noms sont
//! lus depuis le module (`sm_tuning_keys`) : l'hote ne les recopie pas.

macro_rules! reglages {
    ($($(#[$doc:meta])* $key:ident = $val:expr,)*) => {
        #[repr(C)]
        #[derive(Clone, Copy, Debug, PartialEq)]
        pub struct Tuning {
            $($(#[$doc])* pub $key: f32,)*
        }

        /// Les reglages de depart du jeu.
        pub const TUNING: Tuning = Tuning { $($key: $val,)* };

        /// Noms des champs, dans l'ordre de la memoire.
        pub const KEYS: &[&str] = &[$(stringify!($key)),*];
    };
}

reglages! {
    // ------------------------------------------------------- vitesses --
    /// Vitesse max sans boost (km/h) : la courbe d'acceleration s'y annule,
    /// la boite s'y etage. Au-dessus (boost, descente), la voiture revient
    /// doucement vers elle.
    vitesse_max = 560.0,
    /// Vitesse max au boost (km/h), jamais au-dela de 600.
    vitesse_max_boost = 600.0,
    /// Retour vers la vitesse max quand on la depasse sans boost (m/s2).
    sur_vitesse = 2.0,

    // ---------------------------------------------------- acceleration --
    /// Acceleration nette sur route plate (m/s2) a 0, 100, 200, 300, 400,
    /// 500, 550 et 590 km/h ; elle tombe a 0 a 600 km/h. Interpolee. Ces
    /// vitesses sont donnees pour une vitesse max de 600 : la courbe garde
    /// sa forme et s'etire sur `vitesse_max`.
    acc_0 = 14.0,
    acc_100 = 12.0,
    acc_200 = 9.0,
    acc_300 = 6.0,
    acc_400 = 4.0,
    acc_500 = 2.0,
    acc_550 = 1.0,
    acc_590 = 0.3,
    /// Multiplie toute la courbe (reglage joueur).
    puissance = 1.0,
    /// Frein seul (m/s2).
    frein = 26.0,
    /// Pied leve, ni gaz ni frein (m/s2) : ralentissement doux.
    roue_libre = 2.5,
    /// Marche arriere : vitesse max (m/s) et acceleration (m/s2).
    recul_max = 15.0,
    recul_accel = 8.0,
    /// Gravite (m/s2), au sol le long de la piste et en vol.
    gravite = 9.81,
    /// Part de la gravite qui tire la voiture vers le bas d'un devers ou
    /// d'un wallride (l'adherence magnetique retient le reste).
    gravite_laterale = 0.35,

    // ------------------------------------------------------- direction --
    /// Vitesse du volant vers l'entree, puis retour au centre (1/s).
    braquage_vitesse = 7.0,
    braquage_retour = 10.0,
    /// Rotation a fond de braquage (rad/s) a l'arret et a 600 km/h.
    lacet_bas = 2.6,
    lacet_haut = 0.5,
    /// Vitesse (m/s) a mi-chemin entre les deux.
    lacet_mi = 55.0,
    /// Rapidite avec laquelle la rotation suit le volant (1/s).
    lacet_reponse = 10.0,
    /// Autorite du volant en glisse (multiplie la rotation).
    lacet_drift = 1.4,
    /// Couple d'auto-alignement en glisse (1/s) : la carrosserie revient
    /// vers la trajectoire quand on relache.
    alignement = 1.6,

    // ------------------------------------------------------- adherence --
    /// Capacite laterale maximale (m/s2) a l'arret et a 600 km/h.
    adherence = 34.0,
    adherence_haut = 20.0,
    /// Raideur laterale (1/s) : une petite glisse est resorbee en douceur,
    /// une grande sature la capacite, c'est le drift.
    raideur = 14.0,
    /// Touche drift tenue : capacite laterale restante, et ralentissement
    /// (m/s2). Le frein, lui, ne fait que freiner : les deux sont separes.
    drift_adherence = 0.28,
    drift_ralenti = 2.0,
    /// Part de la vitesse laterale perdue rendue vers l'avant.
    glisse_rendue = 0.12,
    /// Trainee du drift (1/s), proportionnelle a sin2 de l'angle.
    trainee_drift = 0.7,
    /// Angle de glisse (rad) pour entrer puis sortir de l'etat « glisse »
    /// (score et effets seulement : la physique est continue).
    glisse_entree = 0.1,
    glisse_sortie = 0.05,

    // ------------------------------------------------------ speedslide --
    /// Poussee en plus (m/s2) au centre de la fenetre ; 0 = desactive.
    speedslide = 2.5,
    /// Angle optimal (rad) a basse vitesse puis a 600 km/h.
    ss_angle_bas = 0.16,
    ss_angle_haut = 0.07,
    /// Demi-largeur de la fenetre (rad).
    ss_largeur = 0.04,
    /// Au-dela de la fenetre, perte (m/s2 par radian en trop).
    ss_exces = 6.0,

    // -------------------------------------------------- drift et boost --
    drift_min_angle = 0.2,
    drift_min_speed = 30.0,
    /// Secondes de drift a grand angle pour remplir la jauge.
    drift_fill = 4.5,
    /// Secondes que dure une jauge pleine.
    boost_drain = 2.2,
    /// Poussee du boost (m/s2), toujours sous les 600 km/h.
    boost_accel = 16.0,

    // ----------------------------------------------------------- murs --
    /// Restitution de la composante normale (0 a 0,05).
    mur_restitution = 0.03,
    /// Perte tangentielle d'un nouvel impact, effleure puis franc.
    mur_perte_min = 0.05,
    mur_perte_max = 0.20,
    /// Frottement en contact prolonge (1/s).
    mur_friction = 0.35,
    /// Perte de propulsion apres un choc franc (0,7 = 70 %).
    mur_penalite = 0.7,
    /// Recuperation de la propulsion (s), choc leger puis violent.
    mur_recup_min = 0.2,
    mur_recup_max = 0.8,
    /// Severite (sinus de l'angle d'impact) a partir de laquelle un choc
    /// coupe la propulsion : en dessous, c'est un frottement.
    mur_seuil_choc = 0.25,
    /// Rotation transmise par un impact decentre.
    mur_rotation = 0.5,

    // ------------------------------------------------------------ vol --
    /// Controle en l'air (rad/s2) : tangage, lacet, roulis.
    air_tangage = 2.5,
    air_lacet = 1.5,
    air_roulis = 1.5,
    /// Airbrake : amortissement du tangage et du roulis (1/s).
    airbrake = 10.0,
    /// Reception de travers : part de la vitesse perdue a 90 degres.
    reception_perte = 0.55,

    // ----------------------------------------------- suspension (vue) --
    /// Pulsation (rad/s) et amortissement relatif de la caisse.
    susp_pulsation = 16.0,
    susp_amorti = 0.85,
    /// Tangage et roulis (rad) par m/s2 d'acceleration.
    susp_tangage = 0.0035,
    susp_roulis = 0.0045,
    /// Enfoncement a la reception (m par m/s de vitesse verticale).
    susp_reception = 0.012,

    // ---------------------------------------------------------- boite --
    /// Part de la propulsion coupee pendant un passage de rapport (0 = rien).
    coupure_passage = 0.0,

    // --------------------------------------------------------- camera --
    // Mode 0 : exterieure proche (defaut). Mode 1 : exterieure haute et
    // eloignee. Mode 2 : embarquee. Cadrage approximatif, sans video de
    // reference : a ajuster sur Trackmania.
    cam0_dist = 6.6,
    cam0_dist_max = 7.6,
    cam0_haut = 2.3,
    cam0_fov = 70.0,
    cam0_fov_max = 82.0,
    cam1_dist = 11.0,
    cam1_dist_max = 12.5,
    cam1_haut = 4.4,
    cam1_fov = 68.0,
    cam1_fov_max = 80.0,
    /// Embarquee : avance et hauteur dans la voiture (m).
    cam2_avant = 0.5,
    cam2_haut = 1.1,
    cam2_fov = 78.0,
    cam2_fov_max = 90.0,
    /// Lissages separes (1/s) : position, cap, point regarde, champ.
    cam_lissage_pos = 16.0,
    cam_lissage_rot = 9.0,
    cam_lissage_cible = 18.0,
    cam_lissage_fov = 4.0,
    /// Influence de la direction du deplacement sur le cap (0 a 1).
    cam_vitesse_dir = 0.3,
    /// Anticipation : regard porte devant (s de trajet, plafonne en m).
    cam_anticipation = 0.1,
    cam_anticipation_max = 16.0,
    /// Hauteur du point regarde au-dessus de la voiture (m).
    cam_cible_haut = 1.0,
    /// Loopings : 1 = la camera passe en embarquee le temps du looping,
    /// 0 = elle garde le mode choisi.
    cam_loop_auto = 1.0,
    /// Bascule (m) avant l'entree et apres la sortie du looping.
    cam_loop_avant = 10.0,
    cam_loop_apres = 10.0,
    /// Vitesse du fondu entre exterieure et embarquee (1/s).
    cam_loop_fondu = 6.0,
    /// Secousse a l'impact (m) ; 0 = aucune.
    cam_choc = 0.12,
    /// En vol, delai (s) avant de revenir vers la verticale du monde.
    cam_vol_retour = 0.6,
}

/// Nombre de champs, pour l'hote.
pub const COUNT: usize = std::mem::size_of::<Tuning>() / 4;

/// Noms mis bout a bout, separes par des sauts de ligne.
pub fn keys_blob() -> String {
    KEYS.join("\n")
}

/// Vitesses (m/s) des points de la courbe d'acceleration.
const POINTS_KMH: [f32; 9] = [0.0, 100.0, 200.0, 300.0, 400.0, 500.0, 550.0, 590.0, 600.0];

impl Tuning {
    /// Acceleration nette de la courbe (m/s2) a la vitesse `v` (m/s),
    /// interpolee lineairement, nulle a 600 km/h et au-dela.
    pub fn courbe(&self, v: f32) -> f32 {
        let a = [
            self.acc_0, self.acc_100, self.acc_200, self.acc_300, self.acc_400,
            self.acc_500, self.acc_550, self.acc_590, 0.0,
        ];
        // la table est ecrite pour 600 km/h : on la ramene a vitesse_max
        let kmh = v.max(0.0) * 600.0 / self.vmax();
        for i in 0..8 {
            let (v0, v1) = (POINTS_KMH[i], POINTS_KMH[i + 1]);
            if kmh <= v1 {
                let k = (kmh - v0) / (v1 - v0);
                return (a[i] + (a[i + 1] - a[i]) * k) * self.puissance;
            }
        }
        0.0
    }

    /// Vitesse max sans boost (m/s), bornee au plafond.
    pub fn vmax(&self) -> f32 {
        (self.vitesse_max / 3.6).clamp(10.0, crate::car::PLAFOND)
    }

    /// Vitesse max au boost (m/s), entre la vitesse max et le plafond.
    pub fn vmax_boost(&self) -> f32 {
        (self.vitesse_max_boost / 3.6).clamp(self.vmax(), crate::car::PLAFOND)
    }

    /// Rotation max a fond de braquage (rad/s) a la vitesse `v`.
    pub fn lacet_max(&self, v: f32) -> f32 {
        let k = v.max(0.0) / (v.max(0.0) + self.lacet_mi.max(1.0));
        // k vaut 0,5 a lacet_mi ; on l'etire pour atteindre 1 a 600 km/h
        let k1 = crate::car::PLAFOND / (crate::car::PLAFOND + self.lacet_mi.max(1.0));
        let k = (k / k1).min(1.0);
        self.lacet_bas + (self.lacet_haut - self.lacet_bas) * k
    }

    /// Capacite laterale (m/s2) a la vitesse `v`.
    pub fn capacite(&self, v: f32) -> f32 {
        let k = (v / crate::car::PLAFOND).clamp(0.0, 1.0);
        self.adherence + (self.adherence_haut - self.adherence) * k
    }

    /// Angle optimal du speedslide (rad) a la vitesse `v`.
    pub fn ss_angle(&self, v: f32) -> f32 {
        let k = (v / crate::car::PLAFOND).clamp(0.0, 1.0);
        self.ss_angle_bas + (self.ss_angle_haut - self.ss_angle_bas) * k
    }
}
