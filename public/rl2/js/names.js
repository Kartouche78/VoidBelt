// Pseudos flottant au-dessus des voitures, et bulles du tchat rapide.
//
// Les etiquettes ne sont pas accrochees aux groupes des voitures : elles
// tourneraient avec elles et se liraient a l'envers des qu'un joueur fait
// demi-tour. Elles vivent donc a part, replacees a chaque image au-dessus
// de leur proprietaire, toujours droites.

import * as THREE from '../vendor/three.module.js';

/** Hauteur du texte en unites du terrain, et recul au-dessus du toit. */
const SIZE = 21;
const LIFT = 30;
/** Au-dela, le pseudo est coupe : a dix joueurs l'ecran se remplit vite. */
const MAX_CHARS = 12;
/** Bulle du tchat, en unites du terrain : elle se glisse entre le toit et
 *  le pseudo, qui remonte d'autant tant qu'elle est la. */
const BULLE = 28;
/** Duree de vie d'une bulle et de son fondu de sortie, en secondes. */
const VIE = 2;
const FONDU = 0.4;
const FONT = '"Space Mono", ui-monospace, monospace';

/** Dessine un pseudo sur un canevas : contour sombre pour rester lisible
 *  aussi bien sur le beton clair que sur la pelouse sombre. */
function draw(text, color) {
  const px = 44;
  const c = document.createElement('canvas');
  let g = c.getContext('2d');
  g.font = `700 ${px}px ${FONT}`;
  const w = Math.ceil(g.measureText(text).width);
  // Redimensionner remet le contexte a zero : la police se repose apres.
  c.width = w + 24;
  c.height = px + 20;
  g = c.getContext('2d');
  g.font = `700 ${px}px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = 8;
  g.strokeStyle = 'rgba(4, 6, 10, 0.9)';
  g.strokeText(text, c.width / 2, c.height / 2);
  g.fillStyle = color;
  g.fillText(text, c.width / 2, c.height / 2);
  return c;
}

/** Dessine une bulle de tchat : fond sombre liseré aux couleurs de
 *  l'equipe, et une pointe tournee vers la voiture qui parle. */
function bubble(text, color) {
  const px = 36;
  const pointe = 12;
  const bord = 3;
  const c = document.createElement('canvas');
  let g = c.getContext('2d');
  g.font = `700 ${px}px ${FONT}`;
  const w = Math.ceil(g.measureText(text).width) + 40;
  const h = px + 22;
  c.width = w + bord * 2;
  c.height = h + pointe + bord * 2;
  g = c.getContext('2d');
  const mid = c.width / 2;
  const bas = bord + h;
  const r = 14;
  g.beginPath();
  g.moveTo(bord + r, bord);
  g.arcTo(bord + w, bord, bord + w, bas, r);
  g.arcTo(bord + w, bas, bord, bas, r);
  g.lineTo(mid + pointe, bas);
  g.lineTo(mid, bas + pointe);
  g.lineTo(mid - pointe, bas);
  g.arcTo(bord, bas, bord, bord, r);
  g.arcTo(bord, bord, bord + w, bord, r);
  g.closePath();
  g.fillStyle = 'rgba(7, 11, 18, 0.9)';
  g.fill();
  g.lineWidth = bord;
  g.strokeStyle = color;
  g.stroke();
  g.font = `700 ${px}px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#f4efe6';
  g.fillText(text, mid, bord + h / 2 + 1);
  return c;
}

/** Plan texture a la hauteur voulue, largeur au rapport du canevas. */
function label(canvas, height, z) {
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(height * (canvas.width / canvas.height), height),
    new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false }),
  );
  mesh.position.z = z;
  mesh.visible = false;
  return mesh;
}

function drop(scene, mesh) {
  scene.remove(mesh);
  mesh.material.map.dispose();
  mesh.material.dispose();
  mesh.geometry.dispose();
}

export class Names {
  constructor(scene, z, colors) {
    this.scene = scene;
    this.z = z;
    this.colors = colors;
    this.tags = [];
    this.bulles = [];
  }

  /** `list` donne un `{ name, team }` par voiture, dans l'ordre des sieges. */
  set(list) {
    this.list = list;
    for (let i = 0; i < list.length; i += 1) {
      const { name, team } = list[i];
      const text = String(name || '').slice(0, MAX_CHARS);
      const tag = this.tags[i];
      if (tag && tag.text === text && tag.team === team) continue;
      if (tag) drop(this.scene, tag.mesh);
      if (!text) {
        this.tags[i] = null;
        continue;
      }
      const mesh = label(draw(text, this.colors[team & 1]), SIZE, this.z);
      this.scene.add(mesh);
      this.tags[i] = { mesh, text, team };
    }
    // Les sieges disparus emportent leur etiquette, et leur bulle.
    for (let i = list.length; i < this.tags.length; i += 1) {
      if (this.tags[i]) drop(this.scene, this.tags[i].mesh);
      this.tags[i] = null;
      this._pop(i);
    }
    this.tags.length = list.length;
  }

  /** Pose un message du tchat au-dessus de la voiture `i`. Un nouveau
   *  message remplace le precedent : une seule bulle par voiture. */
  say(i, text) {
    this._pop(i);
    const team = this.list?.[i]?.team ?? i % 2;
    const mesh = label(bubble(text, this.colors[team & 1]), BULLE, this.z);
    this.scene.add(mesh);
    this.bulles[i] = { mesh, fin: performance.now() / 1000 + VIE };
  }

  /** Retire toutes les bulles : un nouveau match repart sans conversation. */
  hush() {
    for (let i = 0; i < this.bulles.length; i += 1) this._pop(i);
  }

  _pop(i) {
    if (this.bulles[i]) drop(this.scene, this.bulles[i].mesh);
    this.bulles[i] = null;
  }

  /** Pose l'etiquette `i` au-dessus de sa voiture, en coordonnees three,
   *  avec sa bulle entre les deux quand elle en a une. */
  place(i, x, y, visible) {
    let lift = LIFT;
    const b = this.bulles[i];
    if (b) {
      const reste = b.fin - performance.now() / 1000;
      if (reste <= 0) {
        this._pop(i);
      } else {
        b.mesh.visible = visible;
        b.mesh.material.opacity = Math.min(1, reste / FONDU);
        b.mesh.position.set(x, y + LIFT - SIZE / 2 + BULLE / 2, this.z);
        lift += BULLE;
      }
    }
    const tag = this.tags[i];
    if (!tag) return;
    tag.mesh.visible = visible;
    if (visible) tag.mesh.position.set(x, y + lift, this.z);
  }

  hideAll() {
    for (const tag of this.tags) if (tag) tag.mesh.visible = false;
    for (const b of this.bulles) if (b) b.mesh.visible = false;
  }
}
