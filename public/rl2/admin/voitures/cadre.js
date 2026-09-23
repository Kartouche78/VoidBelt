// Apercu d'une voiture generee avec sa hitbox, et son calage.
//
// Dans le jeu, le sprite entier est etire sur le rectangle de collision de
// la voiture. Caler, c'est donc choisir quel rectangle de l'image generee
// deviendra ce sprite : le « cadre ». A l'acceptation, l'image est recadree
// dessus. Le trace montre, aux proportions du moteur :
//   violet    le cadre, etire sur le rectangle ou rebondit la balle ;
//   jaune     le disque qui touche les murs ;
//   jaune pointille  le disque qui touche les autres voitures.

import { SPRITE } from './exemples.js';

const VIOLET = '#c77dff';
const JAUNE = '#ffd23f';
const GRIS = 'rgba(255,255,255,0.28)';
/** Demi-gabarit et rayons du moteur : `car.rs` (HALF_LEN, HALF_WID,
 *  RADIUS pour les murs) et `collide.rs` (CAR_R entre voitures). */
const DEMI_LONG = 15.99;
const DEMI_LARGE = 11.41;
const MURS = 13.7;
const VOITURES = 12.4;

export const cadreParDefaut = () => [0, SPRITE.w, 0, SPRITE.h];

/** Gestes de calage, en pixels de l'image (Maj : par dix). */
export const GESTES = [
  ['Déplacer', [['←', { dx: -1 }], ['→', { dx: 1 }], ['↑', { dy: -1 }], ['↓', { dy: 1 }]]],
  ['Largeur', [['−', { dw: -2 }], ['+', { dw: 2 }]]],
  ['Longueur', [['−', { dh: -2 }], ['+', { dh: 2 }]]],
];

const TOUCHES = {
  ArrowLeft: { dx: -1 }, ArrowRight: { dx: 1 }, ArrowUp: { dy: -1 }, ArrowDown: { dy: 1 },
  a: { dw: -2 }, d: { dw: 2 }, w: { dh: 2 }, s: { dh: -2 },
};

export function gesteDe(e) {
  return TOUCHES[e.key.length === 1 ? e.key.toLowerCase() : e.key] || null;
}

/** Applique un geste au cadre `c` ([l, r, t, b]), `n` fois. */
export function applique(c, m, n = 1) {
  const dx = (m.dx || 0) * n;
  const dy = (m.dy || 0) * n;
  const dw = ((m.dw || 0) * n) / 2;
  const dh = ((m.dh || 0) * n) / 2;
  const [l, r, t, b] = c;
  const nouveau = [l + dx - dw, r + dx + dw, t + dy - dh, b + dy + dh];
  // Un cadre retourne ou minuscule n'a plus de sens.
  if (nouveau[1] - nouveau[0] < 32 || nouveau[3] - nouveau[2] < 32) return;
  c.splice(0, 4, ...nouveau);
}

export function resume(c) {
  const [l, r, t, b] = c.map(Math.round);
  return `cadre [${l}, ${r}, ${t}, ${b}] · ${r - l} × ${b - t} px`;
}

/** Canevas d'apercu : fond en damier (la transparence se voit), l'image
 *  que rend `source()` (la generee, ou sa version recoloree), puis le
 *  cadre. `onDrag(dx, dy)` recoit les glissements, en pixels de l'image. */
export function apercu(source, cadre, onDrag) {
  const cv = document.createElement('canvas');
  cv.width = SPRITE.w;
  cv.height = SPRITE.h;
  cv.className = 'sprite';
  cv.tabIndex = 0;
  const paint = () => {
    const g = cv.getContext('2d');
    const pas = 64;
    for (let y = 0; y < cv.height; y += pas) {
      for (let x = 0; x < cv.width; x += pas) {
        g.fillStyle = (x / pas + y / pas) % 2 ? '#1a2230' : '#121925';
        g.fillRect(x, y, pas, pas);
      }
    }
    const img = source();
    if (img) g.drawImage(img, 0, 0, cv.width, cv.height);
    const [l, r, t, b] = cadre();
    g.save();
    // Silhouette maximale de l'exemple : l'image entiere.
    g.setLineDash([14, 10]);
    g.lineWidth = 3;
    g.strokeStyle = GRIS;
    g.strokeRect(2, 2, cv.width - 4, cv.height - 4);
    g.setLineDash([]);
    g.lineWidth = 5;
    g.strokeStyle = VIOLET;
    g.strokeRect(l, t, r - l, b - t);
    g.strokeStyle = JAUNE;
    const disque = (rayon) => {
      g.beginPath();
      g.ellipse((l + r) / 2, (t + b) / 2, ((r - l) / 2) * (rayon / DEMI_LARGE), ((b - t) / 2) * (rayon / DEMI_LONG), 0, 0, Math.PI * 2);
      g.stroke();
    };
    disque(MURS);
    g.setLineDash([18, 12]);
    disque(VOITURES);
    g.setLineDash([]);
    g.restore();
  };
  let depart = null;
  cv.addEventListener('pointerdown', (e) => {
    depart = { x: e.clientX, y: e.clientY };
    cv.setPointerCapture(e.pointerId);
  });
  cv.addEventListener('pointermove', (e) => {
    if (!depart) return;
    const k = SPRITE.w / cv.getBoundingClientRect().width;
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

/** Recadre l'image sur le cadre, au format des sprites, fond transparent ;
 *  rend le sprite et sa miniature en PNG. */
export function versSprite(img, cadre) {
  const [l, r, t, b] = cadre;
  const kx = (img.naturalWidth || img.width) / SPRITE.w;
  const ky = (img.naturalHeight || img.height) / SPRITE.h;
  const sprite = document.createElement('canvas');
  sprite.width = SPRITE.w;
  sprite.height = SPRITE.h;
  sprite.getContext('2d').drawImage(img, l * kx, t * ky, (r - l) * kx, (b - t) * ky, 0, 0, SPRITE.w, SPRITE.h);
  const mini = document.createElement('canvas');
  mini.width = 256;
  mini.height = 384;
  mini.getContext('2d').drawImage(sprite, 0, 0, mini.width, mini.height);
  return { sprite: sprite.toDataURL('image/png'), mini: mini.toDataURL('image/png') };
}
