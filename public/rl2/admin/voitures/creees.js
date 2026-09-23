// Etape 6 du generateur de voitures : les voitures creees, leur essai en
// jeu, et « Équiper », qui ecrit le skin dans les reglages du jeu (meme
// origine que l'admin).

import { api, BASE } from '../api.js';

/** Reglages du jeu : « Équiper » y ecrit. */
const CLE_JEU = 'voidbelt.rl2.settings';

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function bouton(text, cls, onclick, title) {
  const b = el('button', cls, text);
  b.type = 'button';
  b.onclick = onclick;
  if (title) b.title = title;
  return b;
}

async function json(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Refus du serveur (${res.status}).`);
  return data;
}

/** Liste les voitures creees dans `liste` ; « Jouer » lance l'essai dans
 *  `jeu`. */
export async function dessineVoitures(liste, jeu, say) {
  liste.textContent = '';
  let voitures = [];
  try {
    ({ voitures } = await json(await api('/api/voitures')));
  } catch (err) {
    liste.append(el('p', 'aide', err.message));
    return;
  }
  if (!voitures.length) liste.append(el('p', 'aide', 'Aucune voiture créée pour l’instant.'));
  const equipee = reglagesJeu().skin || '';
  for (const v of voitures) {
    const box = el('div', 'creee');
    const mini = el('img');
    mini.src = BASE + v.thumb;
    mini.alt = '';
    const bas = el('div', 'tete');
    bas.append(el('strong', null, v.id === equipee ? `${v.name} · équipée` : v.name));
    bas.append(bouton('Jouer', 'go small', () => essayer(v, jeu)));
    bas.append(bouton(v.id === equipee ? 'Retirer' : 'Équiper', 'small', () => {
      equiper(v.id === equipee ? '' : v.id, say);
      dessineVoitures(liste, jeu, say);
    }));
    bas.append(bouton('✕', 'carre danger', async () => {
      if (!confirm(`Retirer « ${v.name} » du jeu ?`)) return;
      await api(`/api/voitures/${v.id}`, { method: 'DELETE' });
      if (v.id === equipee) equiper('', say);
      dessineVoitures(liste, jeu, say);
    }, 'Retirer du jeu'));
    box.append(mini, bas);
    liste.append(box);
  }
}

/** Lance une partie avec la voiture `v`, dans la page. */
function essayer(v, jeu) {
  jeu.textContent = '';
  const f = el('iframe');
  f.src = `/rl2/?skin=${encodeURIComponent(v.id)}&jouer`;
  f.title = `Essai : ${v.name}`;
  f.allow = 'autoplay; gamepad; fullscreen';
  jeu.append(el('p', 'aide', `Essai de « ${v.name} ». Clique dans le jeu pour prendre les commandes.`), f);
  f.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(() => f.focus(), 600);
}

function reglagesJeu() {
  try {
    return JSON.parse(localStorage.getItem(CLE_JEU) || '{}');
  } catch {
    return {};
  }
}

/** Equipe un skin dans les reglages du jeu, qui partagent l'origine de
 *  l'admin ; vide rend la livree du camp. */
function equiper(id, say) {
  const s = reglagesJeu();
  s.skin = id;
  try {
    localStorage.setItem(CLE_JEU, JSON.stringify(s));
    say(id ? 'Voiture équipée : elle roulera à ta prochaine partie.' : 'Livrée du camp rétablie.', 'ok');
  } catch {
    say('Impossible d’enregistrer dans ce navigateur.', 'bad');
  }
}
