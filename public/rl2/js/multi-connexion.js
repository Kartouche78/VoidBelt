// Porte du multijoueur : pour jouer en ligne, il faut un compte.
//
// Le solo reste libre. En ligne, l'ecran Multijoueur montre « Se connecter
// avec Google » tant qu'on ne l'est pas ; la connexion ramene ici, sur
// l'ecran Multijoueur, et ouvre le profil dans le panneau (voir `main.js`,
// `?ecran=multi&profil`). Le serveur tient la meme regle : sans session, il
// refuse d'ouvrir un salon.

import { API_HTTP } from './net.js';

const $ = (id) => document.getElementById(id);

/** Qui est connecte ? `multi_libre` : la machine du serveur, en local. */
export async function moi() {
  try {
    const res = await fetch(`${API_HTTP}/api/auth/moi`, { cache: 'no-store', credentials: 'include' });
    if (res.ok) return await res.json();
  } catch {
    // Serveur injoignable : on se comporte comme sans compte.
  }
  return { connecte: false, multi_libre: false, google: false };
}

/** Adresse qui connecte avec Google, puis revient sur le multijoueur avec
 *  le profil ouvert. */
export function versGoogle() {
  const retour = `${location.origin}${location.pathname}?ecran=multi&profil`;
  return `${API_HTTP}/api/auth/google/connexion?retour=${encodeURIComponent(retour)}`;
}

/** Ouvre ou ferme la porte de l'ecran Multijoueur. Rend vrai si l'on peut
 *  jouer en ligne. */
export async function gardeMulti() {
  const m = await moi();
  const libre = m.connecte || m.multi_libre;
  const porte = $('online-porte');
  porte.hidden = libre;
  for (const id of ['online-list', 'online-nom']) $(id).hidden = !libre;
  for (const id of ['btn-online-create', 'btn-online-refresh']) $(id).disabled = !libre;

  if (!libre) {
    porte.textContent = '';
    const titre = document.createElement('p');
    titre.className = 'porte-titre';
    titre.textContent = 'Connecte-toi pour jouer en ligne';
    const texte = document.createElement('p');
    texte.className = 'note';
    texte.textContent = m.google
      ? 'Le solo reste libre. En ligne, ton compte garde ton pseudo, ton avatar et ta voiture.'
      : 'La connexion n’est pas encore disponible sur ce serveur.';
    porte.append(titre, texte);
    if (m.google) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'google';
      b.textContent = 'Se connecter avec Google';
      b.onclick = () => {
        location.href = versGoogle();
      };
      porte.append(b);
    }
    return false;
  }

  // Connecte : le nom en salon est le pseudo du compte, que le serveur
  // impose de toute facon. On le montre, il se change dans le profil.
  const nom = $('online-name');
  if (m.compte) {
    nom.value = m.compte.pseudo || m.compte.nom || '';
    nom.readOnly = true;
    nom.title = 'Ton pseudo : il se change dans ton profil (Start ou ²).';
  } else {
    nom.readOnly = false;
    nom.title = '';
  }
  return true;
}

// Le panneau signale un pseudo change ou une deconnexion : l'ecran
// Multijoueur, s'il est affiche, se remet a jour.
addEventListener('vb-compte', () => {
  if (!$('screen-online')?.hidden) gardeMulti();
});
