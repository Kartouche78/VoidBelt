// Particules : explosions de demolition, fumee de drift, gerbes de boost.
//
// Un seul reservoir de quads recycles, pour ne rien allouer en pleine partie.
// Chaque particule est un plan oriente face camera : vu de dessus, ca suffit.

import * as THREE from '../vendor/three.module.js';

/** Disque doux, du centre opaque au bord transparent. */
function blobTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Anneau fin : l'onde de choc qui part du point d'impact. */
function ringTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.strokeStyle = '#fff';
  g.lineWidth = 9;
  g.shadowColor = '#fff';
  g.shadowBlur = 12;
  g.beginPath();
  g.arc(64, 64, 52, 0, Math.PI * 2);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Eclat plein, sans halo : les morceaux de carrosserie projetes. */
function shardTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(2, 5, 12, 6);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Effects {
  /** `size` : nombre de quads recycles par ce calque. */
  constructor(scene, z, size) {
    this.size = size;
    this.tex = { blob: blobTexture(), ring: ringTexture(), shard: shardTexture() };
    this.group = new THREE.Group();
    this.group.position.z = z;
    scene.add(this.group);

    const geo = new THREE.PlaneGeometry(1, 1);
    this.pool = [];
    for (let i = 0; i < size; i += 1) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        transparent: true,
        depthWrite: false,
        depthTest: false,
      }));
      m.visible = false;
      m.userData.life = 0;
      this.group.add(m);
      this.pool.push(m);
    }
    this.next = 0;
  }

  /** Recycle toujours la plus vieille place : jamais d'allocation en jeu. */
  _take() {
    const m = this.pool[this.next];
    this.next = (this.next + 1) % this.size;
    return m;
  }

  spawn(o) {
    const m = this._take();
    const d = m.userData;
    d.life = o.life;
    d.max = o.life;
    d.vx = o.vx ?? 0;
    d.vy = o.vy ?? 0;
    d.drag = o.drag ?? 0;
    d.from = o.from;
    d.to = o.to ?? o.from;
    d.spin = o.spin ?? 0;
    d.fade = o.fade ?? 1;
    d.delay = o.delay ?? 0;
    m.material.map = o.map ?? this.tex.blob;
    m.material.color.setHex(o.color);
    m.material.blending = o.additive === false ? THREE.NormalBlending : THREE.AdditiveBlending;
    m.material.opacity = o.fade;
    m.material.needsUpdate = true;
    m.position.set(o.x, o.y, o.z ?? 0);
    m.rotation.z = o.angle ?? Math.random() * Math.PI * 2;
    m.scale.setScalar(o.from);
    m.visible = d.delay <= 0;
    return m;
  }

  /** Boule de feu, onde de choc, eclats et fumee : la voiture saute. */
  explode(x, y, color) {
    // Eclair, coeur blanc, deux ondes : l'ordre de grandeur est celui du
    // rond central, sinon la deflagration se perd dans le plan large.
    this.spawn({ x, y, from: 36, to: 200, life: 0.38, color: 0xfff6d2, fade: 1 });
    this.spawn({ x, y, from: 24, to: 120, life: 0.22, color: 0xffffff, fade: 1 });
    this.spawn({ x, y, map: this.tex.ring, from: 30, to: 420, life: 0.6, color: 0xffc46a, fade: 1 });
    this.spawn({ x, y, map: this.tex.ring, from: 14, to: 210, life: 0.36, color: 0xffffff, fade: 0.9 });
    for (let i = 0; i < 7; i += 1) {
      const a = Math.random() * Math.PI * 2;
      const s = 30 + Math.random() * 50;
      this.spawn({
        x: x + Math.cos(a) * 12, y: y + Math.sin(a) * 12,
        vx: Math.cos(a) * s, vy: Math.sin(a) * s, drag: 2.2,
        from: 55 + Math.random() * 40, to: 185, life: 0.5 + Math.random() * 0.3,
        color: i % 2 ? 0xff7a1e : 0xffb43a,
      });
    }
    for (let i = 0; i < 22; i += 1) {
      const a = Math.random() * Math.PI * 2;
      const s = 190 + Math.random() * 280;
      this.spawn({
        x, y, map: this.tex.shard, angle: a,
        vx: Math.cos(a) * s, vy: Math.sin(a) * s, drag: 2.6,
        from: 16 + Math.random() * 11, to: 6, life: 0.6 + Math.random() * 0.65,
        color: i % 3 === 0 ? color : 0xffcf8a, spin: (Math.random() - 0.5) * 16,
      });
    }
  }

  /** Fumee de la deflagration. Elle vit sur le calque du sol, sous le feu :
   *  posee sur le meme plan elle perce la boule de lumiere d'un trou noir,
   *  quel que soit son retard a l'allumage. */
  smoke(x, y) {
    for (let i = 0; i < 12; i += 1) {
      const a = Math.random() * Math.PI * 2;
      const s = 30 + Math.random() * 70;
      this.spawn({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, drag: 1.4,
        from: 30, to: 120 + Math.random() * 70, life: 1.0 + Math.random() * 0.8,
        delay: Math.random() * 0.12,
        color: 0x39435a, additive: false, fade: 0.55,
      });
    }
  }

  /** Volute de gomme laissee par une voiture en travers. */
  skid(x, y, strength) {
    this.spawn({
      x, y,
      vx: (Math.random() - 0.5) * 26, vy: (Math.random() - 0.5) * 26,
      drag: 2.0,
      from: 9 + strength * 7, to: 30 + strength * 26,
      life: 0.45 + strength * 0.3,
      color: 0x8c93a4, additive: false, fade: 0.2 + strength * 0.22,
    });
  }

  update(dt) {
    for (const m of this.pool) {
      const d = m.userData;
      if (d.life <= 0) continue;
      // Une particule en attente ne s'affiche pas encore : c'est ce qui
      // laisse la fumee sortir apres le feu au lieu de le masquer.
      if (d.delay > 0) {
        d.delay -= dt;
        if (d.delay > 0) continue;
        m.visible = true;
      }
      d.life -= dt;
      if (d.life <= 0) {
        m.visible = false;
        continue;
      }
      const k = 1 - d.life / d.max;
      const damp = Math.exp(-d.drag * dt);
      d.vx *= damp;
      d.vy *= damp;
      m.position.x += d.vx * dt;
      m.position.y += d.vy * dt;
      m.rotation.z += d.spin * dt;
      m.scale.setScalar(d.from + (d.to - d.from) * k);
      // Pleine intensite sur la premiere moitie de vie, puis extinction :
      // une decroissance immediate rendait les explosions fantomatiques.
      m.material.opacity = d.fade * Math.min(1, (1 - k) * 2.0);
    }
  }

  clear() {
    for (const m of this.pool) {
      m.visible = false;
      m.userData.life = 0;
    }
  }
}
