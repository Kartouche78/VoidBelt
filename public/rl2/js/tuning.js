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
// Les aides citent la valeur de Rocket League quand elle existe, pour qu'on
// voie d'un coup d'œil de combien on s'en écarte.
//
// Un réglage ajouté côté Rust sans fiche ici n'est pas perdu : il apparaît
// dans l'onglet « Divers », en unités brutes. L'interface ne peut donc
// jamais cacher un réglage.

import { KMH_PAR_UNITE, METRES_PAR_UNITE } from './wasm.js';

/** Onglets, dans l'ordre d'affichage. */
export const TABS = [
  ['conduite', 'Conduite'],
  ['coincement', 'Coincement'],
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
    decimales: 1,
  },
  kmhs: {
    suffixe: 'km/h par seconde',
    vers: (u) => u * KMH_PAR_UNITE,
    depuis: (v) => v / KMH_PAR_UNITE,
    decimales: 1,
  },
  metres: {
    suffixe: 'm',
    vers: (u) => u * METRES_PAR_UNITE,
    depuis: (v) => v / METRES_PAR_UNITE,
    decimales: 3,
  },
  // Une courbure se lit mal ; son inverse est le rayon du virage.
  rayon: {
    suffixe: 'm de rayon',
    vers: (k) => (k > 1e-9 ? METRES_PAR_UNITE / k : 0),
    depuis: (m) => (m > 1e-9 ? METRES_PAR_UNITE / m : 0),
    decimales: 2,
  },
  pourcent: {
    suffixe: '%',
    vers: (x) => x * 100,
    depuis: (v) => v / 100,
    decimales: 0,
  },
  secondes: { suffixe: 's', vers: (x) => x, depuis: (x) => x, decimales: 2 },
  kilos: { suffixe: 'kg', vers: (x) => x, depuis: (x) => x, decimales: 0 },
  parSeconde: { suffixe: 'par seconde', vers: (x) => x, depuis: (x) => x, decimales: 3 },
  fois: { suffixe: '×', vers: (x) => x, depuis: (x) => x, decimales: 2 },
  jauge: { suffixe: 'de jauge', vers: (x) => x, depuis: (x) => x, decimales: 0 },
};

/** `[onglet, libellé, unité, min, max, pas, aide]`.
 *  Les bornes sont dans l'unité affichée. */
export const META = {
  // ------------------------------------------------------------ conduite --
  drive_max: ['conduite', 'Vitesse sans boost', 'kmh', 5, 150, 0.5,
    'Plafond du moteur seul. Rocket League : 50,8 km/h. Le boost le dépasse.'],
  speed_max: ['conduite', 'Vitesse maximale', 'kmh', 10, 250, 0.5,
    'Plafond absolu, boost compris. Rocket League : 82,8 km/h.'],
  supersonic: ['conduite', 'Seuil supersonique', 'kmh', 10, 250, 0.5,
    'Rocket League : 79,2 km/h. C’est aussi le seuil de démolition.'],
  throttle_a: ['conduite', 'Accélération', 'kmhs', 2, 200, 0.5,
    'Reprise à l’arrêt : 57,6 km/h par seconde. Elle s’effondre jusqu’à zéro au plafond.'],
  boost_a: ['conduite', 'Poussée du boost', 'kmhs', 0, 150, 0.5,
    'Ajoutée tant que le boost est tenu. Rocket League : 35,7 km/h par seconde.'],
  brake_a: ['conduite', 'Freinage', 'kmhs', 5, 400, 1,
    'Sert aussi de marche arrière. Rocket League : 126 km/h par seconde.'],
  coast_a: ['conduite', 'Roue libre', 'kmhs', 0, 100, 0.5,
    'Quand on ne touche plus à rien. Rocket League : 18,9 km/h par seconde.'],
  reverse_ratio: ['conduite', 'Marche arrière', 'pourcent', 10, 100, 5,
    'Part de la vitesse avant atteignable en reculant. Rocket League ne la bride pas : 100 %.'],
  turn_slow: ['conduite', 'Virage à l’arrêt', 'rayon', 0.4, 12, 0.02,
    'Rayon du virage à basse vitesse. Rocket League : 2,51 m à 18 km/h.'],
  turn_fast: ['conduite', 'Virage lancé', 'rayon', 2, 40, 0.1,
    'Rayon à pleine vitesse. Rocket League : 11,36 m à 82,8 km/h.'],
  turn_curve: ['conduite', 'Courbure du virage', 'fois', 0.5, 5, 0.05,
    'Forme de la transition entre les deux rayons. Ajustée sur la table de Rocket League : 2,25.'],
  yaw_max: ['conduite', 'Rotation maximale', 'parSeconde', 0.5, 12, 0.1,
    'Plafond de rotation, en radians par seconde. Rocket League : 5,5, soit 315° par seconde.'],
  drift_turn: ['conduite', 'Gain du drift', 'fois', 1, 4, 0.05,
    'Multiplie le braquage pendant une glissade.'],
  grip: ['conduite', 'Adhérence', 'parSeconde', 2, 40, 0.5,
    'Vitesse à laquelle la dérive latérale est absorbée. Plus haut, plus collé aux rails.'],
  grip_drift: ['conduite', 'Adhérence en drift', 'parSeconde', 0.5, 20, 0.5,
    'Plus bas, la voiture glisse plus longtemps.'],
  wall_align: ['conduite', 'Alignement au mur', 'parSeconde', 0, 20, 0.5,
    'Vitesse à laquelle le nez se range le long d’un muret.'],
  car_mass: ['conduite', 'Masse', 'kilos', 20, 600, 5,
    'Rocket League : 180 contre 30 pour la balle, soit un rapport de 6 pour 1.'],
  car_half_len: ['conduite', 'Demi-longueur', 'metres', 0.1, 2, 0.01,
    'Hitbox Octane : 1,18 m de long, donc 0,59 m ici. Change aussi la taille dessinée.'],
  car_half_wid: ['conduite', 'Demi-largeur', 'metres', 0.1, 1.5, 0.01,
    'Hitbox Octane : 0,842 m de large. Change aussi la taille dessinée.'],
  car_radius: ['conduite', 'Rayon aux murs', 'metres', 0.1, 2, 0.01,
    'Distance à laquelle la voiture touche l’enceinte.'],

  // --------------------------------------------------------------- boost --
  boost_max: ['boost', 'Réservoir', 'jauge', 10, 300, 1,
    'Rocket League : 100 points.'],
  boost_use: ['boost', 'Consommation', 'parSeconde', 1, 120, 0.1,
    'Rocket League : 33,3 par seconde, soit 3 secondes pour un plein.'],
  kickoff_boost: ['boost', 'Boost à l’engagement', 'jauge', 0, 300, 1,
    'Réserve donnée au coup d’envoi et après une démolition.'],

  // ------------------------------------------------------------ contacts --
  demo_speed: ['contact', 'Seuil de démolition', 'kmh', 10, 250, 0.5,
    'Rocket League exige le supersonique : 79,2 km/h. Jamais un coéquipier.'],
  demo_time: ['contact', 'Temps de réapparition', 'secondes', 0.5, 15, 0.1,
    'Rocket League : 3 secondes.'],
  car_rest: ['contact', 'Rebond entre voitures', 'pourcent', 0, 150, 5,
    'Élasticité du choc, avant la bousculade.'],
  bump_gain: ['contact', 'Force de bousculade', 'pourcent', 0, 200, 5,
    'Part de la vitesse de rapprochement rendue en poussée.'],
  bump_floor: ['contact', 'Bousculade minimale', 'kmh', 0, 30, 0.2,
    'Pour qu’un contact au ralenti écarte quand même.'],
  bump_cap: ['contact', 'Bousculade maximale', 'kmh', 0, 80, 0.5,
    'Sans plafond, un choc violent catapulte la victime.'],
  contact_radius: ['contact', 'Rayon de contact', 'metres', 0.1, 2, 0.01,
    'Distance à laquelle deux voitures se touchent.'],
  ball_rest: ['contact', 'Rebond sur la balle', 'pourcent', 0, 150, 5,
    'Élasticité pure. Rocket League y ajoute la poussée ci-dessous, sans laquelle les frappes seraient molles.'],
  push_0: ['contact', 'Frappe à l’arrêt', 'kmh', 0, 40, 0.2,
    'Vitesse ajoutée à la balle, voiture immobile.'],
  push_1: ['contact', 'Frappe à 18 km/h', 'kmh', 0, 40, 0.2, ''],
  push_2: ['contact', 'Frappe à 36 km/h', 'kmh', 0, 40, 0.2, ''],
  push_3: ['contact', 'Frappe à 54 km/h', 'kmh', 0, 40, 0.2, ''],
  push_4: ['contact', 'Frappe à 63 km/h', 'kmh', 0, 40, 0.2, ''],
  push_5: ['contact', 'Frappe à 83 km/h', 'kmh', 0, 40, 0.2,
    'Poussée à pleine vitesse.'],

  // --------------------------------------------------------------- balle --
  ball_radius: ['balle', 'Rayon', 'metres', 0.1, 3, 0.01,
    'Rocket League : 0,9125 m, soit 1,825 m de diamètre. Plus large qu’une voiture.'],
  ball_mass: ['balle', 'Masse', 'kilos', 2, 300, 1,
    'Rocket League : 30, contre 180 pour la voiture.'],
  ball_max_speed: ['balle', 'Vitesse maximale', 'kmh', 20, 400, 1,
    'Rocket League : 216 km/h, soit 2,6 fois la vitesse d’une voiture.'],
  ball_drag: ['balle', 'Frottement', 'parSeconde', 0, 1, 0.005,
    'Rocket League freine très peu la balle : 0,0306, soit 3 % de vitesse perdue par seconde.'],
  ball_wall_rest: ['balle', 'Rebond sur les murs', 'pourcent', 0, 120, 5,
    'Rocket League : 60 % de la vitesse perpendiculaire est renvoyée.'],
  ball_wall_fric: ['balle', 'Glisse le long des murs', 'pourcent', 0, 100, 5,
    'Vitesse conservée le long du mur. Rocket League : frottement de 0,285, donc 71,5 % conservés.'],
  ball_spin_max: ['balle', 'Rotation maximale', 'parSeconde', 0.5, 20, 0.1,
    'En radians par seconde. Rocket League : 6, soit 344° par seconde. Purement visuel ici.'],

  // --------------------------------------------------------------- plots --
  pad_big_amount: ['plots', 'Gros plot : boost rendu', 'jauge', 0, 300, 1,
    'Rocket League : remplit à 100.'],
  pad_small_amount: ['plots', 'Petit plot : boost rendu', 'jauge', 0, 300, 1,
    'Rocket League : +12.'],
  pad_big_delay: ['plots', 'Gros plot : recharge', 'secondes', 0, 60, 0.5,
    'Rocket League : 10 secondes.'],
  pad_small_delay: ['plots', 'Petit plot : recharge', 'secondes', 0, 60, 0.5,
    'Rocket League : 4 secondes.'],
  pad_big_radius: ['plots', 'Gros plot : portée', 'metres', 0.1, 5, 0.01,
    'Distance à laquelle on le ramasse.'],
  pad_small_radius: ['plots', 'Petit plot : portée', 'metres', 0.1, 5, 0.01,
    'Distance à laquelle on le ramasse.'],

  // --------------------------------------------------------------- match --
  countdown: ['match', 'Durée du décompte', 'secondes', 0.5, 15, 0.1,
    'Calée sur countdown.mp3, dont les temps tombent à 1, 2, 3 et 4 secondes.'],
  countdown_lead: ['match', 'Silence d’avance', 'secondes', 0, 5, 0.1,
    'Début du décompte, sans chiffre affiché.'],
  celebrate: ['match', 'Durée de la fête', 'secondes', 0.5, 20, 0.1,
    'Doit couvrir la plus longue prise de but, qui dure 5,5 secondes.'],
  save_range: ['match', 'Portée d’un arrêt', 'metres', 1, 60, 0.5,
    'Distance au but en deçà de laquelle un dégagement compte comme arrêt.'],

  // ----------------------------------------------------------------- bot --
  bot_swing: ['bot', 'Amplitude de contournement', 'metres', 0, 15, 0.05,
    'De combien le bot déborde pour se replacer derrière la balle.'],
  bot_approach_pad: ['bot', 'Marge d’approche', 'metres', -1, 3, 0.01,
    'Ajoutée aux rayons de la voiture et de la balle pour viser.'],

  // ---------------------------------------------------------- coincement --
  // La balle prise entre une voiture et une paroi ressort le long du mur.
  // Frappe libre à fond : 87,9 km/h. Coincement de plein fouet : 183 km/h.
  pinch_min: ['coincement', 'Seuil de déclenchement', 'kmh', 0, 60, 0.5,
    'Vitesse à laquelle la voiture referme le coin. En dessous, elle pousse la balle sans la coincer.'],
  pinch_gain: ['coincement', 'Amplification', 'brut', 1, 6, 0.1,
    'Multiplie la vitesse de fermeture. À 2,6, un coincement de plein fouet double une frappe normale.'],
  pinch_max: ['coincement', 'Vitesse maximale', 'kmh', 20, 250, 1,
    'Plafond du coincement lui-même. La balle reste par ailleurs bornée à son propre plafond.'],
  pinch_lift: ['coincement', 'Décollement du mur', 'pourcent', 0, 100, 5,
    'Part de l’échappée dirigée loin de la paroi, pour que la balle ne reste pas plaquée dessus.'],
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
