// Compte connecte dans l'admin : bouton Google, qui est connecte, et la
// porte qui ferme l'admin en ligne tant qu'aucun admin n'est connecte.
//
// Tout se joue cote serveur (`admin2`) : ici, on ne fait que demander « qui
// suis-je ? » et envoyer vers la connexion Google. Le cookie de session est
// illisible pour la page, c'est voulu.

import { api, BASE, EN_LIGNE } from './api.js';

const $ = (id) => document.getElementById(id);

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Adresse qui lance la connexion Google et ramene ici ensuite. */
function versGoogle() {
  return `${BASE}/api/auth/google/connexion?retour=${encodeURIComponent(location.href)}`;
}

function boutonGoogle(texte = 'Se connecter avec Google') {
  const a = el('a', 'google', texte);
  a.href = versGoogle();
  return a;
}

async function deconnecter() {
  await api('/api/auth/deconnexion', { method: 'POST' }).catch(() => {});
  location.reload();
}

/** Remplit l'encart du compte ; rend `true` si l'admin est utilisable. */
export async function initCompte() {
  const box = $('compte');
  let moi = { connecte: false, admin: false, google: false };
  try {
    const res = await api('/api/auth/moi');
    if (res.ok) moi = await res.json();
  } catch {
    // Serveur injoignable : on reste deconnecte.
  }

  box.textContent = '';
  if (moi.connecte) {
    const c = moi.compte;
    if (c.avatar) {
      const img = el('img', 'avatar');
      img.src = c.avatar;
      img.alt = '';
      img.referrerPolicy = 'no-referrer';
      box.append(img);
    }
    const qui = el('span', 'qui', c.pseudo || c.nom || c.email);
    qui.title = `${c.email} · ${c.role}`;
    box.append(qui, el('span', `role ${c.role}`, c.role));
    const sortir = el('button', 'ghost small', 'Déconnexion');
    sortir.type = 'button';
    sortir.onclick = deconnecter;
    box.append(sortir);
  } else if (moi.google) {
    box.append(boutonGoogle());
  }

  // En local, la machine du serveur a la main : pas de porte. En ligne,
  // seul un compte admin passe.
  const ouvert = !EN_LIGNE || moi.admin;
  if (!ouvert) fermer(moi);
  return ouvert;
}

/** Recouvre l'admin : on ne voit rien tant qu'on n'est pas admin. */
function fermer(moi) {
  const porte = el('div', 'porte');
  const carte = el('div', 'porte-carte');
  carte.append(el('h2', null, 'Admin Pocket League'));
  if (!moi.google) {
    carte.append(el('p', null, 'La connexion Google n’est pas encore configurée sur le serveur.'));
  } else if (moi.connecte) {
    carte.append(
      el('p', null, `Le compte ${moi.compte.email} n’a pas accès à l’admin.`),
      boutonGoogle('Changer de compte'),
    );
    const sortir = el('button', 'ghost small', 'Déconnexion');
    sortir.type = 'button';
    sortir.onclick = deconnecter;
    carte.append(sortir);
  } else {
    carte.append(el('p', null, 'Connecte-toi avec le compte Google autorisé.'), boutonGoogle());
  }
  porte.append(carte);
  document.body.append(porte);
}
