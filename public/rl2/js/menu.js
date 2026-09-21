// Menus : accueil, parametres, pause et ecran de fin.
//
// Les panneaux vivent deja dans le HTML ; ce module ne fait que les montrer,
// les remplir et propager les reglages modifies.

import { ACTIONS, DEFAULTS, keyLabel, padLabel, reset } from './settings.js';
import { listRooms } from './net.js';

const $ = (id) => document.getElementById(id);

const PHASE_FR = {
  warmup: 'echauffement',
  countdown: 'engagement',
  play: 'en match',
  goal: 'but',
  over: 'termine',
};

export class Menu {
  /** `hooks` : play, resume, restart, quit, change(settings). */
  constructor(settings, input, hooks) {
    this.settings = settings;
    this.input = input;
    this.hooks = hooks;
    this.screen = null;
    this.tab = 'controls';

    this.screens = {
      title: $('screen-title'),
      settings: $('screen-settings'),
      pause: $('screen-pause'),
      result: $('screen-result'),
      online: $('screen-online'),
    };

    this._wire();
    this.show('title');
  }

  get open() {
    return this.screen !== null;
  }

  show(name) {
    this.input.cancelListen();
    for (const [key, el] of Object.entries(this.screens)) el.hidden = key !== name;
    $('shell').classList.toggle('menu-open', name !== null);
    this.screen = name;
    if (name === 'settings') this.renderSettings();
    // Le premier element prend le focus : manette et clavier parcourent le
    // menu sans souris des l'ouverture.
    if (name) this._focus(this.items()[0]);
  }

  /** Elements atteignables au clavier ou a la manette, dans l'ordre du DOM. */
  items() {
    if (!this.screen) return [];
    const sel = 'button:not([disabled]), input:not([disabled])';
    return [...this.screens[this.screen].querySelectorAll(sel)];
  }

  _focus(el) {
    if (!el) return;
    for (const e of document.querySelectorAll('.pad-focus')) e.classList.remove('pad-focus');
    el.classList.add('pad-focus');
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'nearest' });
  }

  /** Rangee horizontale a laquelle appartient un element, s'il y en a une :
   *  onglets, choix, commandes d'une ligne de reglage, boutons de pied de
   *  panneau. Gauche et droite y circulent, haut et bas en sortent. */
  _lane(el) {
    return el?.closest('.tabs, .choice, .row-control, .row-actions') ?? null;
  }

  /** Navigation a la manette. `pulse` vient de `Input.menuPulse`. */
  navigate(pulse) {
    if (!pulse || !this.screen) return;
    const items = this.items();
    if (!items.length) return;
    const here = items.indexOf(document.activeElement);
    const cur = here >= 0 ? items[here] : null;
    const lane = this._lane(cur);

    if (pulse.x) {
      // Sur un curseur, gauche et droite reglent la valeur plutot que de
      // changer d'element : c'est le geste attendu.
      if (cur && cur.type === 'range') {
        const span = Number(cur.max) - Number(cur.min);
        const next = Number(cur.value) + pulse.x * Math.max(1, Math.round(span / 20));
        cur.value = String(Math.min(Number(cur.max), Math.max(Number(cur.min), next)));
        cur.dispatchEvent(new Event('input'));
        return;
      }
      if (lane) {
        const line = items.filter((it) => this._lane(it) === lane);
        const k = line.indexOf(cur);
        this._focus(line[(k + pulse.x + line.length) % line.length]);
        return;
      }
    }

    const step = pulse.y || (lane ? 0 : pulse.x);
    if (step) {
      let i = here < 0 ? (step > 0 ? -1 : 0) : here;
      // On saute le reste de la rangee : haut et bas changent de reglage.
      do {
        i = (i + step + items.length) % items.length;
      } while (lane && this._lane(items[i]) === lane && i !== here);
      this._focus(items[i]);
      return;
    }
    if (pulse.ok && cur && cur.tagName === 'BUTTON') {
      cur.click();
      return;
    }
    if (pulse.back) this.back();
  }

  /** Retour arriere de l'ecran courant, pour le bouton B de la manette. */
  back() {
    const exits = {
      settings: 'btn-settings-back',
      online: 'btn-online-back',
      pause: 'btn-resume',
      result: 'btn-result-menu',
    };
    $(exits[this.screen] || '')?.click();
  }

  hide() {
    for (const e of document.querySelectorAll('.pad-focus')) e.classList.remove('pad-focus');
    for (const el of Object.values(this.screens)) el.hidden = true;
    $('shell').classList.remove('menu-open');
    this.screen = null;
  }

  _wire() {
    $('btn-play').onclick = () => this.hooks.play();
    $('btn-settings').onclick = () => {
      this.from = 'title';
      this.show('settings');
    };
    $('btn-settings-back').onclick = () => this.show(this.from || 'title');
    $('btn-settings-reset').onclick = () => {
      Object.assign(this.settings, reset());
      this.hooks.change(this.settings);
      this.renderSettings();
    };

    $('btn-online').onclick = () => this.showOnline();
    $('btn-online-create').onclick = () => this.hooks.host('');
    $('btn-online-refresh').onclick = () => this.refreshRooms();
    $('btn-online-back').onclick = () => this.show('title');

    $('btn-resume').onclick = () => this.hooks.resume();
    $('btn-pause-settings').onclick = () => {
      this.from = 'pause';
      this.show('settings');
    };
    $('btn-pause-restart').onclick = () => this.hooks.restart();
    $('btn-pause-quit').onclick = () => this.hooks.quit();
    $('btn-result-again').onclick = () => this.hooks.restart();
    $('btn-result-menu').onclick = () => this.hooks.quit();

    for (const b of document.querySelectorAll('[data-tab]')) {
      b.onclick = () => {
        this.tab = b.dataset.tab;
        this.renderSettings();
      };
    }
  }

  /** Pseudo saisi, conserve avec les autres reglages. */
  playerName() {
    const v = $('online-name').value.trim();
    if (v !== this.settings.name) {
      this.settings.name = v;
      this.hooks.change(this.settings);
    }
    return v;
  }

  status(text) {
    $('online-status').textContent = text || '';
  }

  async showOnline() {
    $('online-name').value = this.settings.name || '';
    this.show('online');
    await this.refreshRooms();
  }

  /** Recharge la liste des salons ouverts. */
  async refreshRooms() {
    const box = $('online-list');
    this.status('Recherche des salons…');
    let rooms;
    try {
      rooms = await listRooms();
    } catch (err) {
      box.innerHTML = '';
      this.status(`Serveur injoignable : ${err.message}`);
      return;
    }
    box.innerHTML = '';
    if (!rooms.length) {
      this.status('Aucun salon ouvert pour l’instant. Cree le tien.');
      return;
    }
    this.status('');
    // Les salons ou l'on peut entrer passent devant : c'est ce qu'on vient
    // chercher, les parties pleines ne sont la que pour information.
    rooms.sort((a, b) => (a.players.length >= a.seats) - (b.players.length >= b.seats));
    for (const r of rooms) box.append(this._roomRow(r));
  }

  _roomRow(room) {
    const el = document.createElement('div');
    const full = room.players.length >= room.seats;
    el.className = full ? 'salon full' : 'salon';
    const left = document.createElement('div');
    const code = document.createElement('b');
    code.textContent = room.code;
    const who = document.createElement('small');
    const names = room.players.map((p) => p.name).join(', ') || 'vide';
    who.textContent = `${room.players.length}/${room.seats} · ${names} · ${PHASE_FR[room.phase] || room.phase}`;
    left.append(code, who);
    const go = document.createElement('button');
    go.textContent = full ? 'Complet' : 'Rejoindre';
    go.disabled = full;
    go.onclick = () => this.hooks.join(room.code);
    el.append(left, go);
    return el;
  }

  /** Affiche l'ecran de fin avec le score final. */
  result(blue, orange) {
    const win = blue > orange;
    $('result-title').textContent = blue === orange ? 'Match nul' : win ? 'Victoire' : 'Defaite';
    $('result-score').textContent = `${blue} - ${orange}`;
    $('result-title').className = blue === orange ? '' : win ? 'blue' : 'orange';
    this.show('result');
  }

  renderSettings() {
    for (const b of document.querySelectorAll('[data-tab]')) {
      b.classList.toggle('active', b.dataset.tab === this.tab);
    }
    const body = $('settings-body');
    body.innerHTML = '';
    if (this.tab === 'controls') this._controls(body);
    else if (this.tab === 'audio') this._audio(body);
    else this._match(body);
  }

  _row(parent, label, hint) {
    const row = document.createElement('div');
    row.className = 'row';
    const l = document.createElement('div');
    l.className = 'row-label';
    l.textContent = label;
    if (hint) {
      const h = document.createElement('small');
      h.textContent = hint;
      l.append(h);
    }
    const c = document.createElement('div');
    c.className = 'row-control';
    row.append(l, c);
    parent.append(row);
    return c;
  }

  _controls(body) {
    const pad = this.input.pad();
    const note = document.createElement('p');
    note.className = 'note';
    note.textContent = pad
      ? `Manette detectee : ${pad.id}`
      : 'Aucune manette detectee. Branche-la et appuie sur un bouton.';
    body.append(note);

    for (const a of ACTIONS) {
      const c = this._row(body, a.label);
      if (!a.padOnly) c.append(this._bindButton(a, 'keys'));
      if (!a.keyOnly) c.append(this._bindButton(a, 'pad'));
    }

    const c = this._row(body, 'Zone morte du stick', 'ignore les sticks fatigues');
    c.append(this._slider('deadzone', 0, 40, this.settings.deadzone, (v) => {
      this.settings.deadzone = v;
    }, (v) => `${v} %`));
  }

  /** Bouton de reassignation : clavier ou manette selon `source`. */
  _bindButton(action, source) {
    const b = document.createElement('button');
    b.className = `bind ${source}`;
    const paint = () => {
      const v = this.settings[source][action.id];
      b.textContent = source === 'keys' ? keyLabel(v) : padLabel(v);
    };
    paint();
    b.onclick = () => {
      b.textContent = '...';
      b.classList.add('listening');
      this.input.listen((res) => {
        b.classList.remove('listening');
        if (res.source !== source) {
          // Touche pressee alors qu'on attendait la manette (ou l'inverse) :
          // on repeint sans rien changer plutot que de melanger les tables.
          paint();
          return;
        }
        this.settings[source][action.id] = source === 'keys' ? res.code : res.bind;
        this.hooks.change(this.settings);
        paint();
      });
    };
    return b;
  }

  _audio(body) {
    const levels = [
      ['master', 'Volume general'],
      ['sfx', 'Effets'],
      ['music', 'Musique'],
    ];
    for (const [key, label] of levels) {
      const c = this._row(body, label);
      c.append(this._slider(key, 0, 100, this.settings.audio[key], (v) => {
        this.settings.audio[key] = v;
      }, (v) => `${v} %`));
    }
  }

  _match(body) {
    const dur = this._row(body, 'Duree du match');
    dur.append(this._choice([
      [180, '3 min'], [300, '5 min'], [600, '10 min'],
    ], this.settings.match.duration, (v) => {
      this.settings.match.duration = v;
    }));

    const lvl = this._row(body, 'Niveau du bot');
    lvl.append(this._choice([
      [0, 'Debutant'], [1, 'Confirme'], [2, 'Impitoyable'],
    ], this.settings.match.level, (v) => {
      this.settings.match.level = v;
    }));

    const cam = this._row(body, 'Camera', 'le suivi zoome sur ta voiture');
    cam.append(this._choice([
      ['arena', 'Arene entiere'], ['follow', 'Suivi'],
    ], this.settings.camera, (v) => {
      this.settings.camera = v;
    }));

    const note = document.createElement('p');
    note.className = 'note';
    note.textContent = 'La duree et le niveau prennent effet au prochain match.';
    body.append(note);
  }

  _slider(name, min, max, value, set, fmt) {
    const wrap = document.createElement('div');
    wrap.className = 'slider';
    const i = document.createElement('input');
    i.type = 'range';
    i.min = min;
    i.max = max;
    i.value = value;
    i.name = name;
    const out = document.createElement('span');
    out.textContent = fmt(value);
    i.oninput = () => {
      const v = Number(i.value);
      out.textContent = fmt(v);
      set(v);
      this.hooks.change(this.settings);
    };
    wrap.append(i, out);
    return wrap;
  }

  _choice(options, value, set) {
    const wrap = document.createElement('div');
    wrap.className = 'choice';
    for (const [v, label] of options) {
      const b = document.createElement('button');
      b.textContent = label;
      b.classList.toggle('active', v === value);
      b.onclick = () => {
        set(v);
        this.hooks.change(this.settings);
        for (const o of wrap.children) o.classList.toggle('active', o === b);
      };
      wrap.append(b);
    }
    return wrap;
  }
}

export { DEFAULTS };
