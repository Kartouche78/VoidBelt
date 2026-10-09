// Onglet Commandes des Parametres : la manette a gauche, le clavier et la
// souris a droite, deux touches par action de chaque cote.
//
// Clic ou A/Entree sur une case : elle ecoute la prochaine touche (ou le
// prochain bouton de manette). Echap annule. Clic droit sur une case : la
// vide. Les aides a l'ecran (accueil, HUD) suivent la config.

import {
  ACTIONS, DEFAUT, SLOTS, charger, enregistrer, poser, texte,
  nomClavier, nomManette, dispositionPrete,
} from './commandes.js';

const COTES = [
  { id: 'manette', label: 'Manette', nom: nomManette },
  { id: 'clavier', label: 'Clavier & souris', nom: nomClavier },
];
/** Colonnes de cases : manette 1, manette 2, clavier 1, clavier 2. */
const COLS = COTES.flatMap((c) => Array.from({ length: SLOTS }, (_, s) => [c.id, s]));
const NOTE_PAD = { gauche: 'et stick gauche', droite: 'et stick gauche' };

export class OngletCommandes {
  constructor(root, input, fermer) {
    this.root = root;
    this.input = input;
    this.fermer = fermer;
    this.config = charger();
    this.row = 0;
    this.col = 0;
    this.ecoute = null;
    this.finEcoute = 0;
    this.build();
    this.appliquer();
    dispositionPrete.then(() => this.appliquer());
  }

  build() {
    this.cases = {};
    const grille = document.createElement('div');
    grille.className = 'commandes';
    for (const c of COTES) {
      const bloc = document.createElement('div');
      bloc.className = `cote cote-${c.id}`;
      const h = document.createElement('h3');
      h.textContent = c.label;
      bloc.appendChild(h);
      ACTIONS.forEach((a, r) => {
        const ligne = document.createElement('div');
        ligne.className = 'commande';
        const nom = document.createElement('span');
        nom.textContent = a.label;
        if (c.id === 'manette' && NOTE_PAD[a.id]) {
          const n = document.createElement('small');
          n.textContent = NOTE_PAD[a.id];
          nom.appendChild(n);
        }
        ligne.appendChild(nom);
        for (let s = 0; s < SLOTS; s++) {
          const b = document.createElement('button');
          b.className = 'touche';
          const col = COLS.findIndex(([id, sl]) => id === c.id && sl === s);
          b.addEventListener('mouseenter', () => this.setFocus(r, col));
          b.addEventListener('click', () => {
            this.setFocus(r, col);
            this.ecouter();
          });
          // le clic droit qui vient d'etre pose ne doit pas aussitot vider
          b.addEventListener('contextmenu', () => {
            if (performance.now() - this.finEcoute > 400) this.vider(c.id, a.id, s);
          });
          ligne.appendChild(b);
          this.cases[`${c.id}.${a.id}.${s}`] = b;
        }
        bloc.appendChild(ligne);
      });
      grille.appendChild(bloc);
    }
    this.root.appendChild(grille);

    const bas = document.createElement('div');
    bas.className = 'commandes-bas';
    this.boutons = [['Touches par défaut', () => this.defaut()], ['Fermer', () => this.fermer()]]
      .map(([label, fn], i) => {
        const b = document.createElement('button');
        b.className = 'bouton-reglage';
        b.textContent = label;
        b.addEventListener('click', fn);
        b.addEventListener('mouseenter', () => this.setFocus(ACTIONS.length, i));
        bas.appendChild(b);
        return b;
      });
    this.root.appendChild(bas);
  }

  show() {
    this.refresh();
  }

  setFocus(row, col) {
    this.row = (row + ACTIONS.length + 1) % (ACTIONS.length + 1);
    const n = this.row === ACTIONS.length ? this.boutons.length : COLS.length;
    this.col = Math.max(0, Math.min(n - 1, col));
    this.refresh();
  }

  refresh() {
    ACTIONS.forEach((a, r) => {
      COLS.forEach(([cote, s], col) => {
        const b = this.cases[`${cote}.${a.id}.${s}`];
        const nom = COTES.find((c) => c.id === cote).nom;
        const k = this.config[cote][a.id][s];
        const ecoute = this.ecoute && this.ecoute.r === r && this.ecoute.col === col;
        b.textContent = ecoute ? (cote === 'clavier' ? 'Touche ou clic…' : 'Bouton…') : nom(k);
        b.classList.toggle('ecoute', !!ecoute);
        b.classList.toggle('vide', k == null);
        b.classList.toggle('modifie', k !== DEFAUT[cote][a.id][s]);
        b.classList.toggle('focus', r === this.row && col === this.col);
      });
    });
    this.boutons.forEach((b, i) => b.classList.toggle('focus', this.row === ACTIONS.length && this.col === i));
    const f = this.row < ACTIONS.length
      ? this.cases[`${COLS[this.col][0]}.${ACTIONS[this.row].id}.${COLS[this.col][1]}`]
      : this.boutons[this.col];
    f.scrollIntoView({ block: 'nearest' });
  }

  /** La case en focus attend la prochaine touche. */
  ecouter() {
    const [cote, s] = COLS[this.col];
    const a = ACTIONS[this.row];
    this.ecoute = { r: this.row, col: this.col };
    this.refresh();
    this.input.capturer(cote, (code) => {
      this.ecoute = null;
      this.finEcoute = performance.now();
      if (code != null) {
        poser(this.config, cote, a.id, s, code);
        this.appliquer();
      }
      this.refresh();
    });
  }

  vider(cote, action, s) {
    this.config[cote][action][s] = null;
    this.appliquer();
    this.refresh();
  }

  defaut() {
    this.config = JSON.parse(JSON.stringify(DEFAUT));
    this.appliquer();
    this.refresh();
  }

  /** Enregistre, transmet aux entrees et met les aides a jour. */
  appliquer() {
    enregistrer(this.config);
    this.input.setConfig(this.config);
    majAides(this.config);
  }

  handle(a) {
    if (this.ecoute) return;
    if (a === 'up') this.setFocus(this.row - 1, this.col);
    else if (a === 'down') this.setFocus(this.row + 1, this.col);
    else if (a === 'left') this.setFocus(this.row, this.col - 1);
    else if (a === 'right') this.setFocus(this.row, this.col + 1);
    else if (a === 'confirm') {
      if (this.row < ACTIONS.length) this.ecouter();
      else this.boutons[this.col].click();
    }
  }
}

// ------------------------------------------------------------ aides --

/** Touches de deplacement : « Z Q S D / ↑ ← ↓ → ». */
function deplacement(c) {
  const ids = ['gaz', 'gauche', 'frein', 'droite'];
  const parSlot = [0, 1].map((s) => ids.map((id) => c.clavier[id][s]))
    .filter((ks) => ks.every((k) => k != null))
    .map((ks) => ks.map(nomClavier).join(' '));
  return parSlot.join(' / ') || ids.map((id) => texte(c, 'clavier', id)).join(' · ');
}

function remplir(dl, lignes) {
  dl.replaceChildren(...lignes.flatMap(([dt, dd]) => {
    const t = document.createElement('dt');
    t.textContent = dt;
    const d = document.createElement('dd');
    d.textContent = dd;
    return [t, d];
  }));
}

/** Texte de l'aide « couper le son », lu aussi par main.js. */
export function aideSon(c) {
  return `${texte(c, 'clavier', 'son').toUpperCase()} : COUPER LE SON`;
}

export function majAides(c) {
  const k = (id) => texte(c, 'clavier', id);
  const p = (id) => texte(c, 'manette', id);
  const dlClavier = document.querySelector('#accueil .touches.clavier');
  const dlPad = document.querySelector('#accueil .touches.pad');
  if (dlClavier) {
    remplir(dlClavier, [
      [deplacement(c), 'conduire'],
      [k('driftage'), 'drift (le frein ne fait que freiner)'],
      [`${k('boost')} (maintenir)`, 'boost'],
      [k('checkpoint'), 'dernier checkpoint'],
      [k('recommencer'), 'recommencer'],
      [k('vue'), 'caméra suivante'],
      [`${k('arriere')} (maintenir)`, 'regarder derrière'],
    ]);
  }
  if (dlPad) {
    remplir(dlPad, [
      ['Stick gauche', 'diriger'],
      [`${p('gaz')} / ${p('frein')}`, 'gaz / frein'],
      [p('driftage'), 'drift (le frein ne fait que freiner)'],
      [`${p('boost')} (maintenir)`, 'boost'],
      [p('checkpoint'), 'dernier checkpoint'],
      [p('recommencer'), 'recommencer'],
      [p('vue'), 'caméra suivante'],
      [`${p('arriere')} (maintenir)`, 'regarder derrière'],
    ]);
  }
  const aideClavier = document.querySelector('.aide.clavier');
  if (aideClavier) {
    const son = document.getElementById('son');
    aideClavier.replaceChildren(
      `${k('vue').toUpperCase()} : CAMÉRA · ${k('checkpoint').toUpperCase()} : DERNIER CHECKPOINT · ${k('recommencer').toUpperCase()} : RECOMMENCER · ÉCHAP : PARAMÈTRES · `,
      son,
    );
    if (!son.dataset.coupe) son.textContent = aideSon(c);
  }
  const aidePad = document.querySelector('.aide.pad');
  if (aidePad) {
    aidePad.textContent = `${p('vue')} : CAMÉRA · ${p('checkpoint')} : DERNIER CHECKPOINT · ${p('recommencer')} : RECOMMENCER · ${p('son')} : SON · START : PARAMÈTRES`.toUpperCase();
  }
}
