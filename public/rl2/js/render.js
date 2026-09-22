// Rendu three.js du terrain vu de dessus.
//
// Le repere monde est celui des planches (1672 x 941, y vers le bas) ; on le
// bascule en repere three.js en niant y. Le decor du stade, lui, se recale
// sur l'enceinte du moteur : voir `stadiums.js`.

import * as THREE from '../vendor/three.module.js';
import { STATE, carsIn, padBase } from './wasm.js';
import { Effects } from './effects.js';
import { makeFlames } from './flame.js';
import { makeTrails } from './trail.js';
import { Names } from './names.js';
import { fitPlank, stadiumById } from './stadiums.js';
import { applySpin, makeBall, makeSky } from './scene3d.js';

export const TEAM = [0x2f7ce0, 0xf07a25];
/** Carrosseries, dans l'ordre des equipes. `car_white.png` reste en reserve. */
const CAR_ART = ['assets/car_bleue.png', 'assets/car_orange.png'];
const Z = { TERRAIN: 0, PAD: 1, STADE: 2, SKID: 3, CAR: 4, BALL: 6, NAME: 7, BLAST: 8 };

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
    // Seule la balle projette une ombre : une carte souple suffit, et son
    // flou masque les marches d'escalier d'une resolution modeste.
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x04060a);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -100, 100);
    this.focus = new THREE.Vector2(geom.boardW / 2, -geom.boardH / 2);

    const loader = new THREE.TextureLoader();
    this.load = (url) => {
      // Les planches de stade portent le nom du stade, accents et
      // apostrophe compris : on encode avant de demander le fichier plutot
      // que de s'en remettre au navigateur, qui n'encode pas toujours.
      const t = loader.load(encodeURI(url));
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      return t;
    };

    this._buildField();
    this.sky = makeSky(this.scene, geom);
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
    // Les planches du stade vivent dans leur propre groupe : changer de
    // stade revient a le vider et a le remplir a nouveau, sans toucher au
    // reste de la scene.
    this.field = new THREE.Group();
    this.scene.add(this.field);
    this.setStadium(stadiumById('voidbelt'));
  }

  /** Pose les planches d'un stade et les recale sur l'enceinte du moteur.
   *  Le decor n'a pas de role physique : seule compte la superposition du
   *  muret peint et du mur ou rebondit la balle. */
  setStadium(stadium, raw = false) {
    this.stadium = stadium;
    this.raw = raw;
    for (const m of this.field.children.slice()) {
      this.field.remove(m);
      m.material.map?.dispose();
      m.material.dispose();
      m.geometry.dispose();
    }
    // En calage (F4) la planche se pose telle quelle, centree sur le
    // cadre : c'est le contour qu'on deplace pour venir dessus, pas
    // l'inverse. Le reste du temps elle est recalee sur l'enceinte.
    const box = raw
      ? { w: this.geom.boardW, h: this.geom.boardH, x: this.geom.boardW / 2, y: this.geom.boardH / 2 }
      : fitPlank(stadium, this.geom);
    // Le stade d'origine garde ses deux calques transparents ; les autres
    // sont des planches pleines, terrain et decor deja composes.
    const arts = stadium.layers || [stadium.art];
    arts.forEach((url, i) => {
      const m = plane(box.w, box.h, flat(this.load(url)));
      m.position.set(box.x, -box.y, i === 0 ? Z.TERRAIN : Z.STADE);
      this.field.add(m);
    });
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
    const { ballR, carLen, carWid } = this.geom;

    this.ball = new THREE.Group();
    const bs = plane(ballR * 3.4, ballR * 3.4, flat(shadow, { opacity: 0.8 }));
    bs.position.set(2, -3, -1);
    this.ballDisc = plane(ballR * 2, ballR * 2, flat(ballTexture()));
    this.ball.add(bs, this.ballDisc);
    this.ball.position.z = Z.BALL;
    this.scene.add(this.ball);

    // La balle en volume prend le relais des qu'elle est chargee. Le disque
    // et son ombre peinte s'effacent alors : le modele porte la sienne.
    makeBall(this.ball, this.geom, (modele) => {
      this.ballModel = modele;
      this.ballDisc.visible = false;
      bs.visible = false;
    });

    // Les voitures naissent a la demande : un salon en ligne n'a pas de
    // plafond, et son effectif change quand quelqu'un arrive ou s'en va.
    this.carShadow = shadow;
    // Tailles au moment de la construction : reference pour la remise a
    // l'echelle quand `/admin` change un gabarit.
    this.built = { ballR, carLen, carWid };
    this.cars = [];
    this.roster = [];
    this.names = new Names(this.scene, Z.NAME, TEAM.map((c) => `#${c.toString(16).padStart(6, '0')}`));
  }

  /** Reprend une geometrie modifiee depuis `/admin`. Plutot que de refaire
   *  les maillages a chaque curseur, on remet a l'echelle par rapport aux
   *  tailles d'origine : le rapport se recalcule a chaque appel, donc les
   *  reglages successifs ne se cumulent pas. */
  setGeometry(g) {
    this.geom = g;
    if (this.stadium) this.setStadium(this.stadium, this.raw);
    const b = this.built;
    this.ball.scale.setScalar(g.ballR / b.ballR);
    for (const car of this.cars) {
      car.scale.set(g.carLen / b.carLen, g.carWid / b.carWid, 1);
    }
  }

  /** Cree une voiture de plus, dans la livree de son camp. */
  _addCar(team) {
    const { carLen, carWid } = this.geom;
    const g = new THREE.Group();
    const sh = plane(carLen * 1.5, carWid * 2.2, flat(this.carShadow, { opacity: 0.75 }));
    sh.position.set(-2, -3, -1);
    // Les planches sont dessinees nez vers le haut alors que le monde met
    // le cap sur +x : le chassis porte donc un quart de tour a lui seul,
    // par-dessus la rotation du groupe.
    const body = plane(carWid, carLen, flat(this.load(CAR_ART[team & 1])));
    body.rotation.z = -Math.PI / 2;
    g.add(sh, body);
    // Les reacteurs se montent apres le chassis : ils s'accrochent aux
    // pots releves sur la planche, pas a un point choisi a la main.
    g.userData = {
      body,
      team: team & 1,
      flames: makeFlames(g, this.geom, this.load),
      trails: makeTrails(g, this.geom, this.load),
    };
    g.position.z = Z.CAR;
    this.scene.add(g);
    this.cars.push(g);
    return g;
  }

  /** Composition du salon : un `{ name, team }` par siege. Refait les
   *  carrosseries dont le camp a change et les etiquettes. */
  setRoster(list) {
    this.roster = list;
    for (let i = 0; i < list.length; i += 1) {
      const team = list[i].team & 1;
      const g = this.cars[i];
      if (!g) {
        this._addCar(team);
      } else if (g.userData.team !== team) {
        g.userData.team = team;
        g.userData.body.material.map = this.load(CAR_ART[team]);
        g.userData.body.material.needsUpdate = true;
      }
    }
    this.names.set(list);
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
    const now = performance.now() / 1000;
    const { boardW, boardH } = this.geom;
    // En calage, la planche n'est plus a sa place de jeu : voitures, balle
    // et plots y seraient a cote de tout. On degage la vue.
    const show = !this.raw;
    this.padGroup.visible = show;
    this.ball.visible = show;
    this.ball.position.set(state[6], -state[7], Z.BALL);
    if (this.ballModel) applySpin(this.ballModel, state, STATE.BALL_SPIN);
    else this.ballDisc.rotation.z = -state[10] * 0.25;
    this.sky?.(now);

    // L'effectif est annonce par l'image elle-meme : il grandit quand
    // quelqu'un rejoint le salon.
    const count = carsIn(state);
    while (this.cars.length < count) {
      this._addCar(this.roster[this.cars.length]?.team ?? this.cars.length % 2);
    }
    for (let i = 0; i < this.cars.length; i += 1) {
      const g = this.cars[i];
      if (i >= count || !show) {
        g.visible = false;
        this.names.place(i, 0, 0, false);
        continue;
      }
      const c = readCar(state, i);
      const alive = c.demo <= 0 && show;
      g.visible = alive;
      g.position.set(c.x, -c.y, Z.CAR);
      g.rotation.z = -c.yaw;
      g.userData.flames(c, dt, now);
      g.userData.trails(c, dt);
      this.names.place(i, c.x, -c.y, alive);
      this._skid(c, i, dt);
    }

    for (const p of this.pads) {
      const ready = state[padBase(count) + p.slot] <= 0;
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
