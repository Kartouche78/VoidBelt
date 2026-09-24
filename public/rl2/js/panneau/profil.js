// Pop-up « Profil » : avatar, pseudo, e-mail, mot de passe, et ce qu'on
// sait du compte. Le serveur (`admin2`) fait foi ; ici, on affiche et on
// envoie.
//
// L'e-mail et le mot de passe appartiennent au compte Google : on les
// montre, avec le chemin pour les changer chez Google.

import { carre, el } from './outils.js';

function ligne(titre, ...contenu) {
  const l = el('div', 'pp-ligne');
  l.append(el('span', 'pp-titre', titre), ...contenu);
  return l;
}

/** Remplit `box` avec le profil de `compte`. `api(chemin, options)` parle
 *  au serveur ; `majCompte(c)` previent le panneau d'un changement. */
export function dessineProfil(box, compte, api, base, majCompte, deconnecter) {
  const msg = el('p', 'pp-msg');
  const dire = (texte, ok) => {
    msg.textContent = texte;
    msg.className = `pp-msg ${ok ? 'ok' : 'ko'}`;
  };
  const reponse = async (res) => {
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || `Refus du serveur (${res.status}).`);
    return d.compte;
  };

  // Avatar : celui choisi, ou celui de Google ; changeable, retirable.
  const img = el('img', 'pp-avatar');
  img.alt = '';
  img.referrerPolicy = 'no-referrer';
  const montreAvatar = (c) => {
    img.src = c.avatar ? (c.avatar.startsWith('/') ? base + c.avatar : c.avatar) : '';
    img.hidden = !c.avatar;
    retirer.hidden = !c.avatar.startsWith('/');
  };
  const fichier = el('input');
  fichier.type = 'file';
  fichier.accept = 'image/png,image/jpeg,image/webp';
  fichier.hidden = true;
  const changer = el('button', 'pp-bouton', 'Changer');
  changer.type = 'button';
  changer.onclick = () => fichier.click();
  const retirer = el('button', 'pp-bouton discret', 'Reprendre celui de Google');
  retirer.type = 'button';
  fichier.onchange = async () => {
    if (!fichier.files[0]) return;
    try {
      const image = await carre(fichier.files[0]);
      const c = await reponse(await api('/api/profil/avatar', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image }),
      }));
      montreAvatar(c);
      majCompte(c);
      dire('Avatar enregistré.', true);
    } catch (err) {
      dire(err.message, false);
    }
    fichier.value = '';
  };
  retirer.onclick = async () => {
    try {
      const c = await reponse(await api('/api/profil/avatar', { method: 'DELETE' }));
      montreAvatar(c);
      majCompte(c);
      dire('Avatar de Google rétabli.', true);
    } catch (err) {
      dire(err.message, false);
    }
  };
  const blocAvatar = el('div', 'pp-avatar-bloc');
  blocAvatar.append(img, changer, retirer, fichier);

  // Pseudo : celui que les autres joueurs verront.
  const pseudo = el('input', 'pp-champ');
  pseudo.type = 'text';
  pseudo.maxLength = 16;
  pseudo.placeholder = compte.nom || 'Ton pseudo';
  pseudo.value = compte.pseudo;
  pseudo.autocomplete = 'off';
  pseudo.spellcheck = false;
  const garder = el('button', 'pp-bouton', 'Enregistrer');
  garder.type = 'button';
  const envoyerPseudo = async () => {
    try {
      const c = await reponse(await api('/api/profil', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pseudo: pseudo.value }),
      }));
      majCompte(c);
      dire('Pseudo enregistré.', true);
    } catch (err) {
      dire(err.message, false);
    }
  };
  garder.onclick = envoyerPseudo;
  pseudo.onkeydown = (e) => {
    if (e.key === 'Enter') envoyerPseudo();
  };
  const blocPseudo = el('div', 'pp-rang');
  blocPseudo.append(pseudo, garder);

  // E-mail et mot de passe : ceux du compte Google.
  const lienGoogle = (texte, url) => {
    const a = el('a', 'pp-lien', texte);
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener';
    return a;
  };
  const email = el('span', 'pp-valeur', compte.email);
  const mdp = el('span', 'pp-valeur', 'Géré par Google');

  const depuis = new Date(compte.cree * 1000).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  const role = el('span', `pp-role ${compte.role}`, compte.role === 'admin' ? 'Admin' : 'Joueur');

  const sortir = el('button', 'pp-bouton discret', 'Se déconnecter');
  sortir.type = 'button';
  sortir.onclick = deconnecter;

  box.textContent = '';
  box.append(
    el('h3', 'pp-titre-pop', 'Profil'),
    ligne('Avatar', blocAvatar),
    ligne('Pseudo', blocPseudo),
    ligne('E-mail', email, lienGoogle('Changer sur Google', 'https://myaccount.google.com/personal-info')),
    ligne('Mot de passe', mdp, lienGoogle('Sécurité du compte Google', 'https://myaccount.google.com/security')),
    ligne('Statut', role),
    ligne('Membre depuis', el('span', 'pp-valeur', depuis)),
    msg,
    sortir,
  );
  montreAvatar(compte);
  setTimeout(() => pseudo.focus(), 0);
}
