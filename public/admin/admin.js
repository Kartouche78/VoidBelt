// Interface de reglage du RL2.
//
// Les noms et les valeurs d'usine viennent du moteur lui-meme : on charge le
// meme `rl2.wasm` que le jeu et on lui demande sa liste. Rien n'est recopie
// ici, donc rien ne peut deriver du jour ou un reglage est ajoute.
//
// Les valeurs en cours viennent du serveur quand il repond ; sinon on part
// des valeurs d'usine, ce qui permet de regler meme sur un hebergement
// statique, avec export du fichier a la fin.

import { loadEngine } from '../rl2/js/wasm.js';
import { TABS, describe } from '../rl2/js/tuning.js';

const $ = (id) => document.getElementById(id);
const API = '/api/rl2/tune';

const state = {
  keys: [],
  factory: {},
  values: {},
  tab: TABS[0][0],
  query: '',
};

/** Valeur telle qu'on l'ecrit dans un champ : convertie dans l'unite
 *  d'affichage et arrondie, sans quoi une vitesse s'afficherait au
 *  millionieme de km/h. */
function show(engineValue, d) {
  const v = d.unite.vers(engineValue);
  return String(Number(v.toFixed(d.unite.decimales)));
}

/** Meme chose, mais pour le texte lu par l'humain : on garde la virgule
 *  francaise et on colle le suffixe. */
function pretty(engineValue, d) {
  const v = d.unite.vers(engineValue);
  const txt = v.toLocaleString('fr-FR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: d.unite.decimales,
  });
  return d.unite.suffixe ? `${txt} ${d.unite.suffixe}` : txt;
}

/** Message court sous l'entete. `kind` vaut 'ok', 'bad' ou rien. */
function say(text, kind = '') {
  const el = $('status');
  el.textContent = text;
  el.className = kind;
}

/** Envoie les reglages a l'apercu, qui les applique sans se relancer. */
function pushToPreview() {
  $('game').contentWindow?.postMessage({ t: 'rl2-tune', values: state.values }, '*');
}

function changed(key) {
  return Math.abs(state.values[key] - state.factory[key]) > 1e-6;
}

function tabOf(key) {
  return describe(key, state.factory[key]).tab;
}

/** Reglages de l'onglet courant, filtres par la recherche. Une recherche
 *  non vide traverse les onglets : on cherche un nom, pas une famille. */
function visible() {
  const q = state.query.trim().toLowerCase();
  return state.keys.filter((k) => {
    const d = describe(k, state.factory[k]);
    if (q) return `${k} ${d.label}`.toLowerCase().includes(q);
    return d.tab === state.tab;
  });
}

/** `value` est dans l'unite affichee ; le moteur, lui, ne connait que la
 *  sienne. La conversion se fait ici, une seule fois, pour que tout le
 *  reste de l'interface manipule des valeurs moteur. */
function set(key, value, from) {
  const d = describe(key, state.factory[key]);
  const shown = Number(value);
  if (!Number.isFinite(shown)) return;
  const x = d.unite.depuis(shown);
  if (!Number.isFinite(x)) return;
  state.values[key] = x;
  const row = document.querySelector(`[data-key="${key}"]`);
  if (row) {
    row.classList.toggle('changed', changed(key));
    // On ne reecrit pas le champ qu'on est en train de taper : le curseur
    // sauterait a la fin a chaque frappe.
    for (const el of row.querySelectorAll('input')) {
      if (el !== from) el.value = show(x, d);
    }
  }
  pushToPreview();
}

/** Remet un reglage a sa valeur d'usine, en unites moteur directement. */
function revert(key) {
  state.values[key] = state.factory[key];
  const d = describe(key, state.factory[key]);
  const row = document.querySelector(`[data-key="${key}"]`);
  if (row) {
    row.classList.remove('changed');
    for (const el of row.querySelectorAll('input')) el.value = show(state.factory[key], d);
  }
  pushToPreview();
}

function drawTabs() {
  const nav = $('tabs');
  nav.textContent = '';
  for (const [id, label] of TABS) {
    const n = state.keys.filter((k) => tabOf(k) === id).length;
    if (!n) continue;
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = `${label} <span class="count">${n}</span>`;
    b.classList.toggle('active', id === state.tab && !state.query);
    b.onclick = () => {
      state.tab = id;
      state.query = '';
      $('search').value = '';
      drawTabs();
      drawFields();
    };
    nav.append(b);
  }
}

function drawFields() {
  const box = $('fields');
  box.textContent = '';
  const keys = visible();
  if (!keys.length) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'Aucun réglage ne correspond.';
    box.append(p);
    return;
  }
  for (const key of keys) {
    box.append(row(key));
  }
}

function row(key) {
  const d = describe(key, state.factory[key]);
  const wrap = document.createElement('div');
  wrap.className = 'field';
  wrap.dataset.key = key;
  wrap.classList.toggle('changed', changed(key));

  const name = document.createElement('div');
  name.className = 'name';
  name.textContent = d.label;
  const code = document.createElement('span');
  code.className = 'key';
  code.textContent = key;
  name.append(code);
  if (d.help) {
    const help = document.createElement('span');
    help.className = 'help';
    help.textContent = d.help;
    name.append(help);
  }

  // Tout ce qui suit est en unite affichee. La plage decrite ne doit jamais
  // empecher d'atteindre une valeur deja en place : on l'elargit plutot que
  // de la faire mentir. Le rayon de virage s'inverse, donc les bornes aussi.
  // Les bornes de la fiche sont deja dans l'unite affichee. On prend leur
  // minimum et leur maximum car un rayon de virage inverse l'echelle : la
  // borne « serree » y est le petit nombre.
  const v = Number(show(state.values[key], d));
  const min = Math.min(d.min, d.max, v);
  const max = Math.max(d.min, d.max, v);

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = String(min);
  slider.max = String(max);
  slider.step = String(d.step);
  slider.value = String(v);
  slider.oninput = () => set(key, slider.value, slider);

  const box = document.createElement('input');
  box.type = 'number';
  box.step = String(d.step);
  box.value = String(v);
  box.oninput = () => set(key, box.value, box);

  const unit = document.createElement('span');
  unit.className = 'unit';
  unit.textContent = d.unite.suffixe;

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'revert';
  back.title = `Revenir à ${pretty(state.factory[key], d)}`;
  back.textContent = '↺';
  back.onclick = () => revert(key);

  const cell = document.createElement('div');
  cell.append(box, unit);
  wrap.append(name, slider, cell, back);
  return wrap;
}

// ----------------------------------------------------------- actions ----

async function publish() {
  try {
    const res = await fetch(API, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state.values),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      say(data.error || `Refus du serveur (${res.status}).`, 'bad');
      return;
    }
    say(
      `${data.applied} réglages publiés${data.saved ? ' et enregistrés' : ''}. `
      + 'Les salons à l’échauffement les prennent aussitôt.',
      'ok',
    );
  } catch {
    say('Serveur injoignable : exporte le fichier et dépose-le sur le serveur.', 'bad');
  }
}

function exportJson() {
  const text = JSON.stringify(state.values, null, 2);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = 'tune.json';
  a.click();
  URL.revokeObjectURL(a.href);
  say('Fichier tune.json téléchargé. À déposer dans public/rl2/assets/.', 'ok');
}

function importJson(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const obj = JSON.parse(String(reader.result));
      let n = 0;
      for (const key of state.keys) {
        const x = Number(obj[key]);
        if (Number.isFinite(x)) {
          state.values[key] = x;
          n += 1;
        }
      }
      drawFields();
      pushToPreview();
      say(`${n} réglages repris du fichier.`, 'ok');
    } catch {
      say('Fichier illisible.', 'bad');
    }
  };
  reader.readAsText(file);
}

function resetAll() {
  state.values = { ...state.factory };
  drawFields();
  pushToPreview();
  say('Tous les réglages sont revenus aux valeurs d’usine. Publie pour les appliquer.', 'ok');
}

// -------------------------------------------------------------- vie -----

async function boot() {
  // Le moteur est la reference : noms et valeurs d'usine viennent de lui.
  const engine = await loadEngine('/rl2/assets/rl2.wasm');
  engine.start(1, 1, 300);
  state.factory = engine.tuneDefaults();
  state.keys = Object.keys(state.factory);
  state.values = { ...state.factory };

  // Valeurs deja publiees, si le serveur repond.
  try {
    const res = await fetch(API, { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      let n = 0;
      for (const key of state.keys) {
        const x = Number(data.values?.[key]);
        if (Number.isFinite(x)) {
          state.values[key] = x;
          n += 1;
        }
      }
      say(`${state.keys.length} réglages. ${n} valeurs relues du serveur.`);
    } else {
      say(`${state.keys.length} réglages, valeurs d’usine (le serveur a refusé).`);
    }
  } catch {
    say(`${state.keys.length} réglages, valeurs d’usine (pas de serveur).`);
  }

  drawTabs();
  drawFields();

  $('search').oninput = (e) => {
    state.query = e.target.value;
    drawTabs();
    drawFields();
  };
  $('btn-reset').onclick = resetAll;
  $('btn-export').onclick = exportJson;
  $('btn-publish').onclick = publish;
  $('btn-import').onclick = () => $('file').click();
  $('file').onchange = (e) => e.target.files[0] && importJson(e.target.files[0]);
  $('btn-reload').onclick = () => {
    const f = $('game');
    f.src = f.src;
  };
  // L'apercu previent quand il est pret : on lui envoie l'etat courant.
  addEventListener('message', (e) => {
    if (e.data?.t === 'rl2-ready') pushToPreview();
    // L'apercu confirme ce qu'il a reellement pris : on compare, pour
    // qu'un reglage refuse par le moteur ne passe pas inapercu.
    if (e.data?.t === 'rl2-tuned') {
      const got = e.data.tune || {};
      const ecart = state.keys.filter((k) => Math.abs(got[k] - state.values[k]) > 1e-3);
      state.echo = { at: Date.now(), ecart };
    }
  });
  $('game').addEventListener('load', pushToPreview);
}

boot().catch((err) => {
  console.error(err);
  say(`Chargement impossible : ${err.message}`, 'bad');
});
