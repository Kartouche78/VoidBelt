// La mer, loin sous la piste : bleu nuit, vagues legeres, reflet du ciel a
// l'horizon et eclat du soleil.
//
// Un grand plan maille suit la camera ; les vagues sont calculees en
// coordonnees monde, et le plan ne se deplace que par pas entiers de sa
// maille, pour que la houle ne « glisse » pas sous le regard.

import * as THREE from '../vendor/three.module.js';
import { NUAGES, GLSL_NUAGES } from './nuages.js';

const SIZE = 30000;
const SEGMENTS = 240;
const CELL = SIZE / SEGMENTS;

const vertexShader = `
  uniform float time;
  varying vec3 vWorld;
  // houle : quelques sinus croises, d'amplitude modeste
  float swell(vec2 p) {
    return 0.9 * sin(dot(p, vec2(0.012, 0.006)) + time * 0.6)
         + 0.6 * sin(dot(p, vec2(-0.008, 0.014)) + time * 0.8)
         + 0.35 * sin(dot(p, vec2(0.03, -0.021)) + time * 1.3);
  }
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    w.y += swell(w.xz);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const fragmentShader = `
  uniform float time;
  uniform vec3 uCouleurSoleil;
  ${GLSL_NUAGES}
  uniform vec3 deep;
  uniform vec3 shallow;
  uniform vec3 horizon;
  uniform vec3 fogColor;
  uniform float fogNear;
  uniform float fogFar;
  varying vec3 vWorld;

  // petites rides : la derivee de sinus croises donne une normale
  vec3 ripples(vec2 p, float fade) {
    vec2 g = vec2(0.0);
    vec2 d1 = vec2(0.06, 0.035), d2 = vec2(-0.045, 0.07), d3 = vec2(0.13, -0.09), d4 = vec2(-0.2, -0.16);
    g += d1 * cos(dot(p, d1) + time * 1.1) * 0.9;
    g += d2 * cos(dot(p, d2) + time * 1.4) * 0.8;
    g += d3 * cos(dot(p, d3) + time * 2.1) * 0.35;
    g += d4 * cos(dot(p, d4) + time * 2.7) * 0.2;
    return normalize(vec3(-g.x * 2.2 * fade, 1.0, -g.y * 2.2 * fade));
  }

  void main() {
    float dist = length(cameraPosition - vWorld);
    // au loin, les rides sont plus fines qu'un pixel : on les efface, sinon
    // elles moirent et scintillent
    float fade = 1.0 / (1.0 + dist / 350.0);
    vec3 n = ripples(vWorld.xz, fade);
    vec3 v = normalize(cameraPosition - vWorld);
    float fres = pow(1.0 - max(dot(n, v), 0.0), 4.0);
    // profondeur : plus sombre a la verticale, un peu plus clair de biais
    vec3 col = mix(deep, shallow, clamp(1.0 - v.y, 0.0, 1.0) * 0.6);
    col = mix(col, horizon, fres * 0.55);
    // eclat du soleil : une trainee doree vers lui, eteinte sous les nuages
    float ombre = ombreNuages(vWorld);
    vec3 h = normalize(normalize(uSoleil) + v);
    float spec = pow(max(dot(n, h), 0.0), 90.0);
    col *= 0.55 + 0.45 * ombre;
    col += uCouleurSoleil * spec * 1.6 * ombre;
    col = mix(col, fogColor, smoothstep(fogNear, fogFar, dist));
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export class Sea {
  constructor(scene, sunDir, fog) {
    const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEGMENTS, SEGMENTS);
    geo.rotateX(-Math.PI / 2);
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        time: { value: 0 },
        ...NUAGES,
        uCouleurSoleil: { value: new THREE.Color(1, 0.7, 0.4) },
        // le bleu vif de l'image de reference : profond a la verticale,
        // turquoise de biais
        deep: { value: new THREE.Color(0x0a3a78) },
        shallow: { value: new THREE.Color(0x1a7cc4) },
        horizon: { value: new THREE.Color(0x6fa6d8) },
        fogColor: { value: fog.color },
        fogNear: { value: fog.near },
        fogFar: { value: fog.far },
      },
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  update(dt, camera) {
    this.material.uniforms.time.value += dt;
    this.mesh.position.set(
      Math.round(camera.position.x / CELL) * CELL,
      0,
      Math.round(camera.position.z / CELL) * CELL,
    );
  }
}
