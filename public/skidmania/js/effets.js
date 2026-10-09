// Fumee des pneus et traces de gomme : deux tampons recycles en anneau, un
// seul appel de dessin chacun.

import * as THREE from '../vendor/three.module.js';
import { S } from './moteur.js';

const SMOKE_MAX = 700;
const MARK_MAX = 4000;
const MARK_W = 0.28;

class Smoke {
  constructor(scene) {
    this.pos = new Float32Array(SMOKE_MAX * 3);
    this.vel = new Float32Array(SMOKE_MAX * 3);
    this.life = new Float32Array(SMOKE_MAX);
    this.size = new Float32Array(SMOKE_MAX);
    this.alpha = new Float32Array(SMOKE_MAX);
    this.next = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { scale: { value: 600 } },
      vertexShader: `attribute float size; attribute float alpha; varying float vA; uniform float scale;
        void main(){ vA = alpha; vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = size * scale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying float vA;
        void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; if (d > 1.0) discard;
          gl_FragColor = vec4(vec3(0.86, 0.85, 0.83), vA * (1.0 - d) * (1.0 - d)); }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  emit(p, up, back, strength) {
    const i = this.next;
    this.next = (this.next + 1) % SMOKE_MAX;
    const j = i * 3;
    const r = () => (Math.random() - 0.5) * 2;
    // nee au-dessus du bitume : un sprite prend la profondeur de son
    // centre, et sa moitie basse passerait sinon sous la route
    const h = 0.55;
    this.pos[j] = p.x + up.x * h + r() * 0.2;
    this.pos[j + 1] = p.y + up.y * h + r() * 0.2;
    this.pos[j + 2] = p.z + up.z * h + r() * 0.2;
    this.vel[j] = up.x * 2.2 + back.x * 3 + r() * 1.0;
    this.vel[j + 1] = up.y * 2.2 + back.y * 3 + r() * 1.0;
    this.vel[j + 2] = up.z * 2.2 + back.z * 3 + r() * 1.0;
    this.life[i] = 1;
    this.size[i] = 0.7;
    this.alpha[i] = 0.35 * strength;
  }

  update(dt) {
    for (let i = 0; i < SMOKE_MAX; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt * 0.9;
      const j = i * 3;
      const drag = Math.exp(-1.5 * dt);
      for (let k = 0; k < 3; k++) {
        this.vel[j + k] *= drag;
        this.pos[j + k] += this.vel[j + k] * dt;
      }
      this.size[i] += dt * 2.2;
      this.alpha[i] = this.life[i] > 0 ? this.alpha[i] * Math.exp(-1.2 * dt) : 0;
    }
    const a = this.points.geometry.attributes;
    a.position.needsUpdate = a.size.needsUpdate = a.alpha.needsUpdate = true;
  }
}

class Marks {
  constructor(scene) {
    this.pos = new Float32Array(MARK_MAX * 6 * 3);
    this.next = 0;
    this.last = [null, null];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color: 0x0b0b0b, transparent: true, opacity: 0.55, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }));
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  /** Prolonge la trace de la roue `w`, ou l'interrompt si `on` est faux. */
  add(w, p, right, up, on) {
    if (!on) {
      this.last[w] = null;
      return;
    }
    const q = p.clone().addScaledVector(up, 0.04);
    const prev = this.last[w];
    this.last[w] = { q, right: right.clone() };
    // a 900 km/h la voiture parcourt 4 m par image : on ne coupe la trace
    // qu'au-dela d'un vrai saut (respawn)
    if (!prev || prev.q.distanceTo(q) > 15) return;
    const a1 = prev.q.clone().addScaledVector(prev.right, -MARK_W / 2);
    const a2 = prev.q.clone().addScaledVector(prev.right, MARK_W / 2);
    const b1 = q.clone().addScaledVector(right, -MARK_W / 2);
    const b2 = q.clone().addScaledVector(right, MARK_W / 2);
    const o = this.next * 18;
    [a1, b1, a2, a2, b1, b2].forEach((v, k) => {
      this.pos[o + k * 3] = v.x;
      this.pos[o + k * 3 + 1] = v.y;
      this.pos[o + k * 3 + 2] = v.z;
    });
    this.next = (this.next + 1) % MARK_MAX;
    this.mesh.geometry.attributes.position.needsUpdate = true;
  }

  clear() {
    this.pos.fill(0);
    this.last = [null, null];
    this.mesh.geometry.attributes.position.needsUpdate = true;
  }
}

export class Effects {
  constructor(scene) {
    this.smoke = new Smoke(scene);
    this.marks = new Marks(scene);
    this.wheels = [new THREE.Vector3(), new THREE.Vector3()];
    this.acc = 0;
  }

  update(st, car, dt) {
    const vl = Math.abs(st[S.VL]);
    const speed = st[S.SPEED];
    // seuils x3 : la physique est a l'echelle x3 (tune.rs)
    const skid = vl > 13.5 || (st[S.HANDBRAKE] > 0 && speed > 24);
    car.rearWheels(this.wheels);
    const back = car.fwd.clone().multiplyScalar(-1);
    this.wheels.forEach((p, i) => this.marks.add(i, p, car.right, car.up, skid));
    if (skid) {
      const strength = Math.min(1, 0.4 + vl / 42);
      this.acc += dt * 70;
      while (this.acc >= 1) {
        this.acc -= 1;
        for (const p of this.wheels) this.smoke.emit(p, car.up, back, strength);
      }
    }
    this.smoke.update(dt);
  }

  reset() {
    this.marks.clear();
  }
}
