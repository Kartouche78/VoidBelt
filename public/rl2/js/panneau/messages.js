// Messagerie du panneau : le pop-up « Nouveau message » (choisir un ami),
// et ce que la colonne montre sous « Messages » : la discussion du clan,
// puis les conversations, la plus recente en haut.

import { appel, el, messager, pastille } from './outils.js';
import { ecusson } from './clan.js';

/** Extrait d'un message, pour une infobulle. */
function extrait(texte, max = 60) {
  const t = texte.replace(/\s+/g, ' ');
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Entrees de la colonne, d'apres `/api/messagerie` : { cle, cible,
 *  contenu, titre, aide, badge }. Le panneau en fait des icones. */
export function entreesFil(resume, base, moi) {
  const v = [];
  const k = resume.clan;
  if (k) {
    const d = k.dernier;
    v.push({
      cle: 'conv:clan',
      cible: { type: 'clan', clan: k.clan },
      contenu: ecusson(base, k.clan, 'pn-conv-img'),
      titre: `Clan [${k.clan.tag}]`,
      aide: d ? (d.de ? `${d.de.pseudo} : ${extrait(d.texte)}` : extrait(d.texte)) : 'La discussion de ton clan.',
      badge: k.non_lus,
    });
  }
  for (const c of resume.conversations) {
    v.push({
      cle: `conv:${c.avec.id}`,
      cible: { type: 'ami', joueur: c.avec },
      contenu: pastille(base, c.avec, 'pn-conv-img'),
      titre: c.avec.pseudo,
      aide: `${c.dernier.de === moi ? 'Toi : ' : ''}${extrait(c.dernier.texte)}`,
      badge: c.non_lus,
    });
  }
  return v;
}

/** Entree d'une conversation encore vide, le temps d'ecrire le premier
 *  message. */
export function entreeNeuve(cible, base) {
  const clan = cible.type === 'clan';
  return {
    cle: clan ? 'conv:clan' : `conv:${cible.joueur.id}`,
    cible,
    contenu: clan ? ecusson(base, cible.clan, 'pn-conv-img') : pastille(base, cible.joueur, 'pn-conv-img'),
    titre: clan ? `Clan [${cible.clan.tag}]` : cible.joueur.pseudo,
    aide: 'Nouvelle conversation.',
    badge: 0,
  };
}

/** Pop-up « Nouveau message » : la liste des amis, filtrable. */
export async function dessineNouveau(box, ctx) {
  const { api, base } = ctx;
  const [msg, dire] = messager();
  const champ = el('input', 'pp-champ');
  champ.type = 'search';
  champ.placeholder = 'Chercher un ami…';
  champ.autocomplete = 'off';
  const liste = el('div', 'pa-liste pa-defile');
  let amis = [];
  const montrer = () => {
    const q = champ.value.trim().toLowerCase();
    liste.textContent = '';
    const vus = amis.filter((j) => j.pseudo.toLowerCase().includes(q));
    if (!amis.length) liste.append(el('p', 'pa-vide', 'Ajoute d’abord des amis : on n’écrit qu’à ses amis.'));
    else if (!vus.length) liste.append(el('p', 'pa-vide', 'Aucun ami de ce nom.'));
    for (const j of vus) {
      const b = el('button', 'pa-ligne pa-choix');
      b.type = 'button';
      b.append(pastille(base, j), el('span', 'pa-nom', j.pseudo));
      b.onclick = () => ctx.ecrire(j);
      liste.append(b);
    }
  };
  champ.oninput = montrer;
  champ.onkeydown = (e) => {
    if (e.key === 'Enter') liste.querySelector('button')?.click();
  };

  box.textContent = '';
  box.append(el('h3', 'pp-titre-pop', 'Nouveau message'), champ, liste, msg);
  try {
    amis = (await appel(api, '/api/amis')).amis;
    montrer();
  } catch (err) {
    dire(err.message, false);
  }
  setTimeout(() => champ.focus(), 0);
}
