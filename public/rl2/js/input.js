// Lecture des commandes : manette d'abord, clavier en secours.
//
// Une meme image peut melanger les deux sources ; on garde a chaque fois la
// valeur la plus franche, pour qu'un pouce sur le stick l'emporte sur une
// touche restee enfoncee et inversement.

import { keyLabel, padLabel } from './settings.js';

const NEUTRAL = { throttle: 0, brake: 0, steer: 0, boost: false, drift: false };

/** Navigation des menus : premier pas immediat, puis repetition. */
const NAV_DELAY = 420;
const NAV_RATE = 150;
/** Boutons de la croix directionnelle, en mapping standard. */
const DPAD = { up: 12, down: 13, left: 14, right: 15 };
/** A valide, B revient en arriere. Aucun des deux n'est utilise en course. */
const NAV_OK = 0;
const NAV_BACK = 1;

export class Input {
  constructor(settings) {
    this.settings = settings;
    this.keys = new Set();
    // Appuis survenus depuis la derniere lecture : un tapotement plus court
    // qu'une image serait sinon perdu entre le `keydown` et le `keyup`.
    this.tapped = new Set();
    this.padIndex = null;
    this.capture = null;
    this.prevPause = false;
    this.onPause = null;
    this.onPadChange = null;
    this._prevButtons = [];
    this._nav = { x: { dir: 0, next: 0 }, y: { dir: 0, next: 0 }, ok: false, back: false };

    this._down = (e) => {
      if (e.repeat) return;
      if (this.capture) {
        e.preventDefault();
        const done = this.capture;
        this.capture = null;
        done({ source: 'keys', code: e.code, label: keyLabel(e.code) });
        return;
      }
      // Fleches et espace font defiler la page, Tab change de bouton : on
      // les retient, sinon le jeu perd le focus en montrant les scores.
      if (e.code.startsWith('Arrow') || e.code === 'Space' || e.code === 'Tab') {
        e.preventDefault();
      }
      this.keys.add(e.code);
      this.tapped.add(e.code);
    };
    this._up = (e) => this.keys.delete(e.code);
    this._blur = () => {
      this.keys.clear();
      this.tapped.clear();
    };

    addEventListener('keydown', this._down);
    addEventListener('keyup', this._up);
    addEventListener('blur', this._blur);
    addEventListener('gamepadconnected', (e) => {
      this.padIndex = e.gamepad.index;
      this.onPadChange?.(e.gamepad.id);
    });
    addEventListener('gamepaddisconnected', () => {
      this.padIndex = null;
      this.onPadChange?.(null);
    });
  }

  dispose() {
    removeEventListener('keydown', this._down);
    removeEventListener('keyup', this._up);
    removeEventListener('blur', this._blur);
  }

  pad() {
    // Certains navigateurs refusent l'appel avant tout geste, ou sur une
    // page non securisee : on ne laisse pas cette API faire tomber l'image.
    let list = [];
    try {
      list = navigator.getGamepads ? navigator.getGamepads() : [];
    } catch {
      return null;
    }
    if (this.padIndex !== null && list[this.padIndex]) return list[this.padIndex];
    for (const g of list) if (g && g.connected) return g;
    return null;
  }

  /** Attend la prochaine entree pour reassigner une action. */
  listen(done) {
    // On releve l'etat courant des boutons : celui qu'on tient encore pour
    // avoir ouvert la reassignation ne doit pas s'assigner lui-meme.
    const gp = this.pad();
    this._prevButtons = gp ? [...gp.buttons].map((b) => !!b.pressed) : [];
    this.capture = done;
  }

  cancelListen() {
    this.capture = null;
  }

  _analog(bind, gp) {
    if (!gp || !bind) return 0;
    if (bind.kind === 'axis') return Math.abs(gp.axes[bind.index] ?? 0);
    const b = gp.buttons[bind.index];
    if (!b) return 0;
    return typeof b.value === 'number' ? b.value : b.pressed ? 1 : 0;
  }

  _pressed(bind, gp) {
    if (!gp || !bind) return false;
    if (bind.kind === 'axis') return Math.abs(gp.axes[bind.index] ?? 0) > 0.6;
    return !!gp.buttons[bind.index]?.pressed;
  }

  /** Commandes de l'image courante, dans le format attendu par le moteur. */
  read() {
    const gp = this.pad();
    if (this.capture && gp) this._captureFromPad(gp);

    const { keys, pad, deadzone } = this.settings;
    const dz = (deadzone ?? 15) / 100;
    const out = { ...NEUTRAL };

    out.throttle = Math.max(this.keys.has(keys.accel) ? 1 : 0, this._analog(pad.accel, gp));
    out.brake = Math.max(this.keys.has(keys.brake) ? 1 : 0, this._analog(pad.brake, gp));

    let steer = (this.keys.has(keys.right) ? 1 : 0) - (this.keys.has(keys.left) ? 1 : 0);
    if (gp && pad.steer) {
      const raw = pad.steer.kind === 'axis'
        ? (gp.axes[pad.steer.index] ?? 0)
        : (gp.buttons[pad.steer.index]?.value ?? 0);
      // Zone morte remise a l'echelle : pas de marche au sortir du neutre.
      const a = Math.abs(raw);
      const scaled = a < dz ? 0 : Math.sign(raw) * ((a - dz) / (1 - dz));
      if (Math.abs(scaled) > Math.abs(steer)) steer = scaled;
    }
    out.steer = Math.max(-1, Math.min(1, steer));

    out.boost = this.keys.has(keys.boost) || this._pressed(pad.boost, gp);
    out.drift = this.keys.has(keys.drift) || this._pressed(pad.drift, gp);

    const held = this._pressed(pad.pause, gp) || this.keys.has(keys.pause);
    if ((held && !this.prevPause) || this.tapped.has(keys.pause)) this.onPause?.();
    this.prevPause = held;
    this.tapped.clear();

    // Le tableau des scores se tient enfonce, comme dans Rocket League :
    // c'est un etat, pas une bascule.
    out.scores = this.keys.has(keys.scores) || this._pressed(pad.scores, gp);

    return out;
  }

  /** Une direction maintenue avance d'un cran, puis se repete. */
  _repeat(key, dir, now) {
    const s = this._nav[key];
    if (dir === 0) {
      s.dir = 0;
      return 0;
    }
    if (s.dir !== dir) {
      s.dir = dir;
      s.next = now + NAV_DELAY;
      return dir;
    }
    if (now >= s.next) {
      s.next = now + NAV_RATE;
      return dir;
    }
    return 0;
  }

  /** Impulsions de navigation dans les menus, manette et fleches confondues.
   *  Renvoie `null` pendant une reassignation, pour ne pas valider le bouton
   *  qu'on est justement en train d'assigner. */
  menuPulse() {
    const gp = this.pad();
    if (this.capture) {
      // On suit quand meme l'etat des deux boutons : sinon celui qu'on vient
      // d'assigner passerait pour un nouvel appui a la sortie de la capture,
      // et relancerait aussitot la reassignation.
      this._nav.ok = !!gp?.buttons[NAV_OK]?.pressed;
      this._nav.back = !!gp?.buttons[NAV_BACK]?.pressed;
      return null;
    }
    const held = (i) => !!gp?.buttons[i]?.pressed;
    const axis = (i) => {
      const v = gp?.axes[i] ?? 0;
      return Math.abs(v) > 0.55 ? Math.sign(v) : 0;
    };
    const keys = this.keys;
    const dx = (held(DPAD.right) || keys.has('ArrowRight') ? 1 : 0)
      - (held(DPAD.left) || keys.has('ArrowLeft') ? 1 : 0);
    const dy = (held(DPAD.down) || keys.has('ArrowDown') ? 1 : 0)
      - (held(DPAD.up) || keys.has('ArrowUp') ? 1 : 0);
    const ok = held(NAV_OK);
    const back = held(NAV_BACK);
    const now = performance.now();
    const pulse = {
      x: this._repeat('x', dx || axis(0), now),
      y: this._repeat('y', dy || axis(1), now),
      ok: ok && !this._nav.ok,
      back: back && !this._nav.back,
    };
    this._nav.ok = ok;
    this._nav.back = back;
    return pulse;
  }

  /** Detecte le bouton ou l'axe pousse pendant une reassignation manette. */
  _captureFromPad(gp) {
    for (let i = 0; i < gp.buttons.length; i += 1) {
      const now = !!gp.buttons[i]?.pressed;
      if (now && !this._prevButtons[i]) {
        const done = this.capture;
        this.capture = null;
        this._prevButtons = gp.buttons.map((b) => !!b.pressed);
        const bind = { kind: 'button', index: i };
        done({ source: 'pad', bind, label: padLabel(bind) });
        return;
      }
    }
    this._prevButtons = gp.buttons.map((b) => !!b.pressed);
    for (let i = 0; i < gp.axes.length; i += 1) {
      if (Math.abs(gp.axes[i]) > 0.7) {
        const done = this.capture;
        this.capture = null;
        const bind = { kind: 'axis', index: i };
        done({ source: 'pad', bind, label: padLabel(bind) });
        return;
      }
    }
  }
}
