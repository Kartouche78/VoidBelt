// Description des reglages pour l'interface d'administration.
//
// Le moteur ne connait que des noms et des nombres ; c'est ici qu'on leur
// donne un libelle, un onglet, une plage et une unite. Un reglage ajoute
// cote Rust sans etre decrit ici n'est pas perdu : il apparait dans l'onglet
// « Divers » avec une plage deduite de sa valeur. L'interface ne peut donc
// jamais cacher un reglage.

/** Onglets, dans l'ordre d'affichage. */
export const TABS = [
  ['conduite', 'Conduite'],
  ['boost', 'Boost'],
  ['contact', 'Contacts'],
  ['balle', 'Balle'],
  ['plots', 'Plots'],
  ['match', 'Match'],
  ['bot', 'Bot'],
  ['divers', 'Divers'],
];

/** `[onglet, libelle, min, max, pas, unite, aide]`. */
export const META = {
  // ------------------------------------------------------------ conduite --
  drive_max: ['conduite', 'Vitesse sans boost', 100, 900, 1, 'u/s', 'Plafond moteur seul. Le boost permet de le depasser.'],
  speed_max: ['conduite', 'Vitesse maximale', 200, 1200, 1, 'u/s', 'Plafond absolu, boost compris. 620 u/s = 300 km/h au compteur.'],
  supersonic: ['conduite', 'Seuil supersonique', 100, 1200, 1, 'u/s', 'A partir d ici, la voiture est annoncee supersonique.'],
  throttle_a: ['conduite', 'Acceleration', 50, 1500, 1, 'u/s2', 'Poussee a l arret ; elle s effondre en approchant du plafond.'],
  boost_a: ['conduite', 'Poussee du boost', 0, 1200, 1, 'u/s2', 'Acceleration ajoutee tant que le boost est tenu.'],
  brake_a: ['conduite', 'Freinage', 100, 3000, 1, 'u/s2', 'Aussi la marche arriere, une fois a l arret.'],
  coast_a: ['conduite', 'Roue libre', 0, 600, 1, 'u/s2', 'Ralentissement quand on lache tout.'],
  turn_slow: ['conduite', 'Braquage a l arret', 0.002, 0.06, 0.0005, '1/u', 'Courbure a basse vitesse : plus haut, plus serre.'],
  turn_fast: ['conduite', 'Braquage lance', 0.0005, 0.03, 0.0002, '1/u', 'Courbure a pleine vitesse.'],
  drift_turn: ['conduite', 'Gain du drift', 1, 4, 0.05, 'x', 'Multiplie le braquage pendant une glissade.'],
  grip: ['conduite', 'Adherence', 2, 40, 0.5, '/s', 'Vitesse a laquelle la derive laterale est absorbee.'],
  grip_drift: ['conduite', 'Adherence en drift', 0.5, 20, 0.5, '/s', 'Plus bas, la voiture glisse plus longtemps.'],
  wall_align: ['conduite', 'Alignement au mur', 0, 20, 0.5, 'rad/s', 'Vitesse a laquelle le nez se range le long d un muret.'],
  car_mass: ['conduite', 'Masse', 20, 600, 5, 'kg', 'Rapport de force face a la balle et aux autres voitures.'],
  car_half_len: ['conduite', 'Demi-longueur', 6, 60, 1, 'u', 'Change aussi la taille dessinee a l ecran.'],
  car_half_wid: ['conduite', 'Demi-largeur', 4, 40, 1, 'u', 'Change aussi la taille dessinee a l ecran.'],
  car_radius: ['conduite', 'Rayon aux murs', 5, 50, 1, 'u', 'Distance a laquelle la voiture touche l enceinte.'],

  // --------------------------------------------------------------- boost --
  boost_max: ['boost', 'Reservoir', 10, 300, 1, '', 'Capacite maximale.'],
  boost_use: ['boost', 'Consommation', 1, 120, 0.1, '/s', 'Un plein dure reservoir divise par cette valeur.'],
  kickoff_boost: ['boost', 'Boost a l engagement', 0, 300, 1, '', 'Reserve au coup d envoi et apres une demolition.'],

  // ------------------------------------------------------------ contacts --
  demo_speed: ['contact', 'Seuil de demolition', 100, 1200, 1, 'u/s', 'Au-dela, on detruit un adversaire. 475 u/s = 230 km/h.'],
  demo_time: ['contact', 'Temps de reapparition', 0.5, 15, 0.1, 's', 'Duree avant de revenir en jeu.'],
  car_rest: ['contact', 'Rebond entre voitures', 0, 1.5, 0.05, '', 'Elasticite du choc, avant la bousculade.'],
  bump_gain: ['contact', 'Force de bousculade', 0, 2, 0.05, 'x', 'Part de la vitesse de rapprochement rendue en poussee.'],
  bump_floor: ['contact', 'Bousculade minimale', 0, 200, 1, 'u/s', 'Pour qu un contact au ralenti ecarte quand meme.'],
  bump_cap: ['contact', 'Bousculade maximale', 0, 600, 5, 'u/s', 'Sans plafond, un choc violent catapulte la victime.'],
  contact_radius: ['contact', 'Rayon de contact', 5, 40, 1, 'u', 'Distance a laquelle deux voitures se touchent.'],
  ball_rest: ['contact', 'Rebond sur la balle', 0, 1.5, 0.05, '', 'Elasticite pure ; la frappe vient surtout de la poussee.'],
  push_0: ['contact', 'Frappe a l arret', 0, 400, 1, 'u/s', 'Poussee ajoutee a la balle, voiture immobile.'],
  push_1: ['contact', 'Frappe a 135 u/s', 0, 400, 1, 'u/s', ''],
  push_2: ['contact', 'Frappe a 270 u/s', 0, 400, 1, 'u/s', ''],
  push_3: ['contact', 'Frappe a 404 u/s', 0, 400, 1, 'u/s', ''],
  push_4: ['contact', 'Frappe a 472 u/s', 0, 400, 1, 'u/s', ''],
  push_5: ['contact', 'Frappe a 620 u/s', 0, 400, 1, 'u/s', 'Poussee a pleine vitesse.'],

  // --------------------------------------------------------------- balle --
  ball_radius: ['balle', 'Rayon', 4, 60, 1, 'u', 'Change aussi la taille dessinee.'],
  ball_mass: ['balle', 'Masse', 2, 300, 1, 'kg', 'Plus lourde, elle encaisse moins les frappes.'],
  ball_max_speed: ['balle', 'Vitesse maximale', 100, 3000, 10, 'u/s', ''],
  ball_drag: ['balle', 'Frottement', 0, 3, 0.01, '/s', 'Plus haut, elle s arrete vite.'],
  ball_wall_rest: ['balle', 'Rebond sur les murs', 0, 1.2, 0.05, '', '1 renvoie toute la vitesse.'],
  ball_wall_fric: ['balle', 'Frottement des murs', 0, 1, 0.05, '', '1 conserve la vitesse le long du mur.'],

  // --------------------------------------------------------------- plots --
  pad_big_amount: ['plots', 'Gros plot : boost rendu', 0, 300, 1, '', ''],
  pad_small_amount: ['plots', 'Petit plot : boost rendu', 0, 300, 1, '', ''],
  pad_big_delay: ['plots', 'Gros plot : recharge', 0, 60, 0.5, 's', ''],
  pad_small_delay: ['plots', 'Petit plot : recharge', 0, 60, 0.5, 's', ''],
  pad_big_radius: ['plots', 'Gros plot : rayon', 5, 100, 1, 'u', 'Distance de ramassage.'],
  pad_small_radius: ['plots', 'Petit plot : rayon', 5, 100, 1, 'u', 'Distance de ramassage.'],

  // --------------------------------------------------------------- match --
  countdown: ['match', 'Duree du decompte', 0.5, 15, 0.1, 's', 'Cale sur countdown.mp3, dont les temps tombent a 1, 2, 3 et 4 s.'],
  countdown_lead: ['match', 'Silence d avance', 0, 5, 0.1, 's', 'Debut du decompte sans chiffre affiche.'],
  celebrate: ['match', 'Duree de la fete', 0.5, 20, 0.1, 's', 'Doit couvrir la prise de but la plus longue, 5,5 s.'],
  save_range: ['match', 'Portee d un arret', 50, 1200, 10, 'u', 'Distance au but en deca de laquelle un degagement compte.'],

  // ----------------------------------------------------------------- bot --
  bot_swing: ['bot', 'Amplitude du contournement', 0, 300, 5, 'u', 'De combien le bot deborde pour se replacer.'],
  bot_approach_pad: ['bot', 'Marge d approche', -20, 60, 1, 'u', 'Ajoutee aux rayons voiture et balle pour viser.'],
};

/** Decrit un reglage, meme inconnu : rien ne doit disparaitre de l'ecran. */
export function describe(key, value) {
  const m = META[key];
  if (m) {
    return { tab: m[0], label: m[1], min: m[2], max: m[3], step: m[4], unit: m[5], help: m[6] };
  }
  // Plage deduite : large autour de la valeur d'usine, jamais nulle.
  const span = Math.max(Math.abs(value) * 3, 1);
  return {
    tab: 'divers',
    label: key,
    min: Math.min(0, -span),
    max: span,
    step: span / 200,
    unit: '',
    help: 'Reglage non decrit : ajoute au moteur sans fiche dans tuning.js.',
  };
}
