// Pseudos flottant au-dessus des voitures.
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

/** Dessine un pseudo sur un canevas : contour sombre pour rester lisible
 *  aussi bien sur le beton clair que sur la pelouse sombre. */
function draw(text, color) {
  const px = 44;
  const c = document.createElement('canvas');
  let g = c.getContext('2d');
  g.font = `700 ${px}px "Space Mono", ui-monospace, monospace`;
  const w = Math.ceil(g.measureText(text).width);
  // Redimensionner remet le contexte a zero : la police se repose apres.
  c.width = w + 24;
  c.height = px + 20;
  g = c.getContext('2d');
  g.font = `700 ${px}px "Space Mono", ui-monospace, monospace`;
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

export class Names {
  constructor(scene, z, colors) {
    this.scene = scene;
    this.z = z;
    this.colors = colors;
    this.tags = [];
  }

  /** `list` donne un `{ name, team }` par voiture, dans l'ordre des sieges. */
  set(list) {
    for (let i = 0; i < list.length; i += 1) {
      const { name, team } = list[i];
      const text = String(name || '').slice(0, MAX_CHARS);
      const tag = this.tags[i];
      if (tag && tag.text === text && tag.team === team) continue;
      if (tag) {
        this.scene.remove(tag.mesh);
        tag.mesh.material.map.dispose();
        tag.mesh.material.dispose();
        tag.mesh.geometry.dispose();
      }
      if (!text) {
        this.tags[i] = null;
        continue;
      }
      const canvas = draw(text, this.colors[team & 1]);
      const map = new THREE.CanvasTexture(canvas);
      map.colorSpace = THREE.SRGBColorSpace;
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(SIZE * (canvas.width / canvas.height), SIZE),
        new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false }),
      );
      mesh.position.z = this.z;
      mesh.visible = false;
      this.scene.add(mesh);
      this.tags[i] = { mesh, text, team };
    }
    // Les sieges disparus emportent leur etiquette.
    for (let i = list.length; i < this.tags.length; i += 1) {
      const tag = this.tags[i];
      if (!tag) continue;
      this.scene.remove(tag.mesh);
      tag.mesh.material.map.dispose();
      tag.mesh.material.dispose();
      tag.mesh.geometry.dispose();
      this.tags[i] = null;
    }
    this.tags.length = list.length;
  }

  /** Pose l'etiquette `i` au-dessus de sa voiture, en coordonnees three. */
  place(i, x, y, visible) {
    const tag = this.tags[i];
    if (!tag) return;
    tag.mesh.visible = visible;
    if (visible) tag.mesh.position.set(x, y + LIFT, this.z);
  }

  hideAll() {
    for (const tag of this.tags) if (tag) tag.mesh.visible = false;
  }
}
