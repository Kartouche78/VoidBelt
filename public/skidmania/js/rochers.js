// Les pitons rocheux dans la mer, comme sur l'image de reference : hauts,
// effiles, a facettes ocre et brunes, une touffe de verdure au sommet et un
// anneau d'ecume a la base. Generes a partir d'une graine (toujours les
// memes), places autour du circuit sans jamais toucher la piste ni ses
// piliers.

import * as THREE from '../vendor/three.module.js';
import { mergeGeometries } from '../vendor/BufferGeometryUtils.js';
import { ombrageNuages } from './nuages.js';

const VARIANTES = 7;

function alea(graine) {
  let g = graine >>> 0;
  return () => {
    g = (Math.imul(g, 1664525) + 1013904223) >>> 0;
    return g / 4294967296;
  };
}

/** Bruit lisse 2D (valeur), pour deformer les rochers. */
function bruit(r) {
  const T = Array.from({ length: 256 }, r);
  const h = (x, y) => T[(x * 73 + y * 151) & 255];
  return (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = x - xi;
    const fy = y - yi;
    const u = fx * fx * (3 - 2 * fx);
    const v = fy * fy * (3 - 2 * fy);
    const a = h(xi, yi) + (h(xi + 1, yi) - h(xi, yi)) * u;
    const b = h(xi, yi + 1) + (h(xi + 1, yi + 1) - h(xi, yi + 1)) * u;
    return a + (b - a) * v;
  };
}

/** Un piton de hauteur 1 et de rayon 1 a la base, verdure comprise. */
function piton(graine) {
  const r = alea(graine);
  const n = bruit(r);
  const finesse = 0.35 + r() * 0.3;
  const roche = new THREE.CylinderGeometry(finesse, 1, 1, 16, 14, false);
  roche.translate(0, 0.5, 0);
  const pos = roche.attributes.position;
  const couleurs = [];
  const brun = new THREE.Color(0x5e3226);
  const ocre = new THREE.Color(0xa45d3c);
  const clair = new THREE.Color(0xcf8a5c);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const a = Math.atan2(z, x);
    // facettes et strates : le rayon varie avec l'angle et la hauteur
    const k = 1 + 0.32 * (n(a * 1.6 + 10, y * 6) - 0.5) + 0.08 * Math.sin(y * 23 + a * 2);
    const sommet = y > 0.999 ? 0.85 : 1;
    pos.setXYZ(i, x * k * sommet, y + (y > 0.999 ? (n(x * 3, z * 3) - 0.5) * 0.06 : 0), z * k * sommet);
    // plus clair face au haut, plus sombre a la base, taches au hasard
    c.copy(brun).lerp(ocre, 0.35 + 0.5 * y).lerp(clair, Math.max(0, n(a * 3, y * 9) - 0.55) * 1.5);
    couleurs.push(c.r, c.g, c.b);
  }
  roche.setAttribute('color', new THREE.Float32BufferAttribute(couleurs, 3));
  // la verdure : un dome cabosse pose sur le sommet
  const vert = new THREE.IcosahedronGeometry(finesse * 0.95, 1);
  const vp = vert.attributes.position;
  const verts = [];
  const herbe = new THREE.Color(0x4f8a2c);
  const sombre = new THREE.Color(0x2f5e1f);
  for (let i = 0; i < vp.count; i += 1) {
    const x = vp.getX(i);
    const y = vp.getY(i);
    const z = vp.getZ(i);
    const k = 0.8 + n(x * 4 + 3, z * 4) * 0.45;
    vp.setXYZ(i, x * k, Math.max(y * 0.18, -0.02) * k + 1.0, z * k);
    c.copy(sombre).lerp(herbe, n(x * 5, z * 5));
    verts.push(c.r, c.g, c.b);
  }
  vert.setAttribute('color', new THREE.Float32BufferAttribute(verts, 3));
  const g = mergeGeometries([roche.index ? roche.toNonIndexed() : roche, vert.index ? vert.toNonIndexed() : vert]);
  g.computeVertexNormals();
  return g;
}

/** Texture d'ecume : un anneau blanc qui s'effiloche. */
function ecume() {
  const t = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = t;
  const g = cv.getContext('2d');
  const img = g.createImageData(t, t);
  for (let y = 0; y < t; y += 1) {
    for (let x = 0; x < t; x += 1) {
      const dx = x / t - 0.5;
      const dy = y / t - 0.5;
      const d = Math.hypot(dx, dy) * 2;
      const a = Math.max(0, 1 - Math.abs(d - 0.78) / 0.2) * (0.55 + 0.45 * Math.random());
      const i = (y * t + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = a * 230;
    }
  }
  g.putImageData(img, 0, 0);
  return new THREE.CanvasTexture(cv);
}

/** Place les rochers autour de la piste (`points` : positions de la
 *  piste, tous les 25 m environ). */
export function poserRochers(scene, points) {
  const r = alea(20261008);
  let min = new THREE.Vector2(Infinity, Infinity);
  let max = new THREE.Vector2(-Infinity, -Infinity);
  for (const p of points) {
    min.min(new THREE.Vector2(p.x, p.z));
    max.max(new THREE.Vector2(p.x, p.z));
  }
  min = min.subScalar(2500);
  max = max.addScalar(2500);
  const libre = (x, z, rayon) => points.every((p) => Math.hypot(p.x - x, p.z - z) > rayon + 45);
  const places = [];
  for (let essai = 0; essai < 4000 && places.length < 220; essai += 1) {
    // un tiers des rochers pres de la piste, pour l'encadrer
    let x;
    let z;
    if (essai % 3 === 0) {
      const p = points[Math.floor(r() * points.length)];
      const a = r() * Math.PI * 2;
      const d = 120 + r() * 380;
      x = p.x + Math.cos(a) * d;
      z = p.z + Math.sin(a) * d;
    } else {
      x = min.x + r() * (max.x - min.x);
      z = min.y + r() * (max.y - min.y);
    }
    const rayon = 25 + r() * 70;
    if (!libre(x, z, rayon)) continue;
    if (places.some((q) => Math.hypot(q.x - x, q.z - z) < q.rayon + rayon + 20)) continue;
    // la plupart restent sous la piste, quelques geants la depassent
    const hauteur = r() < 0.12 ? 380 + r() * 260 : 70 + r() * 220;
    places.push({ x, z, rayon, hauteur, v: Math.floor(r() * VARIANTES), a: r() * Math.PI * 2 });
  }

  const materiau = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, flatShading: true });
  ombrageNuages(materiau);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const groupe = new THREE.Group();
  for (let v = 0; v < VARIANTES; v += 1) {
    const lot = places.filter((p) => p.v === v);
    if (!lot.length) continue;
    const mesh = new THREE.InstancedMesh(piton(1000 + v * 77), materiau, lot.length);
    lot.forEach((p, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.a);
      m.compose(new THREE.Vector3(p.x, -4, p.z), q, new THREE.Vector3(p.rayon, p.hauteur, p.rayon));
      mesh.setMatrixAt(i, m);
    });
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    groupe.add(mesh);
  }
  // l'ecume au pied de chaque rocher
  const anneau = new THREE.PlaneGeometry(1, 1);
  anneau.rotateX(-Math.PI / 2);
  const mousse = new THREE.InstancedMesh(anneau, new THREE.MeshBasicMaterial({
    map: ecume(), transparent: true, depthWrite: false, fog: true,
  }), places.length);
  places.forEach((p, i) => {
    m.compose(new THREE.Vector3(p.x, 1.2, p.z), q.identity(), new THREE.Vector3(p.rayon * 3, 1, p.rayon * 3));
    mousse.setMatrixAt(i, m);
  });
  mousse.frustumCulled = false;
  groupe.add(mousse);
  scene.add(groupe);
  return places.length;
}
