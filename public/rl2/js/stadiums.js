// Catalogue des stades et ecran de selection.
//
// La physique ne change pas d'un stade a l'autre : l'enceinte reste celle
// de `arena.rs` (1325 x 649 unites de jeu, au centre d'une planche de
// 1672 x 941). Ce qui change, c'est l'image posee dessous. Chaque planche
// a ete dessinee avec son terrain a une taille legerement differente, donc
// on releve une fois pour toutes ou se trouve son aire de jeu, en pixels
// de la planche, et le rendu la recale sur l'enceinte du moteur.
//
// `fit` = [gauche, droite, haut, bas] : les faces interieures des murets
// telles qu'elles sont peintes sur l'image. Mesurees a la main sur chaque
// planche ; a dix unites pres, l'oeil n'y voit rien.
//
// `corner` = rayon d'arrondi des coins, en unites de jeu. Chaque stade
// chanfreine les siens a sa facon, et c'est la seule donnee de collision
// qui change d'un stade a l'autre : elle part dans le reglage
// `arena_corner` du moteur. F1, en jeu, affiche le contour obtenu.

// Pour une planche neuve, inutile de repasser par le calage : le gabarit
// `assets/stadium/Gabarit.jpg` porte le contour exact du moteur, a
// l'echelle 1:1 sur les 1672 x 941. Une planche dessinee dessus se declare
// `fit: [173, 1498, 125, 784], corner: 83` et tombe juste du premier coup.

/** Aire de jeu peinte sur la planche d'origine. Ce n'est qu'une mesure de
 *  cette image-la, pas l'enceinte du moteur : depuis que celle-ci a gagne
 *  cinq unites en haut et en bas, les deux different, et c'est `geometry()`
 *  qui fait foi partout ailleurs. */
export const REF = { l: 173, r: 1498, t: 130, b: 779 };

export const STADIUMS = [
  {
    id: 'voidbelt',
    name: 'Arène Voidbelt',
    groupe: 'v1',
    // Le stade d'origine est compose de deux planches transparentes
    // superposees, pas d'une seule image : le rendu le traite a part.
    layers: ['assets/terrain.png', 'assets/stade.png'],
    thumb: 'assets/stadium/ArèneVoidbelt_min.jpg',
    fit: [REF.l, REF.r, REF.t, REF.b],
    corner: 46,
  },
  {
    id: 'astreon',
    name: 'Arène Orbitale d’Astréon',
    groupe: 'v1',
    art: 'assets/stadium/ArèneOrbitaled’Astréon.jpg',
    cage: 'assets/stadium/ArèneOrbitaled’Astréon_cage.png',
    thumb: 'assets/stadium/ArèneOrbitaled’Astréon_min.jpg',
    // Cale au mode F4 et valide a l'ecran. C'est la methode a reprendre
    // pour les autres planches : F4, on pose le contour sur le muret, on
    // releve les chiffres.
    fit: [253, 1419, 181, 737],
    corner: 90,
  },
  {
    id: 'sahreon',
    name: 'Arène de Sahréon',
    groupe: 'v1',
    art: 'assets/stadium/ArènedeSahréon.jpg',
    thumb: 'assets/stadium/ArènedeSahréon_min.jpg',
    fit: [257, 1416, 170, 737],
    corner: 92,
  },
  {
    id: 'talzaka',
    name: 'Arène de Talzaka',
    groupe: 'v1',
    art: 'assets/stadium/ArènedeTalzaka.jpg',
    thumb: 'assets/stadium/ArènedeTalzaka_min.jpg',
    fit: [261, 1409, 192, 687],
    corner: 74,
  },
  {
    id: 'vorkane',
    name: 'Arène de Vorkane',
    groupe: 'v1',
    art: 'assets/stadium/ArènedeVorkane.jpg',
    thumb: 'assets/stadium/ArènedeVorkane_min.jpg',
    fit: [239, 1433, 173, 733],
    corner: 62,
  },
  {
    id: 'valcene',
    name: 'Grand Stade de Valcène',
    groupe: 'v1',
    art: 'assets/stadium/GrandStadedeValcène.jpg',
    thumb: 'assets/stadium/GrandStadedeValcène_min.jpg',
    fit: [252, 1421, 181, 727],
    corner: 83,
  },
  {
    id: 'aurelys',
    name: 'Grand Stade d’Aurélys',
    groupe: 'v1',
    art: 'assets/stadium/GrandStaded’Aurélys.jpg',
    thumb: 'assets/stadium/GrandStaded’Aurélys_min.jpg',
    fit: [222, 1450, 175, 735],
    corner: 133,
  },
  {
    id: 'nereval',
    name: 'Stade des Abysses de Néréval',
    groupe: 'v1',
    art: 'assets/stadium/StadedesAbyssesdeNéréval.jpg',
    thumb: 'assets/stadium/StadedesAbyssesdeNéréval_min.jpg',
    fit: [255, 1415, 169, 728],
    corner: 120,
  },
  {
    id: 'nivoren',
    name: 'Stade des Glaces de Nivoren',
    groupe: 'v1',
    art: 'assets/stadium/StadedesGlacesdeNivoren.jpg',
    thumb: 'assets/stadium/StadedesGlacesdeNivoren_min.jpg',
    fit: [241, 1431, 176, 715],
    corner: 84,
  },
  {
    id: 'kazehara',
    name: 'Stade des Jardins de Kazehara',
    groupe: 'v1',
    art: 'assets/stadium/StadedesJardinsdeKazehara.jpg',
    thumb: 'assets/stadium/StadedesJardinsdeKazehara_min.jpg',
    fit: [228, 1444, 168, 723],
    corner: 120,
  },
];

// Calages repris a la main depuis le mode F4. Ils vivent dans le navigateur
// tant qu'ils ne sont pas recopies dans le tableau ci-dessus : on regle en
// jeu, on releve les chiffres, puis on les fige ici.
const CLE = 'voidbelt.rl2.calages';
/// A incrementer chaque fois qu'un calage est fige dans le tableau
/// ci-dessus. Sans ca, le calage garde en navigateur continuerait de
/// masquer la valeur du fichier, et on croirait la correction perdue.
const REV = 5;
/// Publie pour que le panneau de calage l'affiche : sur une capture, il
/// dit tout de suite si le navigateur sert bien la derniere version.
export { REV };

export function loadOverrides() {
  try {
    const held = JSON.parse(localStorage.getItem(CLE) || '{}');
    return held.rev === REV ? held.map || {} : {};
  } catch {
    return {};
  }
}

/** Retient le calage d'un stade, ou l'efface si `values` est nul. */
export function saveOverride(id, values) {
  const all = loadOverrides();
  if (values) all[id] = values;
  else delete all[id];
  try {
    localStorage.setItem(CLE, JSON.stringify({ rev: REV, map: all }));
  } catch {
    // Stockage indisponible : le calage vaut pour la session, c'est deja
    // assez pour relever les chiffres et me les envoyer.
  }
  return all;
}

/** Onglets du selecteur, dans l'ordre d'affichage. Le lot v2 est retire
 *  le temps que ses planches soient refaites ; il revient ici avec elles. */
export const GROUPES = [
  ['v1', 'Stades'],
];

/** Stade d'un identifiant, calage en cours applique, la planche d'origine
 *  a defaut. */
export function stadiumById(id) {
  const base = STADIUMS.find((s) => s.id === id) || STADIUMS[0];
  const over = loadOverrides()[base.id];
  return over ? { ...base, ...over } : base;
}

/** Echelle et position a donner a la planche pour que son aire de jeu
 *  tombe pile sur l'enceinte du moteur. `geom` vient du wasm : c'est lui
 *  qui fait foi, pas les constantes recopiees ici.
 *
 *  Les deux axes sont mis a l'echelle separement : les planches n'ont pas
 *  toutes exactement le meme rapport longueur / largeur, et mieux vaut un
 *  decor etire de quelques pour cent qu'un muret peint a cote du mur ou
 *  la balle rebondit. */
export function fitPlank(stadium, geom) {
  const [l, r, t, b] = stadium.fit;
  const sx = (geom.maxX - geom.minX) / (r - l);
  const sy = (geom.maxY - geom.minY) / (b - t);
  const { boardW: w, boardH: h } = geom;
  return {
    w: w * sx,
    h: h * sy,
    // Centre de la planche, ramene dans le repere du jeu.
    x: geom.minX + (w / 2 - l) * sx,
    y: geom.minY + (h / 2 - t) * sy,
  };
}

/** Dessine l'ecran de choix : la barre d'onglets puis la grille du lot
 *  affiche. `onLot` change d'onglet, `onPick` choisit un stade. */
export function renderPicker(nav, box, lot, currentId, onLot, onPick) {
  nav.innerHTML = '';
  for (const [id, label] of GROUPES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.lot = id;
    b.textContent = label;
    b.classList.toggle('active', id === lot);
    b.onclick = () => onLot(id);
    nav.append(b);
  }

  box.innerHTML = '';
  for (const s of STADIUMS.filter((x) => (x.groupe ?? GROUPES[0][0]) === lot)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'stadium';
    b.classList.toggle('active', s.id === currentId);
    const img = document.createElement('img');
    // Le nom du fichier est celui du stade, accents et apostrophe compris :
    // il faut l'encoder pour en faire une adresse.
    img.src = encodeURI(s.thumb);
    img.alt = '';
    img.loading = 'lazy';
    const cap = document.createElement('span');
    cap.textContent = s.name;
    b.append(img, cap);
    b.onclick = () => onPick(s);
    box.append(b);
  }
}
