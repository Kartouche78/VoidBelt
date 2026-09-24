// Gabarits de stade et prompt automatique.
//
// Un gabarit est une planche en 1920 x 1080 qui porte le
// trace exact du moteur : l'IA peint par-dessus, et l'arene produite tombe
// deja sur la hitbox. Chaque gabarit declare son calage, repris tel quel
// comme point de depart dans l'apercu.

/** Format des planches creees, en pixels : du 1080p. C'est aussi le
 *  repere du calage. */
import { PROMPT_STANDARD } from './prompt-standard.js';

export const PLANCHE = { w: 1920, h: 1080 };

/** Enceinte du moteur dans ce repere (`arena.rs`). */
export const ENCEINTE = { l: 173, r: 1498, t: 125, b: 784 };

/** Surepaisseur des poteaux, cote bouche (`POST_BULGE`). */
export const BOSSE = 2;

/** Hitbox 1 (par defaut). FIGEE : on n'y touche jamais sans une demande
 *  explicite. Une autre geometrie se cree a cote, sous un autre nom.
 *
 *  Planche 1920 x 1080 (pixels, origine en haut a gauche) :
 *    terrain   x 198,66 -> 1720,19   y 143,46 -> 899,81
 *    coins     83 u, soit 95,31 px en largeur et 95,26 px en hauteur
 *    cages     demi-ouverture 86 u (98,70 px), filet 75 u (86,12 px),
 *              poteaux 7 u (8,04 px), plus 2 u cote bouche (`BOSSE`)
 *  « u » : unites du moteur, celles de `arena.rs`. */
export const HITBOX_1 = Object.freeze({
  id: 'hitbox1',
  nom: 'Hitbox 1 (par défaut)',
  fit: Object.freeze([198.66, 1720.19, 143.46, 899.81]),
  corner: 83,
  goal: Object.freeze({ half: 86, depth: 75, post: 7 }),
});

/** Format envoye a l'IA : le paysage 3:2 que les modeles savent produire.
 *  La planche y est etiree, puis ramenee au format du jeu a l'acceptation,
 *  ce qui rend au trace sa geometrie exacte. */
export const ENVOI = { w: 1536, h: 1024 };

/** Ajoutee a chaque envoi, apres le prompt : le modele voit une image de
 *  1536 x 1024, alors qu'un prompt peut parler en pixels de la planche
 *  1920 x 1080. Sans cette precision, il recale le terrain sur des
 *  coordonnees qui ne tombent pas dans son image, et le peint trop petit. */
export const PRECISION = `Précision technique : l’image jointe est le gabarit en ${ENVOI.w} × ${ENVOI.h} pixels, soit la planche de 1920 × 1080 mise à cette taille. Si des coordonnées sont données en 1920 × 1080, reporte-les à l’échelle de l’image jointe. Dans tous les cas, le tracé du gabarit joint fait foi : le terrain, les murets et les cages restent exactement à leur place et à leur taille, sans recadrage, sans marge ajoutée, sans agrandir l’arène aux dépens du terrain.`;

/** Hitbox connues. Les suivantes s'ajoutent ici, Hitbox 1 ne bouge pas. */
export const HITBOXES = [HITBOX_1];

export const GABARITS = [
  {
    id: 'standard',
    name: 'Gabarit standard',
    note: 'Coins arrondis, cages rectangulaires, poteaux ronds.',
    // Prompt ecrit a la main pour ce gabarit : il passe devant celui
    // calcule par `promptAuto`.
    prompt: PROMPT_STANDARD,
    image: '/rl2/assets/stadium/Gabarit.jpg',
    // Le gabarit porte le trace de Hitbox 1 : ses valeurs viennent d'elle.
    hitbox: HITBOX_1.id,
    fit: HITBOX_1.fit,
    corner: HITBOX_1.corner,
    goal: HITBOX_1.goal,
  },
];

const pc = (x, total) => `${((x / total) * 100).toFixed(1)} %`;

/** Prompt qui decrit au modele ce qu'il ne doit pas toucher : ou est le
 *  terrain, ou sont les cages, ce qui est du decor. Les positions sont
 *  donnees en pourcentages, pour survivre a tout changement de format. */
export function promptAuto(g) {
  if (g.prompt) return g.prompt;
  const [l, r, t, b] = g.fit;
  const { w, h } = PLANCHE;
  const cy = (t + b) / 2;
  const kx = (r - l) / (ENCEINTE.r - ENCEINTE.l);
  const ky = (b - t) / (ENCEINTE.b - ENCEINTE.t);
  const half = g.goal.half * ky;
  const depth = g.goal.depth * kx;
  return [
    'Vue de dessus, strictement verticale (orthographique, sans perspective), d’un stade de football pour voitures, dans un jeu vidéo arcade.',
    '',
    'Fichier joint : gabarit.png, le gabarit technique du terrain. Il fixe la géométrie : il faut la respecter au pixel près et peindre par-dessus.',
    `- Le terrain de jeu est la zone grise bordée d’un trait blanc fin : de ${pc(l, w)} à ${pc(r, w)} de la largeur, et de ${pc(t, h)} à ${pc(b, h)} de la hauteur. Ses quatre coins sont arrondis.`,
    '- Le trait blanc est l’intérieur du muret : le muret, la bande ou la barrière se dessinent juste à l’extérieur, jamais sur le terrain.',
    `- Deux cages, une à gauche et une à droite, occupent les renfoncements du gabarit : ouverture de ${pc(half * 2, h)} de la hauteur, centrée à ${pc(cy, h)}, profondeur de ${pc(depth, w)} de la largeur. Filet vu de dessus, poteaux ronds aux deux coins de chaque ouverture.`,
    '- La ligne de but prolonge le muret devant chaque cage.',
    '',
    'Sur le terrain : pelouse ou revêtement lisible, ligne médiane, rond central, surfaces de réparation. Aucun joueur, aucune voiture, aucun ballon.',
    'Autour du terrain : les tribunes, le public, l’architecture de l’arène et son décor, jusqu’aux bords de l’image.',
    'Aucun texte, aucun logo, aucun chiffre, aucune interface.',
  ].join('\n');
}
