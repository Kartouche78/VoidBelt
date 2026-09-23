// F6 : calage de la hitbox des cages sur celles peintes dans le stade.
//
// La planche reste a sa place de jeu : c'est le trace jaune du moteur —
// joues, fond du filet, poteaux arrondis — qu'on ajuste jusqu'a ce qu'il
// epouse la cage dessinee. Les trois nombres obtenus sont en unites de jeu
// et partent tels quels dans les reglages `goal_half`, `goal_depth` et
// `post_r` : la balle rebondit sur ce qu'on voit, pas sur une approximation.
//
//   W / S          ouverture du but            (Maj : par dix)
//   A / D          profondeur du filet
//   Q / E          rayon des poteaux
//   R              revenir aux valeurs du fichier
//   C              copier la ligne a recopier dans `stadiums.js`

import { REV, clearOverride, saveOverride, stadiumById } from './stadiums.js';

const PAS = 1;
const PAS_RAPIDE = 10;

/** Geste demande par une touche, en unites de jeu. */
function move(key, step) {
  switch (key) {
    case 'w': return { half: step };
    case 's': return { half: -step };
    case 'a': return { depth: -step };
    case 'd': return { depth: step };
    case 'q': return { post: -step };
    case 'e': return { post: step };
    default: return null;
  }
}

export class CageEdit {
  /** `cageOf(stade)` donne la cage en vigueur d'un stade, celle du fichier
   *  ou celle de base ; `apply(id)` la repose dans le moteur. */
  constructor(cageOf, apply) {
    this.cageOf = cageOf;
    this.apply = apply;
    this.on = false;
    this.id = null;
    // Meme panneau que F4 : les deux modes ne s'ouvrent jamais ensemble.
    this.panel = document.getElementById('fit-panel');
  }

  toggle(id) {
    this.on = !this.on;
    this.id = id;
    if (this.on) this._load();
    this._paint();
    return this.on;
  }

  _load() {
    const s = stadiumById(this.id);
    this.cage = { ...this.cageOf(s) };
    this.name = s.name;
  }

  /** Traite une touche. Renvoie `true` si elle a ete consommee. */
  key(e) {
    if (!this.on) return false;
    const step = e.shiftKey ? PAS_RAPIDE : PAS;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;

    if (k === 'r') {
      clearOverride(this.id, ['goal']);
      this._load();
      this.apply(this.id);
      this._paint();
      return true;
    }
    if (k === 'c') {
      this._copy();
      return true;
    }
    const m = move(k, step);
    if (!m) return false;

    // Le moteur borne lui aussi ; on s'arrete ici aux memes limites pour
    // que les chiffres affiches soient ceux qui s'appliquent.
    const c = this.cage;
    c.half = Math.min(200, Math.max(30, c.half + (m.half || 0)));
    c.depth = Math.min(150, Math.max(15, c.depth + (m.depth || 0)));
    c.post = Math.min(40, Math.max(0, c.post + (m.post || 0)));
    saveOverride(this.id, { goal: this._rounded() });
    this.apply(this.id);
    this._paint();
    return true;
  }

  _rounded() {
    const { half, depth, post } = this.cage;
    return { half: Math.round(half), depth: Math.round(depth), post: Math.round(post) };
  }

  /** Ligne prete a etre collee dans l'entree du stade. */
  line() {
    const { half, depth, post } = this._rounded();
    return `${this.id}: goal: { half: ${half}, depth: ${depth}, post: ${post} },`;
  }

  async _copy() {
    try {
      await navigator.clipboard.writeText(this.line());
      this.copied = 'copie !';
    } catch {
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
    const { half, depth, post } = this._rounded();
    p.innerHTML = '';
    const add = (cls, text) => {
      const el = document.createElement('div');
      el.className = cls;
      el.textContent = text;
      p.append(el);
    };
    add('fit-title', `Cages · ${this.name} · rev ${REV}`);
    add('fit-values', `ouverture ${half * 2}  filet ${depth}  poteaux ${post}`);
    add('fit-note', `goal: { half: ${half}, depth: ${depth}, post: ${post} }`);
    add('fit-keys', 'W/S ouverture · A/D profondeur · Q/E poteaux');
    add('fit-keys', 'Maj = par dix · R remise a zero · C copier');
    if (this.copied) add('fit-copied', this.copied);
  }
}
