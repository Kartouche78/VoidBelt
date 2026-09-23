// Calques de mise au point, reserves au solo.
//
//   F1  contour et grillage de l'aire de jeu, cages comprises
//   F2  boites de collision des voitures et de la balle
//   F3  toutes les vitesses divisees par deux — aussi sur F8
//
// F3 ouvre la recherche du navigateur et ne descend pas toujours jusqu'a
// la page : F8, que personne ne reclame, fait la meme chose. Les chiffres
// 1 a 4, eux, servent desormais au tchat rapide.
//
// Rien ici ne touche a la simulation : F1 et F2 ne font que dessiner ce que
// le moteur applique deja. Seul F3 ecrit des reglages, et il les rend tels
// quels en repassant dessus. Les gabarits, eux, ne bougent jamais.

import * as THREE from '../vendor/three.module.js';

const VIOLET = 0xb14cff;
const VIOLET_PALE = 0x6a2a99;
const JAUNE = 0xffd24a;
/// Au-dessus des voitures et de la balle : un repere qu'on cache derriere
/// ce qu'il mesure ne sert a rien.
const Z = 9;
/// Pas du grillage, en unites de jeu. Cent unites font environ 3,7 m.
const PAS = 100;
/// Sommets reserves par boite : le rectangle du chassis et son disque.
const CAP = 64;

/** Reglages divises par deux par F3 : les plafonds de vitesse, et eux
 *  seuls. Ni les tailles, ni les accelerations — celles-ci se comptent en
 *  vitesse par seconde, ce n'est pas la meme grandeur. La voiture atteint
 *  donc son plafond deux fois plus vite, et y reste. */
const MOITIE = [
  'drive_max',       // plafond du moteur seul
  'speed_max',       // plafond absolu, boost compris
  'supersonic',      // seuil du supersonique, et de la demolition
  'demo_speed',      // vitesse a laquelle on demolit
  'ball_max_speed',  // plafond de la balle
];

function lines(color, opacity = 1) {
  return new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: false });
}

/** Segments d'un rectangle a coins arrondis, dans le sens horaire. Les
 *  deux rayons se donnent separement : en calage, l'arrondi du moteur est
 *  un cercle dans le repere du jeu, donc une ellipse sur la planche, que
 *  les deux echelles ne tendent pas pareil. */
function roundedRect(f, steps = 8) {
  const { minX, maxX, minY, maxY } = f;
  const rx = Math.max(0, Math.min(f.rx, (maxX - minX) / 2));
  const ry = Math.max(0, Math.min(f.ry, (maxY - minY) / 2));
  const pts = [];
  const arc = (cx, cy, from) => {
    for (let i = 0; i <= steps; i += 1) {
      const a = from + (i / steps) * (Math.PI / 2);
      pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
    }
  };
  // Le repere du jeu descend vers le bas ; on parcourt les quatre arcs en
  // partant du coin haut-gauche.
  arc(minX + rx, minY + ry, Math.PI);
  arc(maxX - rx, minY + ry, -Math.PI / 2);
  arc(maxX - rx, maxY - ry, 0);
  arc(minX + rx, maxY - ry, Math.PI / 2);
  pts.push(pts[0]);
  return pts;
}

/** Maillage de segments a partir d'une liste de polylignes. */
function segments(polylines, material) {
  const v = [];
  for (const line of polylines) {
    for (let i = 0; i + 1 < line.length; i += 1) {
      v.push(line[i][0], -line[i][1], Z, line[i + 1][0], -line[i + 1][1], Z);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  const m = new THREE.LineSegments(g, material);
  m.renderOrder = 999;
  return m;
}

/** Cercle ferme, en polyligne. */
/** Arrondi d'un poteau, du muret vers la joue du filet. `dir` dit de quel
 *  cote s'enfonce le filet, `side` de quel cote de l'axe est le poteau. Le
 *  centre de l'arc est celui du moteur, dans `arena.rs` : decale d'un rayon
 *  dans le filet et d'un rayon au-dela de la bouche. */
function post(mouth, dir, cy, side, half, r) {
  const pts = [];
  if (r <= 0) return [[mouth, cy + side * half]];
  const ox = mouth + dir * r;
  const oy = cy + side * (half + r);
  for (let i = 0; i <= 8; i += 1) {
    const a = (i / 8) * Math.PI * 0.5;
    // De la face du muret (vers le terrain) a la joue (vers l'axe).
    pts.push([ox - dir * r * Math.cos(a), oy - side * r * Math.sin(a)]);
  }
  return pts;
}

function circle(cx, cy, r, steps = 24) {
  const pts = [];
  for (let i = 0; i <= steps; i += 1) {
    const a = (i / steps) * Math.PI * 2;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return pts;
}

export class Debug {
  /** `engine` sert a F3 ; `onTune` previent l'appelant qu'il faut relire la
   *  geometrie et remettre le dessin a l'echelle. */
  constructor(scene, geom, engine, onTune) {
    this.scene = scene;
    this.geom = geom;
    this.engine = engine;
    this.onTune = onTune;
    this.limits = false;
    this.boxes = false;
    this.half = false;
    this.group = new THREE.Group();
    this.group.visible = false;
    this.scene.add(this.group);
    this.hitGroup = new THREE.Group();
    this.hitGroup.visible = false;
    this.scene.add(this.hitGroup);
    this.hits = [];
  }

  /** Bascule un calque. Renvoie le message a afficher, ou `null`. */
  toggle(key) {
    if (key === 'F1') {
      this.limits = !this.limits;
      if (this.limits) this._buildLimits();
      this.group.visible = this.limits;
      return `Limites du terrain : ${this.limits ? 'visibles' : 'masquees'}`;
    }
    if (key === 'F2') {
      this.boxes = !this.boxes;
      this.hitGroup.visible = this.boxes;
      return `Boites de collision : ${this.boxes ? 'visibles' : 'masquees'}`;
    }
    if (key === 'F3') {
      this.half = !this.half;
      this._applyScale();
      return `Vitesses : ${this.half ? 'divisees par deux' : 'normales'}`;
    }
    return null;
  }

  /** F3 : reecrit les vitesses a partir des valeurs d'usine, jamais des
   *  valeurs en cours. Sinon deux bascules de suite diviseraient par quatre. */
  _applyScale() {
    const base = this.engine.tuneDefaults();
    const values = {};
    for (const k of MOITIE) values[k] = base[k] * (this.half ? 0.5 : 1);
    this.engine.setTune(values);
    this.onTune();
  }

  /** La geometrie a change : stade, reglage ou F3. On refait le contour. */
  setGeometry(geom) {
    this.geom = geom;
    // Le disque de contact est un reglage a part, pas la moitie du gabarit.
    // On le relit ici plutot qu'a chaque image : lire les reglages decode
    // tout le bloc de noms venu du wasm, ce n'est pas gratuit.
    this.carRadius = this.engine.tune().car_radius;
    if (this.limits) this._buildLimits();
  }

  _clear(group) {
    for (const m of group.children.slice()) {
      group.remove(m);
      m.geometry.dispose();
      m.material.dispose();
    }
  }

  /** Cadre a tracer : l'enceinte du moteur, ou celle que le mode calage
   *  promene sur la planche. */
  _frame() {
    if (this.frame) return this.frame;
    const g = this.geom;
    return {
      minX: g.minX, maxX: g.maxX, minY: g.minY, maxY: g.maxY,
      rx: g.corner, ry: g.corner,
      goalHalf: g.goalHalf, goalFront: g.goalFront, goalDepth: g.goalDepth,
      post: g.postR ?? 0,
      bulge: g.postBulge ?? 0,
    };
  }

  /** Le mode calage impose son cadre ; `null` rend la main a l'enceinte. */
  setFrame(frame) {
    this.frame = frame;
    if (this.limits) this._buildLimits();
  }

  _buildLimits() {
    this._clear(this.group);
    const g = this._frame();
    const cy = (g.minY + g.maxY) / 2;
    const mouthL = g.minX + g.goalFront;
    const mouthR = g.maxX - g.goalFront;

    // Grillage : un quadrillage regulier, borne au cadre. Il donne
    // l'echelle et rend visible tout decalage du decor. Ses mailles
    // suivent le cadre, pour rester comparables d'un stade a l'autre.
    const grid = [];
    const stepX = (g.maxX - g.minX) / Math.round((this.geom.maxX - this.geom.minX) / PAS);
    const stepY = (g.maxY - g.minY) / Math.round((this.geom.maxY - this.geom.minY) / PAS);
    for (let x = g.minX + stepX; x < g.maxX - 1; x += stepX) {
      grid.push([[x, g.minY], [x, g.maxY]]);
    }
    for (let y = g.minY + stepY; y < g.maxY - 1; y += stepY) {
      grid.push([[g.minX, y], [g.maxX, y]]);
    }
    this.group.add(segments(grid, lines(VIOLET_PALE, 0.45)));

    // Contour : exactement la forme sur laquelle la balle rebondit, coins
    // arrondis du stade compris.
    this.group.add(segments([roundedRect(g, 14)], lines(VIOLET)));

    // Cages : la bouche reste ouverte, les trois parois du filet bornent,
    // et chaque poteau est l'arrondi qui raccorde le muret a sa joue.
    const nets = [];
    for (const [mouth, dir] of [[mouthL, -1], [mouthR, 1]]) {
      const back = mouth + dir * g.goalDepth;
      nets.push([
        ...post(mouth, dir, cy, -1, g.goalHalf, g.post),
        [back, cy - g.goalHalf],
        [back, cy + g.goalHalf],
        ...post(mouth, dir, cy, 1, g.goalHalf, g.post).reverse(),
      ]);
    }
    // Le poteau lui-meme : un disque qui affleure le muret et mord sur la
    // bouche de sa surepaisseur, comme dans `arena.rs`.
    if (g.post > 0) {
      const rp = g.post + (g.bulge || 0);
      for (const [mouth, dir] of [[mouthL, -1], [mouthR, 1]]) {
        for (const side of [-1, 1]) {
          nets.push(circle(mouth + dir * rp, cy + side * (g.goalHalf + g.post), rp, 20));
        }
      }
    }
    this.group.add(segments(nets, lines(JAUNE)));
  }

  /** Suit les voitures image par image quand F2 est actif. */
  update(state, readCar, count) {
    if (!this.boxes) return;
    const { carLen, carWid, ballR } = this.geom;
    const radius = this.carRadius ?? carLen / 2;
    while (this.hits.length < count + 1) this._addSlot();

    for (let i = 0; i < count; i += 1) {
      const c = readCar(state, i);
      if (c.demo > 0) {
        this.hits[i].visible = false;
        continue;
      }
      const cos = Math.cos(c.yaw);
      const sin = Math.sin(c.yaw);
      const at = (fx, fy) => [c.x + fx * cos - fy * sin, c.y + fx * sin + fy * cos];
      const hl = carLen / 2;
      const hw = carWid / 2;
      const rect = [at(-hl, -hw), at(hl, -hw), at(hl, hw), at(-hl, hw)];
      rect.push(rect[0]);
      this._repaint(i, [rect, circle(c.x, c.y, radius)]);
    }
    for (let i = count; i < this.hits.length - 1; i += 1) this.hits[i].visible = false;
    // La balle ferme la marche.
    this._repaint(this.hits.length - 1, [circle(state[6], state[7], ballR)]);
  }

  /** Un emplacement de trace : sa geometrie est allouee une fois et
   *  reecrite a chaque image, sinon on creerait soixante maillages par
   *  seconde et par voiture. */
  _addSlot() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(CAP * 3), 3));
    const m = new THREE.LineSegments(g, lines(VIOLET));
    m.renderOrder = 999;
    m.frustumCulled = false;
    this.hitGroup.add(m);
    this.hits.push(m);
  }

  /** Reecrit les sommets d'un emplacement depuis des polylignes. */
  _repaint(slot, polylines) {
    const mesh = this.hits[slot];
    const attr = mesh.geometry.getAttribute('position');
    const a = attr.array;
    let n = 0;
    for (const line of polylines) {
      for (let i = 0; i + 1 < line.length && n + 2 <= CAP; i += 1) {
        a[n * 3] = line[i][0];
        a[n * 3 + 1] = -line[i][1];
        a[n * 3 + 2] = Z;
        a[n * 3 + 3] = line[i + 1][0];
        a[n * 3 + 4] = -line[i + 1][1];
        a[n * 3 + 5] = Z;
        n += 2;
      }
    }
    attr.needsUpdate = true;
    mesh.geometry.setDrawRange(0, n);
    mesh.visible = n > 0;
  }
}
