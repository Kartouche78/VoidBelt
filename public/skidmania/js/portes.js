// Portiques de depart, de checkpoint et d'arrivee, poses sur les reperes de
// la piste que donne le moteur.

import * as THREE from '../vendor/three.module.js';

const HALF = 10;      // face interieure des murs (track.rs, HALF_WIDTH)
const SPAN = HALF + 1.8;
const HEIGHT = 8.5;

function label(text, bg, fg) {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = fg;
  g.font = '900 78px "Archivo Black", Impact, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, c.width / 2, c.height / 2 + 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function checker(cols) {
  const c = document.createElement('canvas');
  c.width = cols * 16;
  c.height = 32;
  const g = c.getContext('2d');
  for (let x = 0; x < cols; x++) {
    for (let y = 0; y < 2; y++) {
      g.fillStyle = (x + y) % 2 ? '#111' : '#f4f0e6';
      g.fillRect(x * 16, y * 16, 16, 16);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  return t;
}

const STYLES = {
  start: { text: 'SKID MANIA · DEPART', bg: '#0d0d10', fg: '#ff4d00', glow: 0xff4d00 },
  cp: { text: 'CHECKPOINT', bg: '#0b1a24', fg: '#5febf7', glow: 0x5febf7 },
  finish: { text: 'ARRIVEE', bg: '#0d0d10', fg: '#f4f0e6', glow: 0xffd23a },
};

export class Gates {
  constructor(scene, engine) {
    this.gates = [];
    const cps = engine.checkpoints;
    this.add(scene, engine, engine.startLine, 'start', '');
    cps.forEach((s, i) => {
      const last = i === cps.length - 1;
      this.add(scene, engine, s, last ? 'finish' : 'cp', last ? '' : ` ${i + 1}/${cps.length - 1}`);
    });
  }

  add(scene, engine, s, kind, suffix) {
    const st = STYLES[kind];
    const f = engine.frame(s);
    const v = (a) => new THREE.Vector3(a[0], a[1], a[2]);
    const g = new THREE.Group();
    const m = new THREE.Matrix4().makeBasis(v(f.r).negate(), v(f.u), v(f.t));
    m.setPosition(v(f.p));
    g.applyMatrix4(m);

    const frameMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1e, roughness: 0.5, metalness: 0.6 });
    const glow = new THREE.MeshBasicMaterial({ color: st.glow });
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(1.0, HEIGHT, 1.0), frameMat);
      post.position.set(side * SPAN, HEIGHT / 2, 0);
      post.castShadow = true;
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.15, HEIGHT - 1, 1.04), glow);
      strip.position.set(side * (SPAN - 0.52), HEIGHT / 2, 0);
      g.add(post, strip);
    }
    const banner = new THREE.Mesh(
      new THREE.BoxGeometry(SPAN * 2 + 1, 2.2, 0.8),
      [frameMat, frameMat, frameMat, frameMat,
        new THREE.MeshBasicMaterial({ map: label(st.text + suffix, st.bg, st.fg) }),
        new THREE.MeshBasicMaterial({ map: label(st.text + suffix, st.bg, st.fg) })],
    );
    banner.position.set(0, HEIGHT + 0.6, 0);
    banner.castShadow = true;
    g.add(banner);

    // la ligne au sol
    const lineMat = kind === 'cp'
      ? new THREE.MeshBasicMaterial({ color: st.glow, transparent: true, opacity: 0.85 })
      : new THREE.MeshBasicMaterial({ map: checker(40) });
    const line = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2, kind === 'cp' ? 0.8 : 2.4), lineMat);
    line.rotation.x = -Math.PI / 2;
    line.position.y = 0.03;
    g.add(line);

    scene.add(g);
    this.gates.push({ s, glow, base: new THREE.Color(st.glow), flash: 0 });
  }

  /** Le portique `i` (0 = depart) vient d'etre franchi. */
  pass(i) {
    if (this.gates[i]) this.gates[i].flash = 1;
  }

  update(dt) {
    for (const g of this.gates) {
      if (g.flash <= 0) continue;
      g.flash = Math.max(0, g.flash - dt * 1.5);
      g.glow.color.copy(g.base).lerp(new THREE.Color(0xffffff), g.flash);
    }
  }
}
