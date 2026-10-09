// Le ciel : un degrade azur regle sur l'image de reference (le modele
// atmospherique de Preetham donnait un bleu delave a soleil bas), une
// couche de nuages qui s'eclairent selon le soleil, et le
// cycle du soleil, qui fait le tour de l'horizon en restant bas (lumiere
// doree de fin de journee). La lumiere du soleil, la brume et les reflets
// de l'environnement suivent.
//
// Pas d'HDRI : une photo est figee, son soleil ne peut pas tourner ni ses
// nuages faire d'ombres qui bougent.

import * as THREE from '../vendor/three.module.js';
import { NUAGES, GLSL_NUAGES } from './nuages.js';

/** Duree d'un tour complet du soleil (s). */
const CYCLE = 240;
/** Hauteur du soleil (degres) : il oscille entre ces deux valeurs. */
const BAS = 6;
const HAUT = 30;

const vertexShader = /* glsl */ `
  varying vec3 vMonde;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vMonde = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
    gl_Position.z = gl_Position.w * 0.99999;
  }`;

const fragmentShader = /* glsl */ `
  varying vec3 vMonde;
  uniform vec3 uCouleurSoleil;
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uHorizonSoleil;
  ${GLSL_NUAGES}
  /** Le ciel nu : azur au zenith, clair a l'horizon, dore du cote du
   *  soleil ; un halo et le disque. */
  vec3 cielNu(vec3 dir, vec3 s) {
    float ct = max(dot(dir, s), 0.0);
    // l'horizon se rechauffe du cote du soleil
    float cote = pow(max(dot(normalize(vec3(dir.x, 0.0, dir.z)), normalize(vec3(s.x, 0.0, s.z))), 0.0), 3.0);
    vec3 horizon = mix(uHorizon, uHorizonSoleil, cote);
    vec3 c = mix(horizon, uZenith, pow(clamp(dir.y, 0.0, 1.0), 0.5));
    c += uCouleurSoleil * (pow(ct, 8.0) * 0.35 + pow(ct, 64.0) * 0.6);
    c += uCouleurSoleil * smoothstep(0.9993, 0.9996, ct) * 12.0;
    return c;
  }
  void main() {
    vec3 dir = normalize(vMonde - cameraPosition);
    vec3 s = normalize(uSoleil);
    vec3 col = cielNu(dir, s);
    // nuages : la couche est un plan a ALT_NUAGES ; on lit sa densite la
    // ou le regard la traverse, et une seconde fois un peu vers le soleil
    // pour savoir si ce point est eclaire ou dans l'epaisseur
    if (dir.y > 0.0) {
      float t = (ALT_NUAGES - cameraPosition.y) / max(dir.y, 0.02);
      vec2 p = cameraPosition.xz + dir.xz * t;
      float d = densiteNuage(p);
      float vers = densiteNuage(p + s.xz * 260.0);
      float lumiere = exp(-vers * 2.2);
      float ct = max(dot(dir, s), 0.0);
      // dessous gris-bleu, dessus creme et dore, bords qui s'allument a
      // contre-jour
      vec3 ombre = mix(uZenith, vec3(0.55, 0.6, 0.72), 0.55);
      vec3 eclaire = mix(vec3(1.0, 0.97, 0.92), uCouleurSoleil, 0.55) * 1.25;
      vec3 nuage = mix(ombre, eclaire, lumiere);
      nuage += uCouleurSoleil * pow(ct, 12.0) * (1.0 - d) * 1.2;
      float loin = smoothstep(0.0, 0.12, dir.y);
      col = mix(col, nuage, d * loin);
    }
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export class Ciel {
  constructor(scene, renderer, soleil, hemi) {
    this.uniforms = {
      ...NUAGES,
      uCouleurSoleil: { value: new THREE.Color(1, 0.7, 0.4) },
      // les couleurs de l'image de reference
      uZenith: { value: new THREE.Color(0x2a6fd0) },
      uHorizon: { value: new THREE.Color(0xa9d4f2) },
      uHorizonSoleil: { value: new THREE.Color(0xffc68c) },
    };
    const materiau = () => new THREE.ShaderMaterial({
      vertexShader, fragmentShader, uniforms: this.uniforms,
      side: THREE.BackSide, depthWrite: false, fog: false,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(5000, 48, 24), materiau());
    this.dome.renderOrder = -1;
    this.dome.frustumCulled = false;
    scene.add(this.dome);
    // un double du ciel, seul dans sa scene, pour les reflets
    this.sceneEnv = new THREE.Scene();
    this.sceneEnv.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), materiau()));
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.scene = scene;
    this.soleil = soleil;
    this.hemi = hemi;
    // le cycle commence dans la lumiere doree du soir
    this.phase = 0.12;
    this.attenteEnv = 0;
    this.direction = NUAGES.uSoleil.value;
    this.majSoleil();
    this.majReflets();
  }

  majSoleil() {
    const az = this.phase * Math.PI * 2;
    const el = THREE.MathUtils.degToRad(BAS + (HAUT - BAS) * (0.5 - 0.5 * Math.cos(this.phase * Math.PI * 4)));
    this.direction.set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az));
    // plus le soleil est bas, plus sa lumiere est doree
    const dore = 1 - THREE.MathUtils.smoothstep(THREE.MathUtils.radToDeg(el), BAS, HAUT);
    const c = new THREE.Color(1, 0.93, 0.82).lerp(new THREE.Color(1, 0.62, 0.32), dore);
    this.uniforms.uCouleurSoleil.value.copy(c);
    this.soleil.color.copy(c);
    this.soleil.intensity = 2.2 + 0.8 * (1 - dore);
    this.hemi.color.set(0x9ec4ff).lerp(new THREE.Color(0xffc9a0), dore * 0.5);
    this.hemi.groundColor.set(0x1d4f8c);
    // brume : bleu clair de jour, voile dore quand le soleil est bas
    this.scene.fog.color.set(0x9bb8dc).lerp(new THREE.Color(0xe6b48a), dore * 0.7);
  }

  majReflets() {
    this.env?.dispose();
    this.env = this.pmrem.fromScene(this.sceneEnv, 0.02).texture;
    this.scene.environment = this.env;
  }

  update(dt, camera) {
    this.phase = (this.phase + dt / CYCLE) % 1;
    this.uniforms.uTempsNuages.value += dt;
    this.majSoleil();
    this.dome.position.copy(camera.position);
    // les reflets suivent le ciel, sans le recalculer a chaque image
    this.attenteEnv -= dt;
    if (this.attenteEnv <= 0) {
      this.attenteEnv = 2;
      this.majReflets();
    }
  }
}
