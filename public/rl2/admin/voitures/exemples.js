// Voitures d'exemple et prompt du generateur de skins.
//
// L'exemple est joint a chaque demande : c'est lui qui fixe le style, la
// vue de dessus, l'orientation et la silhouette maximale. Il est au format
// des sprites du jeu (1024 x 1536, nez en haut), que le jeu etire sur la
// hitbox de la voiture.

/** Format des sprites, en pixels. */
export const SPRITE = { w: 1024, h: 1536 };

export const EXEMPLES = [
  {
    id: 'sport',
    name: 'Voiture de sport (exemple)',
    note: 'Vue de dessus, nez en haut, 1024 × 1536, fond transparent.',
    image: '/rl2/assets/car_exemple.png',
  },
];

export const PROMPT_VOITURE = `Crée une nouvelle voiture de sport pour un jeu 2D, dans exactement le même style visuel que l’image de référence : vue parfaitement verticale du dessus, rendu détaillé et propre, carrosserie brillante, vitres sombres, phares et feux lisibles. Invente un nouveau design de carrosserie, tout en gardant la même orientation et les mêmes proportions générales.

Contrainte de gabarit stricte : la voiture entière, rétroviseurs, roues et aileron compris, doit tenir dans la silhouette maximale de la voiture de référence. Ne dépasse jamais sa largeur maximale ni sa hauteur maximale. Centre la nouvelle voiture au même endroit. Les éléments peuvent être plus petits, mais aucun ne doit sortir du gabarit.

Une seule voiture, entièrement visible, sur fond transparent. Aucun sol, ombre portée, décor, texte ou autre véhicule. Image PNG haute résolution, utilisable comme sprite de jeu.`;
