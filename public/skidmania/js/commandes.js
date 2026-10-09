// Configuration des touches : manette d'un cote, clavier et souris de
// l'autre. Gardee dans ce navigateur.
//
// Clavier : codes physiques (`e.code`), donc ZQSD en AZERTY tombe sur
// KeyW KeyA KeyS KeyD. La souris s'ecrit `Souris0` (gauche), `Souris1`
// (molette), `Souris2` (droit), `Souris3`/`Souris4` (cotes).
// Manette : index des boutons du gamepad standard (0 = A ... 15 = croix
// droite). Le stick gauche dirige toujours, en plus des touches choisies.
//
// Les menus gardent leurs touches fixes (fleches, Entree, Echap ; croix,
// A, B, Start) : une mauvaise config ne doit jamais enfermer le joueur.

const KEY = 'skidmania.commandes.v1';
/** Emplacements par action cote clavier/souris. */
export const SLOTS = 2;

/** Actions configurables. `pad: false` : pas de bouton de manette (le
 *  stick et la croix dirigent deja). */
export const ACTIONS = [
  { id: 'gaz', label: 'Accélérer' },
  { id: 'frein', label: 'Freiner / reculer' },
  { id: 'gauche', label: 'Tourner à gauche' },
  { id: 'droite', label: 'Tourner à droite' },
  { id: 'driftage', label: 'Drift' },
  { id: 'boost', label: 'Boost' },
  { id: 'checkpoint', label: 'Dernier checkpoint' },
  { id: 'vue', label: 'Caméra suivante' },
  { id: 'arriere', label: 'Regarder derrière (maintenir)' },
  { id: 'recommencer', label: 'Recommencer' },
  { id: 'son', label: 'Couper le son' },
];

export const DEFAUT = {
  clavier: {
    gaz: ['KeyW', 'ArrowUp'],
    frein: ['KeyS', 'ArrowDown'],
    gauche: ['KeyA', 'ArrowLeft'],
    droite: ['KeyD', 'ArrowRight'],
    driftage: ['Space', 'ShiftLeft'],
    boost: ['KeyE', 'KeyB'],
    checkpoint: ['KeyR', 'Backspace'],
    vue: ['KeyC', 'KeyV'],
    arriere: ['KeyX', null],
    recommencer: ['Delete', 'KeyN'],
    // le M de l'AZERTY (Semicolon) : KeyM y tombe sur la virgule
    son: ['Semicolon', null],
  },
  manette: {
    gaz: [7, null],
    frein: [6, null],
    gauche: [14, null],
    droite: [15, null],
    driftage: [0, 5],
    boost: [1, null],
    checkpoint: [4, null],
    vue: [3, null],
    arriere: [11, null],
    recommencer: [8, null],
    son: [2, null],
  },
};

const copie = (o) => JSON.parse(JSON.stringify(o));

/** Config enregistree, completee par les valeurs d'usine. */
export function charger() {
  const c = copie(DEFAUT);
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    for (const cote of ['clavier', 'manette']) {
      for (const a of ACTIONS) {
        const v = s?.[cote]?.[a.id];
        if (Array.isArray(v)) c[cote][a.id] = [0, 1].map((i) => v[i] ?? null);
      }
    }
    // config d'avant la vue capot : Y y etait le checkpoint, il passe a LB
    if (s && !s.manette?.vue) {
      c.manette.checkpoint = c.manette.checkpoint.map((k) => (k === 3 ? 4 : k));
    }
  } catch {
    /* rien d'enregistre ou illisible : config d'usine */
  }
  return c;
}

export function enregistrer(c) {
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    /* navigation privee */
  }
}

/** Pose `code` sur `action`, emplacement `slot`. La meme touche ne sert
 *  qu'a une action : on la retire de toutes les autres. */
export function poser(c, cote, action, slot, code) {
  for (const a of ACTIONS) {
    c[cote][a.id] = c[cote][a.id].map((k) => (k === code ? null : k));
  }
  c[cote][action][slot] = code;
}

// --------------------------------------------------------------- noms --

const NOMS_CLAVIER = {
  Space: 'Espace', ShiftLeft: 'Maj gauche', ShiftRight: 'Maj droite',
  ControlLeft: 'Ctrl gauche', ControlRight: 'Ctrl droite', AltLeft: 'Alt', AltRight: 'Alt Gr',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Backspace: '⌫', Delete: 'Suppr', Enter: 'Entrée', Tab: 'Tab', CapsLock: 'Verr. maj',
  Insert: 'Inser', Home: 'Début', End: 'Fin', PageUp: 'Page ↑', PageDown: 'Page ↓',
  Souris0: 'Clic gauche', Souris1: 'Clic molette', Souris2: 'Clic droit',
  Souris3: 'Souris arrière', Souris4: 'Souris avant',
};

export const NOMS_MANETTE = [
  'A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Select', 'Start',
  'L3', 'R3', 'Croix ↑', 'Croix ↓', 'Croix ←', 'Croix →', 'Accueil',
];

// Disposition reelle du clavier (Chrome, Edge) : KeyW s'affiche « Z » en
// AZERTY. Ailleurs, on retombe sur le nom QWERTY du code.
let disposition = null;
export const dispositionPrete = (navigator.keyboard?.getLayoutMap?.() ?? Promise.resolve(null))
  .then((m) => { disposition = m; })
  .catch(() => {});

export function nomClavier(code) {
  if (code == null) return '—';
  if (NOMS_CLAVIER[code]) return NOMS_CLAVIER[code];
  const lettre = disposition?.get(code);
  if (lettre) return lettre.toUpperCase();
  return code.replace(/^Key|^Digit/, '').replace(/^Numpad/, 'Pavé ');
}

export function nomManette(i) {
  if (i == null) return '—';
  return NOMS_MANETTE[i] ?? `Bouton ${i}`;
}

/** « Z / ↑ » : les touches d'une action, pour les aides a l'ecran. */
export function texte(c, cote, action) {
  const nom = cote === 'clavier' ? nomClavier : nomManette;
  const k = c[cote][action].filter((x) => x != null).map(nom);
  return k.length ? k.join(' / ') : '—';
}
