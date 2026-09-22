// F4 : calage du contour sur la planche du stade.
//
// En calage, la planche se pose telle quelle au centre du cadre et n'en
// bouge plus. C'est le contour violet qu'on promene dessus, jusqu'a ce
// qu'il epouse le muret peint. Le rectangle obtenu, en pixels de planche,
// est exactement `fit` : les quatre nombres qu'attend `stadiums.js`.
//
// Une fois le calage referme, le jeu refait l'inverse — il recale la
// planche sur l'enceinte du moteur — et le contour retombe sur le muret.
//
//   fleches        deplacer le contour        (Maj : par dix)
//   A / D          moins / plus large
//   W / S          moins / plus haut
//   Q / E          arrondi des coins
//   R              revenir aux valeurs du fichier
//   C              copier la ligne a recopier dans `stadiums.js`

import { REV, saveOverride, stadiumById } from './stadiums.js';

const PAS = 1;
const PAS_RAPIDE = 10;

/** Geste demande par une touche, en pixels de planche. */
function move(key, step) {
  switch (key) {
    case 'ArrowLeft': return { dx: -step };
    case 'ArrowRight': return { dx: step };
    case 'ArrowUp': return { dy: -step };
    case 'ArrowDown': return { dy: step };
    case 'a': return { dw: -step };
    case 'd': return { dw: step };
    case 'w': return { dh: -step };
    case 's': return { dh: step };
    case 'q': return { dc: -step };
    case 'e': return { dc: step };
    default: return null;
  }
}

export class FitEdit {
  /** `apply(id, editing)` repose le decor : brut et centre en calage,
   *  recale sur l'enceinte une fois le calage referme. */
  constructor(apply) {
    this.apply = apply;
    this.on = false;
    this.id = null;
    this.panel = document.getElementById('fit-panel');
  }

  /** Entre ou sort du mode, sur le stade en cours. `geom` vient du moteur :
   *  l'enceinte est a lui, on ne la recopie pas ici. */
  toggle(id, geom) {
    this.on = !this.on;
    this.id = id;
    this.geom = geom;
    if (this.on) {
      const s = stadiumById(id);
      this.fit = [...s.fit];
      this.corner = s.corner;
      this.name = s.name;
    }
    this.apply(id, this.on);
    this._paint();
    return this.on;
  }

  /** Cadre a tracer sur la planche : le contour tel qu'on le regle.
   *  L'arrondi est un cercle dans le repere du jeu, donc une ellipse sur
   *  la planche des que les deux echelles different. */
  frame(geom) {
    if (!this.on) return null;
    this.geom = geom;
    const [minX, maxX, minY, maxY] = this.fit;
    const kx = (maxX - minX) / (geom.maxX - geom.minX);
    const ky = (maxY - minY) / (geom.maxY - geom.minY);
    return {
      minX, maxX, minY, maxY,
      rx: this.corner * kx,
      ry: this.corner * ky,
      goalHalf: geom.goalHalf * ky,
      goalFront: geom.goalFront * kx,
      goalDepth: geom.goalDepth * kx,
    };
  }

  /** Traite une touche. Renvoie `true` si elle a ete consommee. */
  key(e) {
    if (!this.on) return false;
    const step = e.shiftKey ? PAS_RAPIDE : PAS;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;

    if (k === 'r') {
      saveOverride(this.id, null);
      const s = stadiumById(this.id);
      this.fit = [...s.fit];
      this.corner = s.corner;
      this._push();
      return true;
    }
    if (k === 'c') {
      this._copy();
      return true;
    }
    const m = move(k, step);
    if (!m) return false;

    // Le contour se lit [gauche, droite, haut, bas] : le deplacer decale
    // les deux bords du meme cote, l'elargir les ecarte.
    const [l, r, t, b] = this.fit;
    const dx = m.dx || 0;
    const dy = m.dy || 0;
    const dw = (m.dw || 0) / 2;
    const dh = (m.dh || 0) / 2;
    this.fit = [l + dx - dw, r + dx + dw, t + dy - dh, b + dy + dh];
    this.corner = Math.max(0, this.corner + (m.dc || 0));
    this._push();
    return true;
  }

  _push() {
    saveOverride(this.id, {
      fit: this.fit.map((v) => Math.round(v)),
      corner: Math.round(this.corner),
    });
    this.apply(this.id, true);
    this._paint();
  }

  /** Ligne prete a etre collee dans `stadiums.js`, ou envoyee telle quelle. */
  line() {
    const [l, r, t, b] = this.fit.map((v) => Math.round(v));
    return `${this.id}: fit: [${l}, ${r}, ${t}, ${b}], corner: ${Math.round(this.corner)},`;
  }

  async _copy() {
    try {
      await navigator.clipboard.writeText(this.line());
      this.copied = 'copie !';
    } catch {
      // Presse-papier refuse (page non securisee, permission) : les chiffres
      // sont a l'ecran, la capture suffit.
      this.copied = 'copie refusee — la capture suffit';
    }
    this._paint();
    setTimeout(() => {
      this.copied = '';
      this._paint();
    }, 2000);
  }

  _paint() {
    const p = this.panel;
    if (!p) return;
    p.hidden = !this.on;
    if (!this.on) return;
    const [l, r, t, b] = this.fit.map((v) => Math.round(v));
    const ratio = ((r - l) / (b - t)).toFixed(3);
    const g = this.geom;
    const cible = g ? ((g.maxX - g.minX) / (g.maxY - g.minY)).toFixed(3) : '?';
    p.innerHTML = '';
    const add = (cls, text) => {
      const el = document.createElement('div');
      el.className = cls;
      el.textContent = text;
      p.append(el);
    };
    add('fit-title', `Calage · ${this.name} · rev ${REV}`);
    add('fit-values', `fit: [${l}, ${r}, ${t}, ${b}]  corner: ${Math.round(this.corner)}`);
    add('fit-note', `rapport ${ratio} (cible ${cible})`);
    add('fit-keys', 'fleches deplacer · A/D largeur · W/S hauteur · Q/E coins');
    add('fit-keys', 'Maj = par dix · R remise a zero · C copier');
    if (this.copied) add('fit-copied', this.copied);
  }
}
