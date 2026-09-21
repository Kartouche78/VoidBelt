// Disposition des plots, reprise de public/rl2/assets/pads_boost.png.
//
// Cette planche est restee a l'echelle de l'ancien terrain. Ses positions
// sont donc normalisees sur le milieu du nuage, symetrisees dans les deux
// axes pour effacer le jeu du dessin, puis reportees sur l'aire de jeu du
// stade actuel. Une planche redessinee a la bonne echelle permettrait de
// les relever directement.
/// `(x, y, gros)` en unites monde (repere de la planche 1672x941).
pub const PADS: [(f32, f32, bool); 34] = [
    (289.8, 217.7, true),
    (289.8, 318.0, false),
    (289.8, 454.5, false),
    (289.8, 591.0, false),
    (289.8, 691.3, true),
    (415.6, 389.8, false),
    (415.6, 519.2, false),
    (496.3, 454.5, false),
    (541.8, 179.9, false),
    (541.8, 318.0, false),
    (541.8, 591.0, false),
    (541.8, 729.1, false),
    (700.4, 318.0, false),
    (700.4, 454.5, false),
    (700.4, 591.0, false),
    (835.5, 179.9, true),
    (835.5, 389.8, false),
    (835.5, 519.2, false),
    (835.5, 729.1, true),
    (970.6, 318.0, false),
    (970.6, 454.5, false),
    (970.6, 591.0, false),
    (1129.2, 179.9, false),
    (1129.2, 318.0, false),
    (1129.2, 591.0, false),
    (1129.2, 729.1, false),
    (1174.7, 454.5, false),
    (1255.4, 389.8, false),
    (1255.4, 519.2, false),
    (1381.2, 217.7, true),
    (1381.2, 318.0, false),
    (1381.2, 454.5, false),
    (1381.2, 591.0, false),
    (1381.2, 691.3, true),
];
