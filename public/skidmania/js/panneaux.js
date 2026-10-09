// Panneaux de virage au-dessus du muret exterieur, comme dans les Need for
// Speed : de grands panneaux tournes vers la route, la fleche dans le sens
// du virage.
//
// La fleche est le GIF anime `assets/Circuit/virage_fleche.gif`, range en
// planche (`virage_fleche.webp`, voir voidbelt-skidmania/outils/
// planche-fleche.py) : three.js n'anime pas un GIF, on fait donc defiler
// les cases de la planche. Son fond est transparent : seule la fleche se
// voit. Un panneau sur deux bat a contretemps : quand l'un est orange, son
// voisin est blanc.
//
// Rien n'est pose a la main : la courbure se lit sur les reperes de la
// piste, et chaque virage assez serre recoit sa rangee, du cote exterieur.
// Deux InstancedMesh (un par temps), pour tous les panneaux.

import * as THREE from '../vendor/three.module.js';

// Muret du circuit.glb : face interieure a 10 m du milieu (track.rs), 1 m
// d'epaisseur et 1,30 m de haut dans le kit. Le panneau se pose au milieu.
const MURET = 10.5;
const MURET_HAUT = 1.3;
/** Panneau carre comme l'image : cote, jour entre deux (un tous les 20 m). */
const COTE = 8.0;
const JOUR = 12.0;
/** Rayon au-dessous duquel un virage a ses panneaux (m). */
const RAYON_MAX = 450;
/** Demi-fenetre de lissage de la courbure (m). */
const LISSE = 6;
/** Planche : nombre d'images, colonnes de la grille, duree d'une image (s). */
const PLANCHE = '../assets/Circuit/virage_fleche.webp';
const IMAGES = 25;
const COLONNES = 5;
const CADENCE = 0.08;

const vec = (a) => new THREE.Vector3(a[0], a[1], a[2]);

/** Courbure dans le plan de la route en `s` (1/m, positive a droite). */
function courbure(engine, s) {
  const a = engine.frame(s - LISSE);
  const b = engine.frame(s + LISSE);
  const f = engine.frame(s);
  return vec(b.t).sub(vec(a.t)).dot(vec(f.r)) / (2 * LISSE);
}

/** Pose les panneaux ; renvoie `update(dt)`, a appeler a chaque image. */
export function poserPanneaux(scene, engine) {
  const poses = [];
  for (let s = COTE / 2; s < engine.trackLength - COTE / 2; s += COTE + JOUR) {
    const k = courbure(engine, s);
    if (Math.abs(k) < 1 / RAYON_MAX) continue;
    // pas de muret au-dessus d'un trou du trace
    if (engine.trous.some(([a, b]) => s + COTE / 2 > a && s - COTE / 2 < b)) continue;
    const f = engine.frame(s);
    // virage a droite : l'exterieur est a gauche (-r), et inversement
    const cote = k > 0 ? -1 : 1;
    const t = vec(f.t);
    const u = vec(f.u);
    const r = vec(f.r);
    const pos = vec(f.p).addScaledVector(r, cote * MURET).addScaledVector(u, MURET_HAUT + COTE / 2);
    // La fleche de l'image pointe a droite, posee le long de +t. Vue de
    // la route, elle pointe donc a droite sur le muret de gauche (virage a
    // droite). Sur le muret de droite, la face est tournee vers -r : le
    // repere devient un miroir, la fleche pointe a gauche, a l'endroit.
    const m = new THREE.Matrix4().makeBasis(t, u, cote < 0 ? r : r.negate());
    m.scale(new THREE.Vector3(COTE, COTE, 1)).setPosition(pos);
    poses.push(m);
  }

  const lignes = Math.ceil(IMAGES / COLONNES);
  const planche = new THREE.TextureLoader().load(new URL(PLANCHE, import.meta.url).href);
  planche.colorSpace = THREE.SRGBColorSpace;
  planche.anisotropy = 8;
  planche.repeat.set(1 / COLONNES, 1 / lignes);
  const plan = new THREE.PlaneGeometry(1, 1);
  // deux temps : le premier part de l'orange, le second d'une demi-
  // pulsation plus loin, le blanc. Ils se partagent la meme image.
  const temps = [0, Math.floor(IMAGES / 2)].map((decalage, j) => {
    const tex = j ? planche.clone() : planche;
    const mat = new THREE.MeshBasicMaterial({
      map: tex, side: THREE.DoubleSide, toneMapped: false, alphaTest: 0.5,
    });
    const miens = poses.filter((_, i) => i % 2 === j);
    const mesh = new THREE.InstancedMesh(plan, mat, miens.length);
    miens.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    scene.add(mesh);
    return { tex, decalage };
  });

  let horloge = 0;
  let vue = -1;
  return function update(dt) {
    horloge += dt;
    const n = Math.floor(horloge / CADENCE) % IMAGES;
    if (n === vue) return;
    vue = n;
    for (const { tex, decalage } of temps) {
      const k = (n + decalage) % IMAGES;
      // la premiere ligne de la planche est en haut ; les UV partent du bas
      tex.offset.set((k % COLONNES) / COLONNES, 1 - (Math.floor(k / COLONNES) + 1) / lignes);
    }
  };
}
