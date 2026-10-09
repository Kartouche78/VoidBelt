// La scene : le ciel et son soleil qui tourne, les nuages et leurs ombres,
// la mer, les pitons rocheux, et le circuit construit dans Blender a partir
// du kit route.blend.

import * as THREE from '../vendor/three.module.js';
import { GLTFLoader } from '../vendor/GLTFLoader.js';
import { Sea } from './mer.js';
import { Ciel } from './ciel.js';
import { NUAGES, ombrageNuages } from './nuages.js';
import { poserRochers } from './rochers.js';

/** Texture de bruit en niveaux de gris, pour le grain du bitume. */
function noiseTexture(size, dark, light, grain) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const k = Math.min(1, Math.max(0, 0.5 + (Math.random() - 0.5) * grain + (Math.random() < 0.02 ? 0.3 : 0)));
    for (let ch = 0; ch < 3; ch++) img.data[i * 4 + ch] = dark[ch] + (light[ch] - dark[ch]) * k;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export class Scene {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    // temps ensoleille : brume legere, repoussee loin
    this.scene.fog = new THREE.Fog(0x9bb8dc, 2500, 13000);
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.3, 14000);

    this.hemi = new THREE.HemisphereLight(0x9ec4ff, 0x1d4f8c, 0.9);
    this.scene.add(this.hemi);
    const sun = new THREE.DirectionalLight(0xffd2a0, 2.6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = sc.bottom = -45;
    sc.right = sc.top = 45;
    sc.near = 1;
    sc.far = 400;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    this.sun = sun;
    this.scene.add(sun, sun.target);

    this.ciel = new Ciel(this.scene, this.renderer, sun, this.hemi);
    this.scene.environmentIntensity = 0.85;
    this.sea = new Sea(this.scene, NUAGES.uSoleil.value, this.scene.fog);
    // la mer brille de la couleur du soleil du moment
    this.sea.material.uniforms.uCouleurSoleil = this.ciel.uniforms.uCouleurSoleil;

    addEventListener('resize', () => this.resize());
    this.resize();
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  async loadCircuit(url) {
    const gltf = await new GLTFLoader().loadAsync(url);
    // Le bitume du kit est procedural dans Blender : on refait son grain
    // ici, en metres (les UV du circuit sont en metres, lateral x abscisse).
    const asphalt = noiseTexture(512, [58, 52, 47], [104, 95, 86], 0.9);
    asphalt.repeat.set(1 / 6, 1 / 6);
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      o.receiveShadow = true;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (m.name.startsWith('BITUME')) {
          m.color.set(0xffffff);
          m.map = asphalt;
          m.roughness = 0.86;
          m.metalness = 0;
        }
        m.side = THREE.DoubleSide;
        ombrageNuages(m);
      }
      if (o.name.startsWith('Piliers')) o.castShadow = true;
    });
    this.scene.add(gltf.scene);
    return gltf.scene;
  }

  /** Pitons rocheux autour de la piste (`points` : positions de la piste). */
  rochers(points) {
    return poserRochers(this.scene, points);
  }

  /** Une image : le ciel tourne, le soleil et sa boite d'ombre suivent la
   *  voiture, la mer suit la camera. */
  follow(pos, dt) {
    this.ciel.update(dt, this.camera);
    this.sea.update(dt, this.camera);
    this.sun.target.position.copy(pos);
    this.sun.position.copy(pos).addScaledVector(NUAGES.uSoleil.value, 200);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
