// La couche de nuages : une seule fonction de densite, en coordonnees
// monde, que le ciel dessine et dont l'ombre tombe sur la mer, les rochers,
// la piste et la voiture. Ombre et nuage viennent du meme bruit : elles
// coincident, et derivent ensemble avec le vent.

import * as THREE from '../vendor/three.module.js';

/** Altitude de la couche (m). */
export const ALTITUDE = 2200;

/** Uniformes partages par tous les materiaux concernes (memes objets). */
export const NUAGES = {
  uTempsNuages: { value: 0 },
  uSoleil: { value: new THREE.Vector3(0.5, 0.2, 0.3).normalize() },
  // seuil du bruit : plus haut, moins de nuages
  uCouverture: { value: 0.54 },
};

export const GLSL_NUAGES = /* glsl */ `
  uniform float uTempsNuages;
  uniform vec3 uSoleil;
  uniform float uCouverture;
  const float ALT_NUAGES = ${ALTITUDE.toFixed(1)};

  float nHash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float nBruit(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(nHash(i), nHash(i + vec2(1.0, 0.0)), u.x),
               mix(nHash(i + vec2(0.0, 1.0)), nHash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float nFbm(vec2 p) {
    float a = 0.5;
    float s = 0.0;
    for (int i = 0; i < 5; i++) {
      s += a * nBruit(p);
      p = p * 2.03 + vec2(1.7, 9.2);
      a *= 0.5;
    }
    return s;
  }
  /** Densite (0 a 1) de la couche au-dessus du point (x, z). */
  float densiteNuage(vec2 xz) {
    vec2 p = xz / 1700.0 + vec2(uTempsNuages * 0.006, uTempsNuages * 0.0025);
    return smoothstep(uCouverture, uCouverture + 0.14, nFbm(p));
  }
  /** Lumiere du soleil qui traverse la couche jusqu'au point : 1 en plein
   *  soleil, 0,3 sous un nuage epais. */
  float ombreNuages(vec3 wp) {
    vec3 s = normalize(uSoleil);
    if (s.y < 0.03) return 1.0;
    vec2 q = wp.xz + s.xz * ((ALT_NUAGES - wp.y) / s.y);
    return 1.0 - 0.7 * densiteNuage(q);
  }
`;

/** Ajoute l'ombre des nuages a un materiau standard de three.js : la
 *  lumiere du soleil (la lumiere directionnelle) y est attenuee. */
export function ombrageNuages(material) {
  if (!material || material.userData.nuages) return;
  material.userData.nuages = true;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, NUAGES);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vMondeNuage;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vec4 wpNuage = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          wpNuage = instanceMatrix * wpNuage;
        #endif
        vMondeNuage = (modelMatrix * wpNuage).xyz;`);
    const lumieres = THREE.ShaderChunk.lights_fragment_begin.replace(
      'getDirectionalLightInfo( directionalLight, directLight );',
      'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= ombreNuages( vMondeNuage );',
    );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vMondeNuage;\n${GLSL_NUAGES}`)
      .replace('#include <lights_fragment_begin>', lumieres);
  };
  material.needsUpdate = true;
}
