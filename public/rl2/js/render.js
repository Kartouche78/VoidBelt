// Rendu three.js du terrain vu de dessus.
//
// Le repere monde est celui des planches (1672 x 941, y vers le bas) ; on le
// bascule en repere three.js en niant y. `terrain.png` est mis a l'echelle
// dans la decoupe transparente de `stade.png`, exactement comme la planche
// de reference a ete composee.

import * as THREE from '../vendor/three.module.js';
import { STATE } from './wasm.js';
import { Effects } from './effects.js';

const PAD_BASE = STATE.PAD_BASE;

// Les planches se superposent a l'echelle 1:1 : `terrain.png` et
// `stade.png` sont toutes deux dessinees dans le meme repere 1672 x 941,
// terrain deja place dans son stade. Plus rien a mettre a l'echelle.

export const TEAM = [0x2f7ce0, 0xf07a25];
/** Carrosseries, dans l'ordre des equipes. `car_white.png` reste en reserve. */
const CAR_ART = ['assets/car_bleue.png', 'assets/car_orange.png'];
const Z = { TERRAIN: 0, PAD: 1, STADE: 2, SKID: 3, CAR: 4, BALL: 6, BLAST: 8 };

function plane(w, h, material) {
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
}

function flat(map, opts = {}) {
  return new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, ...opts });
}

/** Texture de ballon dessinee au vol : nette a tous les zooms, zero fichier. */
function ballTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#f2f0ea';
  g.beginPath();
  g.arc(64, 64, 60, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#2b3340';
  const patch = (cx, cy, r) => {
    g.beginPath();
    for (let i = 0; i < 5; i += 1) {
      const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
      g[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    g.closePath();
    g.fill();
  };
  patch(64, 64, 20);
  for (let i = 0; i < 5; i += 1) {
    const a = (i / 5) * Math.PI * 2;
    patch(64 + Math.cos(a) * 44, 64 + Math.sin(a) * 44, 13);
  }
  // Ombrage rasant : le terrain est eclaire par les projecteurs du stade.
  const grad = g.createRadialGradient(46, 46, 8, 64, 64, 62);
  grad.addColorStop(0, 'rgba(255,255,255,0.35)');
  grad.addColorStop(0.6, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.45)');
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Disque doux, reutilise pour les ombres portees et la flamme de boost. */
function blobTexture(inner) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, inner);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Renderer {
  constructor(canvas, geom) {
    this.geom = geom;
    this.mode = 'arena';
    /// Voiture suivie par la camera : la sienne, qui change en ligne.
    this.follow = 0;
    this.shake = 0;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x04060a);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -100, 100);
    this.focus = new THREE.Vector2(geom.boardW / 2, -geom.boardH / 2);

    const loader = new THREE.TextureLoader();
    this.load = (url) => {
      const t = loader.load(url);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      return t;
    };

    this._buildField();
    this._buildPads();
    this._buildActors();
    // Deux calques : la gomme reste au sol sous les voitures, le feu passe
    // au-dessus de tout, y compris de la structure du stade.
    this.skids = new Effects(this.scene, Z.SKID, 90);
    this.blasts = new Effects(this.scene, Z.BLAST, 220);
    // Une cadence par voiture : partagee, la seconde n'emettrait jamais.
    this.smokeClock = [0, 0];
    this.resize();
  }

  _buildField() {
    const { boardW: w, boardH: h } = this.geom;
    const pitch = plane(w, h, flat(this.load('assets/terrain.png')));
    pitch.position.set(w / 2, -h / 2, Z.TERRAIN);
    this.scene.add(pitch);

    const stade = plane(this.geom.boardW, this.geom.boardH, flat(this.load('assets/stade.png')));
    stade.position.set(this.geom.boardW / 2, -this.geom.boardH / 2, Z.STADE);
    this.scene.add(stade);
  }

  _buildPads() {
    // Socle et orbe sont dessines dans le meme cadre carre : les poser a la
    // meme taille suffit a les caler l'un sur l'autre. Seul l'orbe part au
    // ramassage, le socle reste visse au sol.
    this.padTex = {
      0: { base: this.load('assets/pad_small_socle.png'), orb: this.load('assets/pad_small_boost.png') },
      1: { base: this.load('assets/pad_big_socle.png'), orb: this.load('assets/pad_big_boost.png') },
    };
    this.padSize = { 0: 22, 1: 40 };
    this.pads = [];
    this.padGroup = new THREE.Group();
    this.scene.add(this.padGroup);
  }

  /** Place les plots une fois la table lue depuis le moteur. */
  setPads(table) {
    for (const p of this.pads) this.padGroup.remove(p.base, p.orb);
    this.pads = [];
    for (let i = 0; i < table.length; i += 3) {
      const big = table[i + 2] > 0.5 ? 1 : 0;
      const side = this.padSize[big];
      const x = table[i];
      const y = -table[i + 1];
      // Blending normal : le halo est deja peint dans la planche, l'additif
      // le delaverait en blanc sur le beton clair du terrain.
      const base = plane(side, side, flat(this.padTex[big].base));
      base.position.set(x, y, Z.PAD);
      const orb = plane(side, side, flat(this.padTex[big].orb));
      orb.position.set(x, y, Z.PAD + 0.2);
      this.padGroup.add(base, orb);
      this.pads.push({ base, orb, big, slot: this.pads.length, grow: 1 });
    }
  }

  _buildActors() {
    const shadow = blobTexture('rgba(0,0,0,0.55)');
    const flame = blobTexture('rgba(255,170,60,0.95)');
    const { ballR, carLen, carWid } = this.geom;

    this.ball = new THREE.Group();
    const bs = plane(ballR * 3.4, ballR * 3.4, flat(shadow, { opacity: 0.8 }));
    bs.position.set(2, -3, -1);
    this.ballDisc = plane(ballR * 2, ballR * 2, flat(ballTexture()));
    this.ball.add(bs, this.ballDisc);
    this.ball.position.z = Z.BALL;
    this.scene.add(this.ball);

    this.cars = [0, 1].map((team) => {
      const g = new THREE.Group();
      const sh = plane(carLen * 1.5, carWid * 2.2, flat(shadow, { opacity: 0.75 }));
      sh.position.set(-2, -3, -1);
      // Les planches sont dessinees nez vers le haut alors que le monde met
      // le cap sur +x : le chassis porte donc un quart de tour a lui seul,
      // par-dessus la rotation du groupe.
      const body = plane(carWid, carLen, flat(this.load(CAR_ART[team])));
      body.rotation.z = -Math.PI / 2;
      const fire = plane(carLen * 0.9, carWid * 1.2, flat(flame, { blending: THREE.AdditiveBlending }));
      fire.position.set(-carLen * 0.75, 0, -0.5);
      fire.visible = false;
      g.add(sh, body, fire);
      g.userData = { fire, body };
      g.position.z = Z.CAR;
      this.scene.add(g);
      return g;
    });
  }

  /** Gomme laissee par une voiture en travers, aux quatre roues. */
  _skid(c, i, dt) {
    if (c.demo > 0) return;
    const slip = Math.abs(c.slip);
    if (slip < 0.22 || c.speed < 90) return;
    this.smokeClock[i] += dt;
    if (this.smokeClock[i] < 0.02) return;
    this.smokeClock[i] = 0;
    const strength = Math.min((slip - 0.22) / 0.8, 1);
    const back = -this.geom.carLen * 0.35;
    const side = this.geom.carWid * 0.5 * (Math.random() < 0.5 ? 1 : -1);
    const cos = Math.cos(-c.yaw);
    const sin = Math.sin(-c.yaw);
    this.skids.skid(
      c.x + back * cos - side * sin,
      -c.y + back * sin + side * cos,
      strength,
    );
  }

  resize() {
    const w = this.renderer.domElement.clientWidth || innerWidth;
    const h = this.renderer.domElement.clientHeight || innerHeight;
    this.renderer.setSize(w, h, false);
    this.viewport = { w, h };
    this._frame();
  }

  /** Cadre la camera : arene entiere, ou suivi resserre sur le joueur. */
  _frame() {
    const { w, h } = this.viewport;
    const zoom = this.mode === 'follow' ? 0.46 : 1;
    const bw = this.geom.boardW * zoom;
    const bh = this.geom.boardH * zoom;
    const scale = Math.min(w / bw, h / bh);
    const hw = w / scale / 2;
    const hh = h / scale / 2;
    const c = this.camera;
    c.left = -hw;
    c.right = hw;
    c.top = hh;
    c.bottom = -hh;
    c.updateProjectionMatrix();
    this.half = { hw, hh };
  }

  setMode(mode) {
    this.mode = mode;
    this._frame();
  }

  /** Boule de feu a l'endroit ou la voiture a saute. */
  explode(x, y, team) {
    this.blasts.explode(x, -y, TEAM[team] ?? 0xffffff);
    this.skids.smoke(x, -y);
    this.kick(22);
  }

  /** Remet les particules a zero entre deux engagements. */
  clearEffects() {
    this.skids.clear();
    this.blasts.clear();
  }

  /** Secousse d'ecran, en unites monde. */
  kick(amount) {
    this.shake = Math.min(this.shake + amount, 26);
  }

  update(state, readCar, dt) {
    const { boardW, boardH } = this.geom;
    this.ball.position.set(state[6], -state[7], Z.BALL);
    this.ballDisc.rotation.z = -state[10] * 0.25;

    for (let i = 0; i < this.cars.length; i += 1) {
      const c = readCar(state, i);
      const g = this.cars[i];
      g.visible = c.demo <= 0;
      g.position.set(c.x, -c.y, Z.CAR);
      g.rotation.z = -c.yaw;
      // La flamme s'allonge avec la vitesse, comme la trainee du jeu.
      const fire = g.userData.fire;
      fire.visible = c.flame > 0;
      if (fire.visible) {
        const ratio = Math.min(c.speed / this.geom.speedMax, 1);
        const stretch = 1 + ratio * 2.4 + Math.random() * 0.18;
        fire.scale.set(stretch, 1 + ratio * 0.35, 1);
        fire.position.x = -this.geom.carLen * (0.5 + 0.45 * stretch);
      }
      this._skid(c, i, dt);
    }

    for (const p of this.pads) {
      const ready = state[PAD_BASE + p.slot] <= 0;
      // L'orbe repousse au lieu d'apparaitre d'un coup a la reapparition.
      p.grow = ready ? Math.min(1, p.grow + dt * 4.5) : 0;
      p.orb.visible = ready;
      if (ready) {
        const pulse = 1 + Math.sin(performance.now() / (p.big ? 420 : 300)) * 0.06;
        const pop = p.grow * p.grow * (3 - 2 * p.grow);
        p.orb.scale.setScalar(pulse * pop);
      }
    }

    // Camera : centree sur l'arene, ou glissant vers le joueur et la balle.
    let tx = boardW / 2;
    let ty = -boardH / 2;
    if (this.mode === 'follow') {
      const p = readCar(state, this.follow);
      tx = (p.x * 2 + state[6]) / 3;
      ty = -(p.y * 2 + state[7]) / 3;
      tx = Math.max(this.half.hw, Math.min(boardW - this.half.hw, tx));
      ty = Math.min(-this.half.hh, Math.max(-boardH + this.half.hh, ty));
    }
    const k = 1 - Math.exp(-8 * dt);
    this.focus.x += (tx - this.focus.x) * k;
    this.focus.y += (ty - this.focus.y) * k;

    this.skids.update(dt);
    this.blasts.update(dt);

    this.shake *= Math.exp(-7 * dt);
    const s = this.shake;
    this.camera.position.set(
      this.focus.x + (Math.random() - 0.5) * s,
      this.focus.y + (Math.random() - 0.5) * s,
      10,
    );
    this.camera.lookAt(this.camera.position.x, this.camera.position.y, 0);
    this.renderer.render(this.scene, this.camera);
  }
}
