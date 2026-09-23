// Etape 6 du generateur : les arenes creees, et leur essai en jeu. Plus la
// mise au format du jeu d'une image acceptee.

import { api, BASE } from '../api.js';
import { PLANCHE } from './gabarits.js';

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

/** Ramene une image au format des planches (1672 x 941), ce qui rend au
 *  trace du gabarit sa geometrie exacte, et en tire une miniature. Rend
 *  les deux en JPEG, prets a partir au serveur. */
export function versPlanche(img) {
  const planche = el('canvas');
  planche.width = PLANCHE.w;
  planche.height = PLANCHE.h;
  planche.getContext('2d').drawImage(img, 0, 0, PLANCHE.w, PLANCHE.h);
  const mini = el('canvas');
  mini.width = 480;
  mini.height = 270;
  mini.getContext('2d').drawImage(planche, 0, 0, mini.width, mini.height);
  return { planche: planche.toDataURL('image/jpeg', 0.9), mini: mini.toDataURL('image/jpeg', 0.82) };
}

/** Liste les arenes creees dans `liste` ; « Jouer » lance l'essai dans
 *  `jeu`. */
export async function dessineCreees(liste, jeu) {
  liste.textContent = '';
  let stades = [];
  try {
    const res = await api('/api/arenes');
    ({ stades } = await res.json());
  } catch (err) {
    liste.append(el('p', 'aide', err.message));
    return;
  }
  if (!stades.length) liste.append(el('p', 'aide', 'Aucune arène créée pour l’instant.'));
  for (const s of stades) {
    const box = el('div', 'creee');
    const mini = el('img');
    mini.src = BASE + s.thumb;
    mini.alt = '';
    const bas = el('div', 'tete');
    bas.append(el('strong', null, s.name));
    bas.append(bouton('Jouer', 'go small', () => essayer(s, jeu)));
    bas.append(bouton('✕', 'carre danger', async () => {
      if (!confirm(`Retirer « ${s.name} » du jeu ?`)) return;
      await api(`/api/arenes/stades/${s.id}`, { method: 'DELETE' });
      dessineCreees(liste, jeu);
    }, 'Retirer du jeu'));
    box.append(mini, bas);
    liste.append(box);
  }
}

/** Lance une partie sur l'arene `s`, dans la page. */
function essayer(s, jeu) {
  jeu.textContent = '';
  const f = el('iframe');
  f.src = `/rl2/?stade=${encodeURIComponent(s.id)}&jouer`;
  f.title = `Essai : ${s.name}`;
  f.allow = 'autoplay; gamepad; fullscreen';
  jeu.append(el('p', 'aide', `Essai de « ${s.name} ». Clique dans le jeu pour prendre les commandes.`), f);
  f.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(() => f.focus(), 600);
}
