// Les reacteurs : deux flammes ancrees aux pots d'echappement.
//
// Les planches montent en puissance — `small`, `moyen`, `fast` — et le boost
// les traverse en quelques secondes au lieu de sauter de l'une a l'autre :
// les trois sont montees en meme temps et se relaient en fondu. La derniere
// ondule, pour qu'a fond ce soit une flamme vivante et pas une image collee.

import * as THREE from '../vendor/three.module.js';

/** Bagues chromees relevees sur `car_bleue.png`, en fractions de la planche.
 *  Les deux carrosseries partagent le meme gabarit. */
const EXHAUST = [
  { u: 0.3085, v: 0.9045 },
  { u: 0.6849, v: 0.9059 },
];

/** Contenu utile de chaque planche, mesure au seuil d'alpha : les fichiers
 *  sont des carres de 1254 px dont la flamme n'occupe qu'une colonne. On
 *  recadre dessus, sinon le vide compterait dans la taille et la racine ne
 *  tomberait pas sur le pot. `len` et `wide` sont en pixels d'origine : ils
 *  gardent entre les trois etats les proportions voulues par le dessin. */
const STAGES = [
  { art: 'assets/booster_small.png', at: 0.0, off: [0.44258, 0.45375], rep: [0.11164, 0.39394], len: 494, wide: 140 },
  { art: 'assets/booster_moyen.png', at: 0.5, off: [0.41627, 0.27113], rep: [0.16108, 0.54864], len: 688, wide: 202 },
  { art: 'assets/booster_fast.png', at: 1.0, off: [0.41148, 0.11882], rep: [0.17783, 0.69458], len: 871, wide: 223 },
];

/** Longueur de la plus petite flamme, en fraction de la voiture. Les deux
 *  autres suivent au prorata de leur dessin. */
const BASE = 0.72;
/** Secondes de boost tenu pour atteindre la grande flamme, et pour redescendre.
 *  Le plafond est celui du reservoir : 100 de boost a 33,3 par seconde ne
 *  donnent que trois secondes pleines, et l'engagement une seule. Monter plus
 *  lentement rendrait la grande flamme presque introuvable ; a cette cadence
 *  on la tient encore une seconde et demie sur un plein, et un depart arrete
 *  atteint deja le deuxieme etat. La descente est plus lente que l'allumage :
 *  le reacteur redemarre chaud apres un bref relachement. */
const RISE = 1.5;
const COOL = 0.9;
/** Allumage et extinction, eux, sont francs. */
const LIT_UP = 0.05;
const LIT_DOWN = 0.16;

const VERT = `
uniform float uTime;
uniform float uWave;
uniform float uPhase;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec3 p = position;
  // 0 a la racine, 1 a la pointe : l'ondulation part de zero sur le pot et
  // s'amplifie vers le bout, comme une flamme accrochee a sa sortie.
  float t = 1.0 - uv.y;
  float sway = sin(t * 7.0 - uTime * 11.0 + uPhase) * 0.55
             + sin(t * 3.1 - uTime * 6.5 + uPhase * 1.7) * 0.45;
  p.x += sway * uWave * t * t;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const FRAG = `
uniform sampler2D uMap;
uniform vec2 uOff;
uniform vec2 uRep;
uniform float uOpacity;
uniform float uHeat;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(uMap, uOff + vUv * uRep);
  if (c.a < 0.01) discard;
  gl_FragColor = vec4(c.rgb * (1.0 + uHeat * 0.22), c.a * uOpacity);
}`;

/** Monte les six flammes d'une voiture dans son groupe et rend de quoi les
 *  animer. `load` est le chargeur de textures du rendu. */
export function makeFlames(group, geom, load) {
  const { carLen, carWid } = geom;
  const unit = (carLen * BASE) / STAGES[0].len;
  const jets = [];

  for (const [n, e] of EXHAUST.entries()) {
    // Du repere de la planche vers celui du groupe : le nez pointe vers +x.
    const pivot = new THREE.Group();
    pivot.position.set((0.5 - e.v) * carLen, -(e.u - 0.5) * carWid, -0.5);
    // Les flammes sont dessinees pointant vers le haut ; on les couche vers
    // l'arriere, comme le chassis qui porte deja ce quart de tour.
    pivot.rotation.z = -Math.PI / 2;
    group.add(pivot);

    for (const s of STAGES) {
      const h = s.len * unit;
      const w = s.wide * unit;
      const mat = new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        uniforms: {
          uMap: { value: load(s.art) },
          uOff: { value: new THREE.Vector2(...s.off) },
          uRep: { value: new THREE.Vector2(...s.rep) },
          uOpacity: { value: 0 },
          uHeat: { value: 0 },
          uWave: { value: 0 },
          uPhase: { value: n * 2.2 },
          uTime: { value: 0 },
        },
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h, 1, 16), mat);
      // Bord haut sur l'origine du pivot : la racine tient le pot, et un
      // etirement du pivot allonge la flamme vers l'arriere sans la decoller.
      mesh.position.y = -h / 2;
      mesh.visible = false;
      pivot.add(mesh);
      jets.push({ mesh, mat, at: s.at, wave: w * 0.28 });
    }
    jets[jets.length - 1].pivot = pivot;
  }

  const pivots = jets.filter((j) => j.pivot).map((j) => j.pivot);
  let heat = 0;
  let lit = 0;

  return function update(c, dt, time) {
    const on = c.flame > 0 && c.demo <= 0;
    heat += on ? dt / RISE : -dt / COOL;
    heat = Math.max(0, Math.min(1, heat));
    lit += on ? dt / LIT_UP : -dt / LIT_DOWN;
    lit = Math.max(0, Math.min(1, lit));

    if (lit <= 0) {
      for (const j of jets) j.mesh.visible = false;
      return;
    }
    // Le jet s'allonge un peu avec la vitesse, sans changer d'etat.
    // `geom` est relu a chaque image : un changement de vitesse maximale
    // depuis /admin doit se voir sans reconstruire les reacteurs.
    const stretch = 1 + Math.min(c.speed / Math.max(geom.speedMax, 1), 1) * 0.3;
    for (const p of pivots) p.scale.y = stretch;
    const flicker = 0.92 + Math.sin(time * 37 + c.x) * 0.08;

    for (const j of jets) {
      // Fondu triangulaire : chaque planche s'efface quand la suivante monte.
      const share = Math.max(0, 1 - Math.abs(heat - j.at) / 0.5);
      j.mesh.visible = share > 0.01;
      if (!j.mesh.visible) continue;
      j.mat.uniforms.uOpacity.value = share * lit * flicker;
      j.mat.uniforms.uHeat.value = heat;
      j.mat.uniforms.uWave.value = heat * j.wave;
      j.mat.uniforms.uTime.value = time;
    }
  };
}
