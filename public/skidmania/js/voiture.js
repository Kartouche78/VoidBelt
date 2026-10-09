// La Koenigsegg : posee chaque image d'apres l'etat du moteur.
//
// Le modele est exporte avant vers +Z, haut vers +Y, donc gauche vers +X ;
// sa base est (-droite, haut, avant). Les roues sont des noeuds separes
// (FL, FR, RL, RR) centres sur leur axe.

import * as THREE from '../vendor/three.module.js';
import { GLTFLoader } from '../vendor/GLTFLoader.js';
import { S } from './moteur.js';
import { ombrageNuages } from './nuages.js';

const WHEEL_R = 0.33;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function flame() {
  const mat = new THREE.MeshBasicMaterial({
    color: 0xff7a1a, transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const core = new THREE.MeshBasicMaterial({
    color: 0xbfe8ff, transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const g = new THREE.Group();
  const outer = new THREE.Mesh(new THREE.ConeGeometry(0.16, 1.2, 12, 1, true), mat);
  const inner = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.6, 10, 1, true), core);
  // cones pointes vers l'arriere (-Z)
  outer.rotation.x = inner.rotation.x = -Math.PI / 2;
  outer.position.z = -0.6;
  inner.position.z = -0.3;
  g.add(outer, inner);
  return g;
}

export class Car {
  async load(scene, url) {
    const gltf = await new GLTFLoader().loadAsync(url);
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);
    const model = gltf.scene;
    model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        // la peinture noire du modele : un vernis qui accroche le ciel
        const m = o.material;
        ombrageNuages(m);
        if (m && m.name === 'Car Texture') {
          m.metalness = 0.55;
          m.roughness = 0.22;
          m.color.setRGB(0.03, 0.03, 0.035);
        }
      }
    });
    this.body.add(model);
    this.wheels = {};
    for (const n of ['FL', 'FR', 'RL', 'RR']) {
      const w = model.getObjectByName(n);
      if (w) {
        w.rotation.order = 'YXZ';
        this.wheels[n] = w;
      }
    }
    this.flames = [flame(), flame()];
    this.flames.forEach((f, i) => {
      f.position.set(i ? -0.42 : 0.42, 0.42, -2.12);
      f.visible = false;
      this.body.add(f);
    });
    scene.add(this.root);
    this.spin = 0;
    this.roll = 0;
    this.pos = new THREE.Vector3();
    this.fwd = new THREE.Vector3();
    this.up = new THREE.Vector3();
    this.right = new THREE.Vector3();
    this.basis = new THREE.Matrix4();
    return this;
  }

  update(st, dt) {
    const v = (i, out) => out.set(st[i], st[i + 1], st[i + 2]);
    v(S.POS, this.pos);
    v(S.FWD, this.fwd);
    v(S.UP, this.up);
    v(S.RIGHT, this.right);
    this.basis.makeBasis(this.right.clone().negate(), this.up, this.fwd);
    this.root.position.copy(this.pos);
    this.root.quaternion.setFromRotationMatrix(this.basis);

    // la carrosserie penche vers l'exterieur, selon la glisse et le volant
    const steer = st[S.STEER];
    const roll = clamp(st[S.VL] * 0.012 - steer * 0.035 * clamp(st[S.SPEED] / 30, 0, 1), -0.11, 0.11);
    this.roll += (roll - this.roll) * Math.min(1, dt * 8);
    this.body.rotation.z = this.roll;

    // roues : elles roulent, et les avant contre-braquent en glisse
    this.spin += (st[S.VF] * dt) / WHEEL_R;
    const turn = steer * 0.5 - st[S.SLIP] * 0.6;
    for (const [n, w] of Object.entries(this.wheels)) {
      w.rotation.x = this.spin;
      // +y tourne l'avant vers la gauche (+X) : la droite est negative
      if (n[0] === 'F') w.rotation.y = -clamp(turn, -0.6, 0.6);
    }

    const boosting = st[S.BOOSTING] > 0;
    for (const f of this.flames) {
      f.visible = boosting;
      if (boosting) f.scale.set(1, 1, 0.75 + Math.random() * 0.6);
    }
  }

  /** Position monde des roues arriere, pour la fumee et les traces. */
  rearWheels(out) {
    const back = this.fwd.clone().multiplyScalar(-1.3);
    for (const [i, side] of [[0, 1], [1, -1]]) {
      out[i].copy(this.pos).add(back).addScaledVector(this.right, side * 0.82);
    }
    return out;
  }
}
