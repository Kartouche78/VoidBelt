// Panneau des reglages : tout ce que dessinent les onglets Commandes, Son,
// Match et Interface. Separe de `menu.js`, qui n'a pas a savoir a quoi
// ressemble une ligne de reglage pour montrer un ecran.
//
// Les methodes gardent `this` : elles sont greffees sur la classe `Menu`,
// et continuent d'y lire `settings`, `input` et `hooks`.

import { ACTIONS, keyLabel, padLabel } from './settings.js';

/** Touches de l'interface, les memes pour tout le monde. Elles ne se
 *  reassignent pas : perdre la touche « retour » enfermerait dans un menu
 *  sans pouvoir en sortir ni la remettre. */
const INTERFACE = [
  ['Se deplacer', 'Croix ou stick gauche', 'Fleches'],
  ['Valider', 'A', 'Entree'],
  ['Retour', 'B', 'Echap'],
  ['Changer d’onglet', 'LB / RB', '—'],
  ['Tchat rapide, en jeu', 'Croix', '1 2 3 4'],
  ['Mise au point, en solo', '—', 'F1 F2 F3 ou F8 F4'],
];

export const PANNEAU = {
  renderSettings() {
    for (const b of document.querySelectorAll('[data-tab]')) {
      b.classList.toggle('active', b.dataset.tab === this.tab);
    }
    const body = $('settings-body');
    body.innerHTML = '';
    if (this.tab === 'controls') this._controls(body);
    else if (this.tab === 'audio') this._audio(body);
    else if (this.tab === 'interface') this._interface(body);
    else this._match(body);
  },

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
  },

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
  },

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
  },

  _audio(body) {
    // Pas de curseur musique : aucune piste ne l'alimente pour l'instant,
    // un reglage sans effet vaut moins qu'un reglage absent.
    const levels = [
      ['master', 'Volume general'],
      ['sfx', 'Effets'],
    ];
    for (const [key, label] of levels) {
      const c = this._row(body, label);
      c.append(this._slider(key, 0, 100, this.settings.audio[key], (v) => {
        this.settings.audio[key] = v;
      }, (v) => `${v} %`));
    }
  },

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
  },

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
  },

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
  },
  /** Touches de l'interface : un rappel, pas un reglage. */
  _interface(body) {
    for (const [quoi, pad, clavier] of INTERFACE) {
      const c = this._row(body, quoi);
      const m = document.createElement('span');
      m.className = 'touche-pad';
      m.textContent = pad;
      const k = document.createElement('span');
      k.className = 'touche-clavier';
      k.textContent = clavier;
      c.append(m, k);
    }
    const note = document.createElement('p');
    note.className = 'note';
    note.textContent = 'Ces touches ne se reassignent pas : sans le retour '
      + 'ni le deplacement, on ne pourrait plus ressortir d’un menu.';
    body.append(note);
  },
};
