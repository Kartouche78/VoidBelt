// Carte du joueur, en haut a gauche de l'accueil : avatar encadre, pseudo,
// niveau et sa barre, puis le rang. La ranked n'existe pas encore : le rang
// dit « No Ranked », et le niveau reste a 1.
//
// Connecte, un clic ouvre le profil dans le panneau ; sans compte, elle
// dit « Se connecter », en orange, et mene a la connexion Google. Elle
// suit les changements du panneau (`vb-compte` : pseudo, avatar,
// deconnexion).

import { moi, versGoogle } from './multi-connexion.js';
import { API_HTTP } from './net.js';

const el = (tag, cls, texte) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (texte !== undefined) e.textContent = texte;
  return e;
};

/** Silhouette, sans avatar ni compte. */
const SILHOUETTE = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="8.5" r="4.2"/><path d="M3.5 22c.8-5 4.2-7.6 8.5-7.6s7.7 2.6 8.5 7.6z"/></svg>';

export function carteJoueur(box, panneau) {
  const dessine = async () => {
    const m = await moi();
    const c = m.connecte ? m.compte : null;
    box.textContent = '';
    box.classList.toggle('invite', !c);

    const avatar = el('span', 'tj-avatar');
    if (c?.avatar) {
      const i = el('img');
      i.src = c.avatar.startsWith('/') ? API_HTTP + c.avatar : c.avatar;
      i.alt = '';
      i.referrerPolicy = 'no-referrer';
      avatar.append(i);
    } else {
      avatar.innerHTML = SILHOUETTE;
    }

    const infos = el('span', 'tj-infos');
    const nom = c ? c.pseudo || c.nom || 'Joueur' : m.google ? 'Se connecter' : 'Invité';
    infos.append(el('span', 'tj-nom', nom));
    if (c) {
      const niveau = el('span', 'tj-niveau');
      const barre = el('span', 'tj-barre');
      barre.append(el('span'));
      niveau.append(el('b', null, '1'), barre);
      infos.append(niveau);
    } else {
      infos.append(el('span', 'tj-connexion', m.google ? 'avec Google' : 'Hors ligne'));
    }

    box.append(el('span', 'tj-trait'), avatar, infos, el('span', 'tj-trait'), el('span', 'tj-rang', 'No Ranked'));
    box.title = c ? 'Ouvrir ton profil' : m.google ? 'Se connecter avec Google' : '';
    box.onclick = () => {
      if (c) panneau.ouvrirProfil();
      else if (m.google) location.href = versGoogle();
    };
  };
  addEventListener('vb-compte', dessine);
  dessine();
}
