// Clavier, souris et manette, selon la config de `commandes.js`.
//
// Touches physiques (`e.code`) : WASD tombe sur ZQSD en AZERTY. Dans le
// moteur, un braquage positif tourne a droite (x = droite de la piste), donc
// aucune inversion ici : droite = +1.
//
// Les menus gardent des touches fixes, quelle que soit la config : fleches
// (et ZQSD), Entree, Echap, Tab ; croix, stick, A, B, Start, LB/RB.

import { charger } from './commandes.js';

const NAV = {
  ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
};
/** Actions a l'appui : action de la config -> action du jeu. */
const DECLIC = { checkpoint: 'respawn', recommencer: 'restart', son: 'mute', vue: 'vue' };
const MENU_PAD = [[0, 'confirm'], [1, 'back'], [9, 'menu'], [4, 'tabprev'], [5, 'tabnext'],
  [12, 'up'], [13, 'down'], [14, 'left'], [15, 'right']];

export class Input {
  constructor() {
    this.keys = new Set();
    this.onAction = () => {};
    this.padPrev = [];
    this.stickPrev = '';
    this.rumbleOn = true;
    /** Ecoute d'une touche a poser : `{ cote, cb, prev }`, ou null. */
    this.capture = null;
    this.setConfig(charger());

    addEventListener('keydown', (e) => this.keyDown(e));
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    addEventListener('mousedown', (e) => {
      const code = `Souris${e.button}`;
      if (this.capture?.cote === 'clavier') {
        e.preventDefault();
        this.endCapture(code);
        return;
      }
      if (this.bound.has(code)) this.press(code);
    });
    addEventListener('mouseup', (e) => this.keys.delete(`Souris${e.button}`));
    // le clic droit peut servir en course : pas de menu contextuel
    addEventListener('contextmenu', (e) => e.preventDefault());
  }

  setConfig(c) {
    this.config = c;
    this.bound = new Set(Object.values(c.clavier).flat().filter((k) => k != null));
  }

  /** Une touche du clavier ou de la souris enfoncee. */
  press(code) {
    this.keys.add(code);
    for (const [act, jeu] of Object.entries(DECLIC)) {
      if (this.config.clavier[act].includes(code)) this.onAction(jeu);
    }
  }

  keyDown(e) {
    if (this.capture) {
      e.preventDefault();
      if (e.repeat) return;
      if (e.code === 'Escape') this.endCapture(null);
      else if (this.capture.cote === 'clavier') this.endCapture(e.code);
      return;
    }
    if (this.bound.has(e.code) || NAV[e.code] || e.code === 'Tab') e.preventDefault();
    if (e.repeat) return;
    this.press(e.code);
    if (e.code === 'Enter') this.onAction('confirm');
    if (e.code === 'Escape') this.onAction('menu');
    if (e.code === 'Tab') this.onAction(e.shiftKey ? 'tabprev' : 'tabnext');
    // navigation des menus (le jeu ignore ces actions en course)
    const nav = NAV[e.code];
    if (nav) this.onAction(nav);
  }

  /** Attend la prochaine touche (`cote` = 'clavier') ou le prochain bouton
   *  de manette ('manette'). `cb(code)` ; `cb(null)` si Echap. */
  capturer(cote, cb) {
    const p = this.pad();
    this.capture = { cote, cb, prev: p ? p.buttons.map((b) => b.pressed) : [] };
  }

  endCapture(code) {
    const cb = this.capture.cb;
    this.capture = null;
    this.keys.clear();
    cb(code);
  }

  /** Une touche de l'action `act` est enfoncee. */
  held(act) {
    return this.config.clavier[act].some((k) => k != null && this.keys.has(k));
  }

  /** Premiere manette branchee, ou null. */
  pad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }

  /** Front montant d'un bouton de manette. */
  padPressed(p, i) {
    const now = !!(p.buttons[i] && p.buttons[i].pressed);
    const was = this.padPrev[i];
    this.padPrev[i] = now;
    return now && !was;
  }

  /** Bouton de manette en cours d'ecoute : premier bouton qui s'enfonce. */
  padCapture(p) {
    const c = this.capture;
    p.buttons.forEach((b, i) => {
      if (this.capture === c && c.cote === 'manette' && b.pressed && !c.prev[i]) this.endCapture(i);
      c.prev[i] = b.pressed;
    });
    // les menus ne doivent pas voir l'appui qui vient de servir
    this.padPrev = p.buttons.map((b) => b.pressed);
  }

  read() {
    const idle = { throttle: 0, brake: 0, steer: 0, handbrake: false, boost: false, lookBack: false };
    const p = this.pad();
    if (this.capture) {
      if (p) this.padCapture(p);
      return idle;
    }
    let throttle = this.held('gaz') ? 1 : 0;
    let brake = this.held('frein') ? 1 : 0;
    let steer = (this.held('droite') ? 1 : 0) - (this.held('gauche') ? 1 : 0);
    let handbrake = this.held('driftage');
    let boost = this.held('boost');
    let lookBack = this.held('arriere');

    if (p) {
      const m = this.config.manette;
      const b = (i) => (i != null && p.buttons[i] ? p.buttons[i].value : 0);
      const val = (act) => Math.max(...m[act].map(b));
      const sx = p.axes[0] || 0;
      // zone morte, puis courbe douce : les petites corrections au stick
      // restent fines, le plein braquage reste au bout
      if (Math.abs(sx) > 0.12) {
        const k = (Math.abs(sx) - 0.12) / 0.88;
        steer = Math.sign(sx) * (0.4 * k + 0.6 * k * k);
      }
      // boutons de direction : braquage plein, comme au clavier
      const dir = (val('droite') > 0.5 ? 1 : 0) - (val('gauche') > 0.5 ? 1 : 0);
      if (dir) steer = dir;
      throttle = Math.max(throttle, val('gaz'));
      brake = Math.max(brake, val('frein'));
      handbrake = handbrake || val('driftage') > 0.5;
      boost = boost || val('boost') > 0.5;
      lookBack = lookBack || val('arriere') > 0.5;

      // les fronts montants, une seule lecture par bouton et par image
      const fronts = new Set();
      p.buttons.forEach((_, i) => { if (this.padPressed(p, i)) fronts.add(i); });
      // A sert aussi a valider dans les menus (le jeu l'ignore en course)
      for (const [i, a] of MENU_PAD) if (fronts.has(i)) this.onAction(a);
      for (const [act, jeu] of Object.entries(DECLIC)) {
        if (m[act].some((i) => fronts.has(i))) this.onAction(jeu);
      }
      // le stick navigue aussi, une action par inclinaison franche
      const sy = p.axes[1] || 0;
      const nav = sy < -0.6 ? 'up' : sy > 0.6 ? 'down' : sx < -0.6 ? 'left' : sx > 0.6 ? 'right' : '';
      if (nav && nav !== this.stickPrev) this.onAction(nav);
      this.stickPrev = nav;
    }
    return { throttle, brake, steer, handbrake, boost, lookBack };
  }

  /** Vibration de la manette, si elle sait faire (`weak`/`strong` 0..1). */
  rumble(ms, weak, strong) {
    const p = this.pad();
    const act = this.rumbleOn && p && p.vibrationActuator;
    if (!act || !act.playEffect) return;
    act.playEffect('dual-rumble', {
      duration: ms, weakMagnitude: Math.min(1, weak), strongMagnitude: Math.min(1, strong),
    }).catch(() => {});
  }
}
