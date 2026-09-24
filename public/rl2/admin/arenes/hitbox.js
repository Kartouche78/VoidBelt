// Apercu d'une planche avec sa hitbox, et son calage.
//
// La planche est dessinee au format des arenes creees (1920 x 1080) et la
// hitbox
// par-dessus, calculee comme le fait le moteur : contour aux coins
// arrondis, cages, poteaux ronds. Caler, c'est deplacer ce trace jusqu'a ce
// qu'il epouse le muret et les cages peints — a la souris, au clavier ou
// aux boutons.

import { BOSSE, ENCEINTE, PLANCHE } from './gabarits.js';

const VIOLET = '#c77dff';
const JAUNE = '#ffd23f';

/** Echelles entre l'enceinte du moteur et le contour peint. */
function echelles(c) {
  const [l, r, t, b] = c.fit;
  return { kx: (r - l) / (ENCEINTE.r - ENCEINTE.l), ky: (b - t) / (ENCEINTE.b - ENCEINTE.t) };
}

/** Trace la hitbox de `c` ({ fit, corner, goal }) sur le contexte `g`,
 *  deja a l'echelle de la planche. */
export function drawHitbox(g, c) {
  const [l, r, t, b] = c.fit;
  const { kx, ky } = echelles(c);
  const rx = c.corner * kx;
  const ry = c.corner * ky;
  const cy = (t + b) / 2;
  g.save();
  g.lineWidth = 2.5;
  g.strokeStyle = VIOLET;
  g.beginPath();
  g.moveTo(l + rx, t);
  g.lineTo(r - rx, t);
  g.ellipse(r - rx, t + ry, rx, ry, 0, -Math.PI / 2, 0);
  g.lineTo(r, b - ry);
  g.ellipse(r - rx, b - ry, rx, ry, 0, 0, Math.PI / 2);
  g.lineTo(l + rx, b);
  g.ellipse(l + rx, b - ry, rx, ry, 0, Math.PI / 2, Math.PI);
  g.lineTo(l, t + ry);
  g.ellipse(l + rx, t + ry, rx, ry, 0, Math.PI, Math.PI * 1.5);
  g.stroke();

  // Cages : joues et fond du filet, puis les poteaux ronds, qui affleurent
  // le muret et mordent sur la bouche de leur surepaisseur.
  const half = c.goal.half * ky;
  const depth = c.goal.depth * kx;
  const post = c.goal.post;
  g.strokeStyle = JAUNE;
  for (const [mouth, dir] of [[l, -1], [r, 1]]) {
    const back = mouth + dir * depth;
    g.beginPath();
    g.moveTo(mouth, cy - half);
    g.lineTo(back, cy - half);
    g.lineTo(back, cy + half);
    g.lineTo(mouth, cy + half);
    g.stroke();
    if (post > 0) {
      const rp = (post + BOSSE) * kx;
      for (const side of [-1, 1]) {
        g.beginPath();
        g.ellipse(mouth + dir * rp, cy + side * (half + post * ky), rp, (post + BOSSE) * ky, 0, 0, Math.PI * 2);
        g.stroke();
      }
    }
  }
  g.restore();
}

/** Gestes de calage. `pas` en pixels de planche, ou en unites de jeu pour
 *  les cages : les memes que F4 et F6 en jeu. */
export const GESTES = [
  ['Déplacer', [['←', { dx: -1 }], ['→', { dx: 1 }], ['↑', { dy: -1 }], ['↓', { dy: 1 }]]],
  ['Largeur', [['−', { dw: -1 }], ['+', { dw: 1 }]]],
  ['Hauteur', [['−', { dh: -1 }], ['+', { dh: 1 }]]],
  ['Coins', [['−', { dc: -1 }], ['+', { dc: 1 }]]],
  ['Ouverture', [['−', { half: -1 }], ['+', { half: 1 }]]],
  ['Filet', [['−', { depth: -1 }], ['+', { depth: 1 }]]],
  ['Poteaux', [['−', { post: -1 }], ['+', { post: 1 }]]],
];

/** Touches du calage : fleches, A/D largeur, W/S hauteur, Q/E coins,
 *  I/K ouverture, J/L filet, U/O poteaux. */
const TOUCHES = {
  ArrowLeft: { dx: -1 }, ArrowRight: { dx: 1 }, ArrowUp: { dy: -1 }, ArrowDown: { dy: 1 },
  a: { dw: -1 }, d: { dw: 1 }, w: { dh: -1 }, s: { dh: 1 }, q: { dc: -1 }, e: { dc: 1 },
  i: { half: 1 }, k: { half: -1 }, j: { depth: -1 }, l: { depth: 1 }, u: { post: -1 }, o: { post: 1 },
};

export function gesteDe(e) {
  return TOUCHES[e.key.length === 1 ? e.key.toLowerCase() : e.key] || null;
}

/** Applique un geste au calage `c`, multiplie par `n` (Maj : 10). Memes
 *  bornes que le moteur, pour que les chiffres montres soient ceux joues. */
export function applique(c, m, n = 1) {
  const [l, r, t, b] = c.fit;
  const dx = (m.dx || 0) * n;
  const dy = (m.dy || 0) * n;
  const dw = ((m.dw || 0) * n) / 2;
  const dh = ((m.dh || 0) * n) / 2;
  c.fit = [l + dx - dw, r + dx + dw, t + dy - dh, b + dy + dh];
  c.corner = Math.min(330, Math.max(0, c.corner + (m.dc || 0) * n));
  c.goal.half = Math.min(200, Math.max(30, c.goal.half + (m.half || 0) * n));
  c.goal.depth = Math.min(150, Math.max(15, c.goal.depth + (m.depth || 0) * n));
  c.goal.post = Math.min(40, Math.max(0, c.goal.post + (m.post || 0) * n));
}

/** Resume lisible d'un calage. */
export function resume(c) {
  const px = (v) => String(Math.round(v * 100) / 100).replace('.', ',');
  const [l, r, t, b] = c.fit.map(px);
  return `contour [${l}, ${r}, ${t}, ${b}] · coins ${Math.round(c.corner)} · ouverture ${Math.round(c.goal.half) * 2} · filet ${Math.round(c.goal.depth)} · poteaux ${Math.round(c.goal.post)}`;
}

/** Canevas au format planche : l'image etiree comme le jeu l'etirera,
 *  puis la hitbox. `onDrag(dx, dy)` recoit les glissements, en pixels de
 *  planche. */
export function apercu(img, calage, onDrag) {
  const cv = document.createElement('canvas');
  cv.width = PLANCHE.w;
  cv.height = PLANCHE.h;
  cv.className = 'planche';
  cv.tabIndex = 0;
  const paint = () => {
    const g = cv.getContext('2d');
    g.fillStyle = '#04060a';
    g.fillRect(0, 0, cv.width, cv.height);
    if (img?.complete && img.naturalWidth) g.drawImage(img, 0, 0, cv.width, cv.height);
    drawHitbox(g, calage());
  };
  let depart = null;
  cv.addEventListener('pointerdown', (e) => {
    if (!onDrag) return;
    depart = { x: e.clientX, y: e.clientY };
    cv.setPointerCapture(e.pointerId);
  });
  cv.addEventListener('pointermove', (e) => {
    if (!depart) return;
    const k = PLANCHE.w / cv.getBoundingClientRect().width;
    const dx = Math.round((e.clientX - depart.x) * k);
    const dy = Math.round((e.clientY - depart.y) * k);
    if (!dx && !dy) return;
    depart.x += dx / k;
    depart.y += dy / k;
    onDrag(dx, dy);
  });
  cv.addEventListener('pointerup', () => {
    depart = null;
  });
  paint();
  return { canvas: cv, paint };
}
