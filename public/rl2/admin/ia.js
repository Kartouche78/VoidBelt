// Onglet « Clés API » : brancher les fournisseurs d'IA des generateurs.
//
// Les cles partent au serveur, qui les garde dans `data/ia-keys.json` et ne
// renvoie que leur empreinte. Le champ se vide apres l'envoi : une cle
// n'est jamais relue dans la page, ni gardee dans le navigateur.

import { api } from './api.js';

const API = '/api/ia/keys';

/** Fournisseurs proposes. L'identifiant doit figurer dans la liste du
 *  serveur (`src/ia.rs`), sinon il refuse de ranger la cle. */
const PROVIDERS = [
  { id: 'openai', name: 'OpenAI', uses: ['Images', 'Texte'], url: 'https://platform.openai.com/api-keys' },
  { id: 'anthropic', name: 'Anthropic', uses: ['Texte', 'Prompts'], url: 'https://console.anthropic.com/settings/keys' },
  { id: 'google', name: 'Google Gemini', uses: ['Images', 'Texte'], url: 'https://aistudio.google.com/apikey' },
  { id: 'stability', name: 'Stability AI', uses: ['Images', 'Textures'], url: 'https://platform.stability.ai/account/keys' },
  { id: 'replicate', name: 'Replicate', uses: ['Images', '3D', 'Son'], url: 'https://replicate.com/account/api-tokens' },
  { id: 'meshy', name: 'Meshy', uses: ['3D'], url: 'https://www.meshy.ai/settings/api' },
  { id: 'tripo', name: 'Tripo', uses: ['3D'], url: 'https://platform.tripo3d.ai/api-keys' },
  { id: 'elevenlabs', name: 'ElevenLabs', uses: ['Son', 'Voix'], url: 'https://elevenlabs.io/app/settings/api-keys' },
];

let etat = {};

async function send(method, body) {
  const res = await api(API, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Refus du serveur (${res.status}).`);
  etat = data.providers || {};
  return data;
}

/** Dessine la page dans `page`. */
export async function drawKeys(page) {
  const intro = document.createElement('p');
  intro.className = 'lead';
  intro.textContent = 'Les clés restent sur le serveur : la page n’en voit que les quatre derniers caractères. '
    + 'Le modèle est facultatif ; vide, chaque générateur prendra celui qui lui convient.';
  const msg = document.createElement('p');
  msg.className = 'msg';
  const grid = document.createElement('div');
  grid.className = 'providers';
  page.append(intro, msg, grid);

  const say = (text, kind = '') => {
    msg.textContent = text;
    msg.className = `msg ${kind}`;
  };

  try {
    await send('GET');
  } catch (err) {
    say(`${err.message} Hors de la machine du serveur, renseigne le jeton admin en haut à droite.`, 'bad');
  }
  for (const p of PROVIDERS) grid.append(card(p, say));
}

function card(p, say) {
  const el = document.createElement('div');
  el.className = 'provider';

  const head = document.createElement('div');
  head.className = 'p-head';
  const name = document.createElement('strong');
  name.textContent = p.name;
  const status = document.createElement('span');
  status.className = 'p-status';
  head.append(name, status);

  const uses = document.createElement('div');
  uses.className = 'chips';
  for (const u of p.uses) {
    const c = document.createElement('span');
    c.textContent = u;
    uses.append(c);
  }

  const key = input('password', 'Coller une clé pour la remplacer');
  key.autocomplete = 'off';
  const model = input('text', 'Modèle (facultatif)');

  const save = button('Enregistrer', 'go small');
  const del = button('Retirer', 'small');
  const link = document.createElement('a');
  link.href = p.url;
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = 'Obtenir une clé';
  const row = document.createElement('div');
  row.className = 'p-actions';
  row.append(save, del, link);

  const refresh = () => {
    const s = etat[p.id] || {};
    status.textContent = s.set ? `branchée ${s.hint}` : 'non branchée';
    status.classList.toggle('on', !!s.set);
    model.value = s.model || '';
    del.disabled = !s.set;
  };

  save.onclick = async () => {
    const change = { model: model.value };
    if (key.value.trim()) change.key = key.value;
    try {
      await send('PUT', { [p.id]: change });
      key.value = '';
      refresh();
      say(`${p.name} : enregistré.`, 'ok');
    } catch (err) {
      say(err.message, 'bad');
    }
  };
  del.onclick = async () => {
    if (!confirm(`Retirer la clé ${p.name} du serveur ?`)) return;
    try {
      await send('PUT', { [p.id]: { key: '', model: '' } });
      refresh();
      say(`${p.name} : clé retirée.`, 'ok');
    } catch (err) {
      say(err.message, 'bad');
    }
  };

  el.append(head, uses, key, model, row);
  refresh();
  return el;
}

function input(type, placeholder) {
  const i = document.createElement('input');
  i.type = type;
  i.placeholder = placeholder;
  i.spellcheck = false;
  return i;
}

function button(text, cls) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.textContent = text;
  return b;
}
