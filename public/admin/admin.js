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

/** Arrondit a la precision du pas : sans cela un braquage s'affiche
 *  « 0,018181818181818184 » et un gain « 1,850000 ». */
function show(x, step) {
  const dec = Math.min(6, Math.max(0, Math.ceil(-Math.log10(step || 1))) + 1);
  return String(Number(Number(x).toFixed(dec)));
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

function set(key, value, from) {
  const x = Number(value);
  if (!Number.isFinite(x)) return;
  state.values[key] = x;
  const row = document.querySelector(`[data-key="${key}"]`);
  if (row) {
    row.classList.toggle('changed', changed(key));
    // On ne reecrit pas le champ qu'on est en train de taper : le curseur
    // sauterait a la fin a chaque frappe.
    const step = Number(row.querySelector('input[type=number]').step) || 1;
    for (const el of row.querySelectorAll('input')) {
      if (el !== from) el.value = show(x, step);
    }
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
    p.textContent = 'Aucun reglage ne correspond.';
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

  // La plage decrite ne doit jamais empecher d'atteindre une valeur deja
  // en place : on l'elargit plutot que de la faire mentir.
  const v = state.values[key];
  const min = Math.min(d.min, v);
  const max = Math.max(d.max, v);

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = String(min);
  slider.max = String(max);
  slider.step = String(d.step);
  slider.value = show(v, d.step);
  slider.oninput = () => set(key, slider.value, slider);

  const box = document.createElement('input');
  box.type = 'number';
  box.step = String(d.step);
  box.value = show(v, d.step);
  box.oninput = () => set(key, box.value, box);

  const unit = document.createElement('span');
  unit.className = 'unit';
  unit.textContent = d.unit;

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'revert';
  back.title = `Revenir a ${show(state.factory[key], d.step)}`;
  back.textContent = '↺';
  back.onclick = () => set(key, state.factory[key]);

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
      `${data.applied} reglages publies${data.saved ? ' et enregistres' : ''}. `
      + 'Les salons a l’echauffement les prennent aussitot.',
      'ok',
    );
  } catch {
    say('Serveur injoignable : exporte le fichier et depose-le sur le serveur.', 'bad');
  }
}

function exportJson() {
  const text = JSON.stringify(state.values, null, 2);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = 'tune.json';
  a.click();
  URL.revokeObjectURL(a.href);
  say('Fichier tune.json telecharge. A deposer dans public/rl2/assets/.', 'ok');
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
      say(`${n} reglages repris du fichier.`, 'ok');
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
  say('Tous les reglages sont revenus aux valeurs d’usine. Publie pour les appliquer.', 'ok');
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
      say(`${state.keys.length} reglages. ${n} valeurs relues du serveur.`);
    } else {
      say(`${state.keys.length} reglages, valeurs d’usine (le serveur a refuse).`);
    }
  } catch {
    say(`${state.keys.length} reglages, valeurs d’usine (pas de serveur).`);
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
