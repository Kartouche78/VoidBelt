// Description des réglages pour l'interface d'administration.
//
// Le moteur ne connaît que ses unités internes — des « unités monde » par
// seconde, des courbures en 1/unité. Personne ne règle un jeu avec ça. Cette
// table donne à chaque réglage un libellé, un onglet, une aide, et surtout
// une unité lisible : des km/h, des mètres, des pourcentages.
//
// Les bornes écrites ici sont donc exprimées dans l'unité **affichée**, pas
// dans celle du moteur ; la conversion se fait dans les deux sens au moment
// d'afficher et de saisir. Le fichier publié, lui, reste en unités moteur :
// c'est le serveur qui le lit, pas un humain.
//
// Un réglage ajouté côté Rust sans fiche ici n'est pas perdu : il apparaît
// dans l'onglet « Divers », en unités brutes. L'interface ne peut donc
// jamais cacher un réglage.

import { KMH_PAR_UNITE, METRES_PAR_UNITE } from './wasm.js';

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

/** Unités d'affichage. `vers` convertit depuis le moteur, `depuis` y revient.
 *  `decimales` fixe la précision montrée, pour ne pas afficher une vitesse
 *  au millionième de km/h. */
const UNITES = {
  brut: { suffixe: '', vers: (x) => x, depuis: (x) => x, decimales: 3 },
  kmh: {
    suffixe: 'km/h',
    vers: (u) => u * KMH_PAR_UNITE,
    depuis: (v) => v / KMH_PAR_UNITE,
    decimales: 0,
  },
  kmhs: {
    suffixe: 'km/h par seconde',
    vers: (u) => u * KMH_PAR_UNITE,
    depuis: (v) => v / KMH_PAR_UNITE,
    decimales: 0,
  },
  metres: {
    suffixe: 'm',
    vers: (u) => u * METRES_PAR_UNITE,
    depuis: (v) => v / METRES_PAR_UNITE,
    decimales: 2,
  },
  // Une courbure se lit mal ; son inverse est le rayon du virage.
  rayon: {
    suffixe: 'm de rayon',
    vers: (k) => (k > 1e-9 ? METRES_PAR_UNITE / k : 0),
    depuis: (m) => (m > 1e-9 ? METRES_PAR_UNITE / m : 0),
    decimales: 1,
  },
  pourcent: {
    suffixe: '%',
    vers: (x) => x * 100,
    depuis: (v) => v / 100,
    decimales: 0,
  },
  secondes: { suffixe: 's', vers: (x) => x, depuis: (x) => x, decimales: 2 },
  kilos: { suffixe: 'kg', vers: (x) => x, depuis: (x) => x, decimales: 0 },
  parSeconde: { suffixe: 'par seconde', vers: (x) => x, depuis: (x) => x, decimales: 2 },
  fois: { suffixe: '×', vers: (x) => x, depuis: (x) => x, decimales: 2 },
  jauge: { suffixe: 'de jauge', vers: (x) => x, depuis: (x) => x, decimales: 0 },
};

/** `[onglet, libellé, unité, min, max, pas, aide]`.
 *  Les bornes sont dans l'unité affichée. */
export const META = {
  // ------------------------------------------------------------ conduite --
  drive_max: ['conduite', 'Vitesse sans boost', 'kmh', 50, 450, 1,
    'Plafond du moteur seul. Le boost permet de le dépasser.'],
  speed_max: ['conduite', 'Vitesse maximale', 'kmh', 100, 600, 1,
    'Plafond absolu, boost compris. C’est le chiffre du compteur.'],
  supersonic: ['conduite', 'Seuil supersonique', 'kmh', 50, 600, 1,
    'À partir d’ici, la voiture est annoncée supersonique.'],
  throttle_a: ['conduite', 'Accélération', 'kmhs', 20, 700, 1,
    'Reprise à l’arrêt. Elle s’effondre en approchant du plafond.'],
  boost_a: ['conduite', 'Poussée du boost', 'kmhs', 0, 600, 1,
    'Accélération ajoutée tant que le boost est tenu.'],
  brake_a: ['conduite', 'Freinage', 'kmhs', 50, 1500, 1,
    'Sert aussi de marche arrière, une fois à l’arrêt.'],
  coast_a: ['conduite', 'Roue libre', 'kmhs', 0, 300, 1,
    'Ralentissement quand on ne touche plus à rien.'],
  turn_slow: ['conduite', 'Virage à l’arrêt', 'rayon', 1, 40, 0.1,
    'Rayon du virage à basse vitesse. Plus petit, plus serré.'],
  turn_fast: ['conduite', 'Virage lancé', 'rayon', 2, 120, 0.5,
    'Rayon du virage à pleine vitesse.'],
  drift_turn: ['conduite', 'Gain du drift', 'fois', 1, 4, 0.05,
    'Multiplie le braquage pendant une glissade.'],
  grip: ['conduite', 'Adhérence', 'parSeconde', 2, 40, 0.5,
    'Vitesse à laquelle la dérive latérale est absorbée. Plus haut, plus collé aux rails.'],
  grip_drift: ['conduite', 'Adhérence en drift', 'parSeconde', 0.5, 20, 0.5,
    'Plus bas, la voiture glisse plus longtemps.'],
  wall_align: ['conduite', 'Alignement au mur', 'parSeconde', 0, 20, 0.5,
    'Vitesse à laquelle le nez se range le long d’un muret.'],
  car_mass: ['conduite', 'Masse', 'kilos', 20, 600, 5,
    'Rapport de force face à la balle et aux autres voitures.'],
  car_half_len: ['conduite', 'Demi-longueur', 'metres', 0.8, 8, 0.05,
    'Une voiture fait le double. Change aussi la taille dessinée.'],
  car_half_wid: ['conduite', 'Demi-largeur', 'metres', 0.5, 5, 0.05,
    'Change aussi la taille dessinée.'],
  car_radius: ['conduite', 'Rayon aux murs', 'metres', 0.6, 7, 0.05,
    'Distance à laquelle la voiture touche l’enceinte.'],

  // --------------------------------------------------------------- boost --
  boost_max: ['boost', 'Réservoir', 'jauge', 10, 300, 1,
    'Capacité maximale de la jauge.'],
  boost_use: ['boost', 'Consommation', 'parSeconde', 1, 120, 0.1,
    'Un plein dure le réservoir divisé par cette valeur.'],
  kickoff_boost: ['boost', 'Boost à l’engagement', 'jauge', 0, 300, 1,
    'Réserve donnée au coup d’envoi et après une démolition.'],

  // ------------------------------------------------------------ contacts --
  demo_speed: ['contact', 'Seuil de démolition', 'kmh', 50, 600, 1,
    'Au-delà, on détruit un adversaire. Jamais un coéquipier.'],
  demo_time: ['contact', 'Temps de réapparition', 'secondes', 0.5, 15, 0.1,
    'Durée avant de revenir en jeu après une démolition.'],
  car_rest: ['contact', 'Rebond entre voitures', 'pourcent', 0, 150, 5,
    'Élasticité du choc, avant la bousculade.'],
  bump_gain: ['contact', 'Force de bousculade', 'pourcent', 0, 200, 5,
    'Part de la vitesse de rapprochement rendue en poussée.'],
  bump_floor: ['contact', 'Bousculade minimale', 'kmh', 0, 100, 1,
    'Pour qu’un contact au ralenti écarte quand même.'],
  bump_cap: ['contact', 'Bousculade maximale', 'kmh', 0, 300, 1,
    'Sans plafond, un choc violent catapulte la victime à l’autre bout du terrain.'],
  contact_radius: ['contact', 'Rayon de contact', 'metres', 0.6, 5, 0.05,
    'Distance à laquelle deux voitures se touchent.'],
  ball_rest: ['contact', 'Rebond sur la balle', 'pourcent', 0, 150, 5,
    'Élasticité pure. La frappe vient surtout de la poussée ci-dessous.'],
  push_0: ['contact', 'Frappe à l’arrêt', 'kmh', 0, 200, 1,
    'Vitesse ajoutée à la balle, voiture immobile.'],
  push_1: ['contact', 'Frappe à 65 km/h', 'kmh', 0, 200, 1, ''],
  push_2: ['contact', 'Frappe à 130 km/h', 'kmh', 0, 200, 1, ''],
  push_3: ['contact', 'Frappe à 196 km/h', 'kmh', 0, 200, 1, ''],
  push_4: ['contact', 'Frappe à 228 km/h', 'kmh', 0, 200, 1, ''],
  push_5: ['contact', 'Frappe à 300 km/h', 'kmh', 0, 200, 1,
    'Vitesse ajoutée à pleine vitesse.'],

  // --------------------------------------------------------------- balle --
  ball_radius: ['balle', 'Rayon', 'metres', 0.5, 8, 0.05,
    'Change aussi la taille dessinée.'],
  ball_mass: ['balle', 'Masse', 'kilos', 2, 300, 1,
    'Plus lourde, elle encaisse moins les frappes.'],
  ball_max_speed: ['balle', 'Vitesse maximale', 'kmh', 50, 1200, 5, ''],
  ball_drag: ['balle', 'Frottement', 'parSeconde', 0, 3, 0.01,
    'Plus haut, elle s’arrête vite.'],
  ball_wall_rest: ['balle', 'Rebond sur les murs', 'pourcent', 0, 120, 5,
    '100 % renvoie toute la vitesse.'],
  ball_wall_fric: ['balle', 'Glisse le long des murs', 'pourcent', 0, 100, 5,
    '100 % conserve toute la vitesse le long du mur.'],

  // --------------------------------------------------------------- plots --
  pad_big_amount: ['plots', 'Gros plot : boost rendu', 'jauge', 0, 300, 1, ''],
  pad_small_amount: ['plots', 'Petit plot : boost rendu', 'jauge', 0, 300, 1, ''],
  pad_big_delay: ['plots', 'Gros plot : recharge', 'secondes', 0, 60, 0.5, ''],
  pad_small_delay: ['plots', 'Petit plot : recharge', 'secondes', 0, 60, 0.5, ''],
  pad_big_radius: ['plots', 'Gros plot : portée', 'metres', 0.5, 12, 0.05,
    'Distance à laquelle on le ramasse.'],
  pad_small_radius: ['plots', 'Petit plot : portée', 'metres', 0.5, 12, 0.05,
    'Distance à laquelle on le ramasse.'],

  // --------------------------------------------------------------- match --
  countdown: ['match', 'Durée du décompte', 'secondes', 0.5, 15, 0.1,
    'Calée sur countdown.mp3, dont les temps tombent à 1, 2, 3 et 4 secondes.'],
  countdown_lead: ['match', 'Silence d’avance', 'secondes', 0, 5, 0.1,
    'Début du décompte, sans chiffre affiché.'],
  celebrate: ['match', 'Durée de la fête', 'secondes', 0.5, 20, 0.1,
    'Doit couvrir la plus longue prise de but, qui dure 5,5 secondes.'],
  save_range: ['match', 'Portée d’un arrêt', 'metres', 5, 160, 1,
    'Distance au but en deçà de laquelle un dégagement compte comme arrêt.'],

  // ----------------------------------------------------------------- bot --
  bot_swing: ['bot', 'Amplitude de contournement', 'metres', 0, 40, 0.5,
    'De combien le bot déborde pour se replacer derrière la balle.'],
  bot_approach_pad: ['bot', 'Marge d’approche', 'metres', -3, 8, 0.05,
    'Ajoutée aux rayons de la voiture et de la balle pour viser.'],
};

/** Décrit un réglage, même inconnu : rien ne doit disparaître de l'écran. */
export function describe(key, factory) {
  const m = META[key];
  if (m) {
    const unite = UNITES[m[2]] || UNITES.brut;
    return {
      tab: m[0], label: m[1], unite,
      min: m[3], max: m[4], step: m[5], help: m[6],
    };
  }
  // Plage déduite, en unités brutes : large autour de la valeur d'usine.
  const span = Math.max(Math.abs(factory) * 3, 1);
  return {
    tab: 'divers',
    label: key,
    unite: UNITES.brut,
    min: Math.min(0, -span),
    max: span,
    step: span / 200,
    help: 'Réglage sans fiche : ajouté au moteur, pas encore décrit dans tuning.js.',
  };
}
