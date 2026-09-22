// La trainee du supersonique : deux trainees de feu sous les roues arriere.
//
// Elle n'apparait qu'une fois le seuil supersonique franchi, comme la
// mention qui s'allume au tableau de bord, et s'eteint en douceur quand on
// retombe dessous.

import * as THREE from '../vendor/three.module.js';

/** Contenu utile de `train.png`, mesure au seuil d'alpha : le fichier fait
 *  2172 x 724 px dont la trainee n'occupe qu'une bande. On recadre dessus,
 *  sinon le vide compterait dans la taille et la racine ne tomberait pas
 *  sur la roue. Le dessin va du fin, a gauche, au gros, a droite. */
const OFF = [0.01980, 0.41713];
const REP = [0.95396, 0.16989];
/** Proportions du dessin recadre, en pixels d'origine : l'epaisseur suit la
 *  longueur, la trainee ne se deforme pas quand on change sa taille. */
const ART = { len: 2072, wide: 123 };

/** Longueur de la trainee, en longueurs de voiture. */
const LONG = 3.0;

/** Roues arriere relevees sur `car_bleue.png`, en fractions de la planche,
 *  comme les pots d'echappement dans `flame.js`. Les deux carrosseries
 *  partagent le meme gabarit. */
const WHEELS = [
  { u: 0.204, v: 0.806 },
  { u: 0.795, v: 0.806 },
];
/** Allumage franc, extinction plus lente : la trainee doit s'etirer
 *  derriere la voiture qui redescend, pas disparaitre d'un coup. */
const UP = 0.06;
const DOWN = 0.3;

/** Monte les deux trainees d'une voiture dans son groupe et rend de quoi
 *  les animer. `load` est le chargeur de textures du rendu. */
export function makeTrails(group, geom, load) {
  const { carLen, carWid } = geom;
  const len = carLen * LONG;
  const wide = (len * ART.wide) / ART.len;

  // Une seule texture pour les deux : elles partagent le meme recadrage.
  const map = load('assets/train.png');
  map.offset.set(OFF[0], OFF[1]);
  map.repeat.set(REP[0], REP[1]);

  const trails = [];
  for (const w of WHEELS) {
    const mat = new THREE.MeshBasicMaterial({
      map,
      transparent: true,
      depthWrite: false,
      opacity: 0,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(len, wide), mat);
    // Du repere de la planche vers celui du groupe : le nez pointe vers +x.
    const wheelX = (0.5 - w.v) * carLen;
    // Le gros du dessin est a droite, donc du cote des +x du rectangle : on
    // pose ce bord-la sur la roue, et le reste file vers l'arriere. D'ou le
    // centre une demi-longueur plus loin, sans rotation a appliquer.
    mesh.position.set(wheelX - len / 2, -(w.u - 0.5) * carWid, -0.5);
    mesh.visible = false;
    group.add(mesh);
    trails.push({ mesh, mat });
  }

  let lit = 0;
  return function update(c, dt) {
    const on = c.sonic && c.demo <= 0;
    lit += on ? dt / UP : -dt / DOWN;
    lit = Math.max(0, Math.min(1, lit));
    for (const t of trails) {
      t.mesh.visible = lit > 0.01;
      t.mat.opacity = lit;
    }
  };
}
