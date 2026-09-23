// Catalogue des sons reglables un par un, dans l'onglet Son.
//
// Chaque famille a son propre volume, en pourcentage du mixage de
// reference : 100 % sonne comme le jeu a ete regle, 300 % le triple.
// `mix` est ce mixage de reference, multiplie au volume de la piste dans
// `audio.js` : c'est lui qu'on retouche pour changer le son par defaut,
// sans que les curseurs des joueurs quittent 100 %.
// `clips` liste les pistes qu'elle regroupe ; une prise numerotee
// (`goal#0`) se range sous le nom qui precede le `#`.

export const SONS = [
  { id: 'balle', label: 'Toucher de balle', clips: ['ballTouch'], mix: 1 },
  { id: 'poteau', label: 'Poteau', clips: ['post'], mix: 2 },
  { id: 'moteur', label: 'Moteur', hint: 'ralenti et régime', clips: ['engineCold', 'engineOn'], mix: 1.48 },
  { id: 'demarreur', label: 'Démarreur', clips: ['engineStart'], mix: 1.2 },
  { id: 'boost', label: 'Boost', clips: ['boostStart', 'boostMax'], mix: 0.82 },
  { id: 'drift', label: 'Drift', hint: 'crissement des pneus', clips: ['drift'], mix: 1.2 },
  { id: 'decompte', label: 'Décompte', clips: ['countdown'], mix: 1.47 },
  { id: 'but', label: 'But', clips: ['goal'], mix: 0.2 },
  { id: 'arret', label: 'Arrêt', clips: ['save'], mix: 0.38 },
  { id: 'prolongation', label: 'Prolongation', clips: ['overtime'], mix: 1 },
  { id: 'tchat', label: 'Tchat rapide', clips: ['quickchat', 'lachatte'], mix: 1 },
];

/** Curseur le plus haut, en %. */
export const SONS_MAX = 300;

/** Curseurs par defaut : tous a 100 %, le mixage est dans `mix`. */
export const SONS_DEFAUT = Object.fromEntries(SONS.map((s) => [s.id, 100]));

/** A incrementer quand `mix` change : les curseurs gardes dans le
 *  navigateur repartent alors de 100 %, au lieu de s'ajouter au nouveau
 *  mixage et de le fausser. */
export const SONS_REV = 2;

/** Famille d'une piste, ou `null` si elle n'en a pas. */
export function familleDe(clip) {
  const nom = clip.split('#')[0];
  return SONS.find((s) => s.clips.includes(nom))?.id ?? null;
}
