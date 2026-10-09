// Menu Parametres, en onglets : Conduite, Son, Commandes.
//
// Les reglages de conduite ecrivent directement dans le `TUNING` du moteur
// Rust ; ils sont gardes dans ce navigateur. Se pilote a la souris, au
// clavier (fleches, Entree, Echap, Tab) et a la manette (croix ou stick, A,
// B, Start, LB/RB), via les actions de `entrees.js`. L'onglet Commandes vit
// dans `onglet-commandes.js`.

import { USINE, MOTEUR_JEU, normaliser } from '../creation/son/recettes.js';
import { moteurDuJeu } from '../creation/son/choix.js';
import { PISTES } from './son.js';
import { OngletCommandes } from './onglet-commandes.js';
import { CAMERAS } from './moteur.js';

const KEY = 'skidmania.parametres.v1';
/** Version de la physique. Les reglages de conduite enregistres sous une
 *  autre version sont ignores : sinon une vieille vitesse max (72 m/s,
 *  259 km/h) ecrasait les nouvelles valeurs apres chaque mise a jour.
 *  4 : conduite Stadium Car (README-CONDUITE), d'autres reglages. */
const PHYSIQUE = 4;

/** Les trois cameras, pour le choix des Parametres. */
const camerasProposees = () => CAMERAS.map(([, nom], i) => [i, nom]);

const ONGLETS = [
  { id: 'conduite', label: 'Conduite' },
  { id: 'son', label: 'Son' },
  { id: 'commandes', label: 'Commandes' },
];

/** Les lignes des onglets en liste. `scale` convertit la valeur du moteur
 *  pour l'affichage. */
const ITEMS = [
  // reglages de conduite (tune.rs) : la vitesse reste plafonnee a 600 km/h
  { tab: 'conduite', key: 'vitesse_max', label: 'Vitesse max', unit: 'km/h', min: 300, max: 600, step: 10 },
  { tab: 'conduite', key: 'vitesse_max_boost', label: 'Vitesse max au boost', unit: 'km/h', min: 300, max: 600, step: 10 },
  { tab: 'conduite', key: 'puissance', label: 'Puissance', unit: '×', min: 0.5, max: 2, step: 0.05, digits: 2 },
  { tab: 'conduite', key: 'lacet_bas', label: 'Braquage à basse vitesse', unit: 'rad/s', min: 1.2, max: 4, step: 0.1, digits: 1 },
  { tab: 'conduite', key: 'lacet_haut', label: 'Braquage à 600 km/h', unit: 'rad/s', min: 0.2, max: 1.2, step: 0.05, digits: 2 },
  { tab: 'conduite', key: 'adherence', label: 'Adhérence', unit: 'm/s²', min: 15, max: 60, step: 1 },
  { tab: 'conduite', key: 'drift_adherence', label: 'Accroche en drift', unit: '', min: 0.1, max: 0.9, step: 0.05, digits: 2 },
  { tab: 'conduite', key: 'speedslide', label: 'Speedslide (0 = coupé)', unit: 'm/s²', min: 0, max: 6, step: 0.5, digits: 1 },
  { tab: 'conduite', key: 'boost_accel', label: 'Poussée du boost', unit: 'm/s²', min: 0, max: 40, step: 1 },
  { tab: 'conduite', key: 'drift_fill', label: 'Drift pour remplir le boost', unit: 's', min: 2, max: 8, step: 0.5, digits: 1 },
  { tab: 'conduite', key: 'camera', label: 'Caméra', choix: camerasProposees, local: true },
  { tab: 'conduite', key: 'loopEmbarquee', label: 'Embarquée dans les loopings', toggle: true, local: true },
  { tab: 'conduite', key: 'diagnostic', label: 'Diagnostic (F3)', toggle: true, local: true },
  { tab: 'conduite', key: 'rumble', label: 'Vibrations manette', toggle: true, local: true },
  // le son du moteur : les 13 moteurs d'usine, et le moteur perso de la
  // Creation s'il existe ; la boite s'etage sur celui-ci
  { tab: 'son', key: 'moteur', label: 'Son du moteur', choix: moteursProposes, local: true },
  { tab: 'son', key: 'volume', label: 'Volume général', unit: '%', min: 0, max: 100, step: 5, local: true },
  ...PISTES.map((p) => (
    { tab: 'son', key: `vol_${p.id}`, label: p.label, unit: '%', min: 0, max: 150, step: 5, local: true })),
];
for (const t of ['conduite', 'son']) {
  ITEMS.push({ tab: t, action: 'defaut', label: 'Valeurs par défaut' });
  ITEMS.push({ tab: t, action: 'fermer', label: 'Fermer' });
}

const round = (v, d) => Number(v.toFixed(d));

/** Moteurs proposes : `[id, nom, recette]`. */
export function moteursProposes() {
  const liste = USINE.map((u) => [u.id, u.nom]);
  try {
    const p = JSON.parse(localStorage.getItem('skidmania.creation.perso'));
    if (p) liste.unshift([normaliser(p).id, normaliser(p).nom]);
  } catch {
    /* pas de moteur perso */
  }
  return liste;
}

function readSaved() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    return {};
  }
}

export class Settings {
  /** `apply(local)` est appele a chaque changement de son, camera,
   *  vibrations. `input` sert a l'onglet Commandes. */
  constructor(tuning, apply, input) {
    this.tuning = tuning;
    this.apply = apply;
    const sons = Object.fromEntries(PISTES.map((p) => [`vol_${p.id}`, 100]));
    this.defaults = { ...tuning, volume: 70, rumble: true, camera: 0, loopEmbarquee: true, diagnostic: false, moteur: MOTEUR_JEU, ...sons };
    const saved = readSaved();
    this.local = { volume: 70, rumble: true, camera: 0, loopEmbarquee: true, diagnostic: false, ...sons };
    for (const k of Object.keys(this.local)) if (saved[k] !== undefined) this.local[k] = saved[k];
    // le moteur vit dans le meme enregistrement que la Creation
    this.local.moteur = moteurDuJeu().recette.id;
    if (saved.physique === PHYSIQUE) {
      for (const [k, v] of Object.entries(saved.tuning || {})) {
        if (k in tuning && Number.isFinite(v)) tuning[k] = v;
      }
    }
    this.open = false;
    this.tab = 0;
    this.focus = 0;
    this.onClose = () => {};
    this.onRestart = () => {};
    document.getElementById('parametres-recommencer').addEventListener('click', () => {
      this.close();
      this.onRestart();
    });
    this.commandes = new OngletCommandes(document.getElementById('parametres-commandes'), input, () => this.close());
    this.build();
    this.apply(this.local);
  }

  /** Lignes de l'onglet ouvert, avec leur index dans `ITEMS`. */
  get visibles() {
    const id = ONGLETS[this.tab].id;
    return ITEMS.map((it, i) => [it, i]).filter(([it]) => it.tab === id);
  }

  get(it) {
    if (it.local) return this.local[it.key];
    return round(this.tuning[it.key] * (it.scale || 1), it.digits || 0);
  }

  set(it, v) {
    if (it.toggle || it.choix) {
      this.local[it.key] = v;
    } else {
      v = Math.max(it.min, Math.min(it.max, round(v, it.digits || 0)));
      if (it.local) this.local[it.key] = v;
      else this.tuning[it.key] = v / (it.scale || 1);
    }
    this.save();
    this.refresh();
    if (it.local) this.apply(this.local);
  }

  save() {
    // seuls les reglages vraiment modifies : les autres suivent les valeurs
    // par defaut du jeu, meme quand elles changent
    const tuning = {};
    for (const it of ITEMS) {
      if (!it.key || it.local) continue;
      const v = this.tuning[it.key];
      if (Math.abs(v - this.defaults[it.key]) > 1e-6) tuning[it.key] = v;
    }
    try {
      localStorage.setItem(KEY, JSON.stringify({ physique: PHYSIQUE, tuning, ...this.local }));
    } catch {
      /* navigation privee : les reglages ne survivent pas a la page */
    }
  }

  /** Empreinte des reglages de conduite : un record par jeu de reglages. */
  signature() {
    const conduite = ITEMS.filter((it) => it.key && !it.local);
    const parts = conduite.map((it) => `${it.key}=${round(this.tuning[it.key], 3)}`);
    const same = conduite.every((it) => round(this.tuning[it.key], 3) === round(this.defaults[it.key], 3));
    return same ? '' : parts.join(';');
  }

  isDefault() {
    return this.signature() === '';
  }

  /** Remet a zero l'onglet ouvert seulement. */
  reset() {
    for (const [it] of this.visibles) {
      if (!it.key) continue;
      if (it.local) this.local[it.key] = this.defaults[it.key];
      else this.tuning[it.key] = this.defaults[it.key];
    }
    this.save();
    this.refresh();
    this.apply(this.local);
  }

  build() {
    const nav = document.getElementById('parametres-onglets');
    this.tabs = ONGLETS.map((o, i) => {
      const b = document.createElement('button');
      b.textContent = o.label;
      b.addEventListener('click', () => this.setTab(i));
      nav.appendChild(b);
      return b;
    });
    const list = document.getElementById('parametres-liste');
    this.rows = ITEMS.map((it, i) => {
      const row = document.createElement('div');
      row.className = 'reglage';
      row.addEventListener('mouseenter', () => this.setFocus(this.visibles.findIndex(([, j]) => j === i)));
      if (it.action) {
        const b = document.createElement('button');
        b.className = 'bouton-reglage';
        b.textContent = it.label;
        b.addEventListener('click', () => this.activate(it));
        row.appendChild(b);
        return { row };
      }
      const label = document.createElement('span');
      label.textContent = it.label;
      const value = document.createElement('b');
      row.append(label, value);
      let input = null;
      if (it.choix) {
        row.classList.add('bascule');
        row.addEventListener('click', () => this.cycle(it, 1));
      } else if (it.toggle) {
        row.classList.add('bascule');
        row.addEventListener('click', () => this.set(it, !this.local[it.key]));
      } else {
        input = document.createElement('input');
        input.type = 'range';
        Object.assign(input, { min: it.min, max: it.max, step: it.step });
        input.addEventListener('input', () => this.set(it, Number(input.value)));
        row.appendChild(input);
      }
      return { row, value, input };
    });
    // les boutons d'action en bas de chaque onglet
    for (const r of this.rows) list.appendChild(r.row);
    this.setTab(0);
  }

  setTab(i) {
    this.tab = (i + ONGLETS.length) % ONGLETS.length;
    this.focus = 0;
    const commandes = ONGLETS[this.tab].id === 'commandes';
    this.tabs.forEach((b, j) => b.classList.toggle('actif', j === this.tab));
    document.getElementById('parametres-liste').hidden = commandes;
    this.commandes.root.hidden = !commandes;
    document.getElementById('parametres').classList.toggle('large', commandes);
    if (commandes) this.commandes.show();
    this.refresh();
  }

  refresh() {
    const id = ONGLETS[this.tab].id;
    const vis = this.visibles;
    ITEMS.forEach((it, i) => {
      const r = this.rows[i];
      r.row.hidden = it.tab !== id;
      r.row.classList.toggle('focus', vis[this.focus]?.[1] === i);
      if (it.action || it.tab !== id) return;
      const v = this.get(it);
      if (it.choix) {
        const m = it.choix().find(([mid]) => mid === v);
        r.value.textContent = m ? m[1] : v;
        r.value.classList.toggle('modifie', v !== this.defaults[it.key]);
        return;
      }
      if (it.toggle) {
        r.value.textContent = v ? it.on || 'OUI' : it.off || 'NON';
        return;
      }
      const d = round(this.defaults[it.key] * (it.local ? 1 : it.scale || 1), it.digits || 0);
      r.value.textContent = `${v.toFixed(it.digits || 0)} ${it.unit}`.trim();
      r.value.classList.toggle('modifie', Math.abs(v - d) > 1e-6);
      r.input.value = v;
    });
  }

  setFocus(i) {
    const vis = this.visibles;
    this.focus = (i + vis.length) % vis.length;
    this.refresh();
    this.rows[vis[this.focus][1]].row.scrollIntoView({ block: 'nearest' });
  }

  activate(it) {
    if (it.action === 'defaut') this.reset();
    else if (it.action === 'fermer') this.close();
    else if (it.choix) this.cycle(it, 1);
    else if (it.toggle) this.set(it, !this.local[it.key]);
  }

  /** Inverse un reglage oui/non (le diagnostic, depuis F3). */
  basculer(key) {
    const it = ITEMS.find((i) => i.key === key);
    this.set(it, !this.local[key]);
  }

  /** Choix suivant d'une liste (camera depuis Y, moteur...). */
  suivant(key) {
    this.cycle(ITEMS.find((i) => i.key === key), 1);
  }

  /** Choix suivant (`dir` = 1) ou precedent (-1). */
  cycle(it, dir) {
    const liste = it.choix();
    const i = liste.findIndex(([id]) => id === this.local[it.key]);
    this.set(it, liste[(i + dir + liste.length) % liste.length][0]);
  }

  show() {
    this.open = true;
    this.setTab(this.tab);
    document.getElementById('parametres').classList.add('vu');
  }

  close() {
    this.open = false;
    document.getElementById('parametres').classList.remove('vu');
    this.onClose();
  }

  /** Action venue du clavier ou de la manette pendant que le menu est ouvert. */
  handle(a) {
    if (a === 'tabprev' || a === 'tabnext') {
      this.setTab(this.tab + (a === 'tabnext' ? 1 : -1));
      return;
    }
    if (ONGLETS[this.tab].id === 'commandes') {
      if (a === 'back' || a === 'menu') this.close();
      else this.commandes.handle(a);
      return;
    }
    const [it] = this.visibles[this.focus];
    if (a === 'up') this.setFocus(this.focus - 1);
    else if (a === 'down') this.setFocus(this.focus + 1);
    else if (a === 'left' || a === 'right') {
      const dir = a === 'left' ? -1 : 1;
      if (it.choix) this.cycle(it, dir);
      else if (it.toggle) this.set(it, !this.local[it.key]);
      else if (!it.action) this.set(it, this.get(it) + dir * it.step);
    } else if (a === 'confirm') this.activate(it);
    else if (a === 'back' || a === 'menu') this.close();
  }
}
