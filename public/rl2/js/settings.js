// Reglages persistes dans le navigateur : touches, manette, son, match.

import { SONS_DEFAUT, SONS_REV } from './sons.js';

const KEY = 'voidbelt.rl2.settings';

/** Actions reglables, dans l'ordre d'affichage du menu. */
export const ACTIONS = [
  { id: 'accel', label: 'Accelerer', analog: true },
  { id: 'brake', label: 'Freiner / Reculer', analog: true },
  { id: 'left', label: 'Tourner a gauche', keyOnly: true },
  { id: 'right', label: 'Tourner a droite', keyOnly: true },
  { id: 'steer', label: 'Direction (axe)', padOnly: true, axis: true },
  { id: 'boost', label: 'Boost', analog: false },
  { id: 'drift', label: 'Drift', analog: false },
  { id: 'camera', label: 'Changer de vue', analog: false },
  { id: 'pause', label: 'Pause', analog: false },
  { id: 'scores', label: 'Tableau des scores', analog: false },
  { id: 'panneau', label: 'Panneau (profil, messages)', analog: false },
];

/** Manette Xbox en mapping standard : RT accelere, LT freine, B boost,
 *  X drift, Y change de vue. Cote clavier, la vue prend une touche encore
 *  libre : espace et maj sont deja pris par le drift et le boost. */
export const DEFAULTS = {
  keys: {
    accel: 'ArrowUp',
    brake: 'ArrowDown',
    left: 'ArrowLeft',
    right: 'ArrowRight',
    boost: 'ShiftLeft',
    drift: 'Space',
    camera: 'KeyV',
    pause: 'Escape',
    scores: 'Tab',
    // La touche sous Echap : ² sur un clavier francais.
    panneau: 'Backquote',
  },
  pad: {
    accel: { kind: 'button', index: 7 },
    brake: { kind: 'button', index: 6 },
    steer: { kind: 'axis', index: 0 },
    boost: { kind: 'button', index: 1 },
    drift: { kind: 'button', index: 2 },
    camera: { kind: 'button', index: 3 },
    // Start ouvre le panneau ; la pause passe par son icone « Menu », et
    // reste sur Echap au clavier.
    pause: null,
    // Back / Select : la touche qui montre le tableau dans Rocket League.
    scores: { kind: 'button', index: 8 },
    panneau: { kind: 'button', index: 9 },
  },
  // `sons` : volume de chaque famille, en % du mixage d'origine.
  audio: { master: 80, sfx: 90, sons: SONS_DEFAUT, sonsRev: SONS_REV },
  match: { duration: 300, level: 1 },
  /// Stade choisi pour le solo, par identifiant de `stadiums.js`.
  stadium: 'voidbelt',
  /// Skin de voiture equipe (`car-...`), vide pour la livree du camp.
  skin: '',
  camera: 'arena',
  deadzone: 15,
  name: '',
};

function merge(base, over) {
  if (!over || typeof over !== 'object') return structuredClone(base);
  const out = structuredClone(base);
  for (const [k, v] of Object.entries(over)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object') {
      out[k] = merge(out[k], v);
    } else if (v !== undefined && v !== null) {
      out[k] = v;
    }
  }
  return out;
}

export function load() {
  try {
    const garde = JSON.parse(localStorage.getItem(KEY) || '{}');
    const s = merge(DEFAULTS, garde);
    // Nouveau mixage de reference : les curseurs repartent de 100 %. On
    // lit la version gardee, pas celle fusionnee, que les valeurs par
    // defaut rempliraient d'office.
    // Start faisait la pause avant d'ouvrir le panneau : un ancien reglage
    // les ferait partir ensemble.
    if (s.pad.pause?.index === 9 && s.pad.panneau?.index === 9) s.pad.pause = null;
    if (garde?.audio?.sonsRev !== SONS_REV) {
      s.audio.sons = structuredClone(SONS_DEFAUT);
      s.audio.sonsRev = SONS_REV;
    }
    return s;
  } catch {
    // Stockage indisponible (navigation privee, quota) : on joue quand meme.
    return structuredClone(DEFAULTS);
  }
}

export function save(settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* rien a faire : les reglages restent valables pour la session */
  }
}

export function reset() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* idem */
  }
  return structuredClone(DEFAULTS);
}

/** Nom lisible d'une touche clavier. */
export function keyLabel(code) {
  if (!code) return '--';
  const named = {
    ArrowUp: 'Haut', ArrowDown: 'Bas', ArrowLeft: 'Gauche', ArrowRight: 'Droite',
    Space: 'Espace', ShiftLeft: 'Maj G', ShiftRight: 'Maj D', Escape: 'Echap',
    ControlLeft: 'Ctrl G', ControlRight: 'Ctrl D', AltLeft: 'Alt', Enter: 'Entree',
    Tab: 'Tab', Backspace: 'Retour',
  };
  if (named[code]) return named[code];
  return code.replace(/^(Key|Digit|Numpad)/, '').toUpperCase();
}

/** Nom lisible d'une entree manette, avec le libelle Xbox quand on le connait. */
export function padLabel(bind) {
  if (!bind) return '--';
  if (bind.kind === 'axis') return `Axe ${bind.index}`;
  const xbox = {
    0: 'A', 1: 'B', 2: 'X', 3: 'Y', 4: 'LB', 5: 'RB', 6: 'LT', 7: 'RT',
    8: 'Select', 9: 'Start', 10: 'L3', 11: 'R3',
    12: 'Croix haut', 13: 'Croix bas', 14: 'Croix gauche', 15: 'Croix droite',
  };
  return xbox[bind.index] ? `${xbox[bind.index]} (${bind.index})` : `Bouton ${bind.index}`;
}
