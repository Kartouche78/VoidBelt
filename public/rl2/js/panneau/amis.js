// Pop-up « Amis » : chercher un joueur par son pseudo, repondre aux
// demandes, ecrire a un ami ou le retirer. Le serveur (`admin2/amis.rs`)
// fait foi.
//
// `ctx` : { api, base, ecrire(joueur), change() } ; `change` previent le
// panneau (pastilles, conversations).

import { appel, bouton, el, messager, pastille, sur } from './outils.js';

/** Ligne d'un joueur : pastille, pseudo, puis les boutons donnes. */
function ligneJoueur(base, j, ...boutons) {
  const l = el('div', 'pa-ligne');
  const actions = el('div', 'pa-actions');
  actions.append(...boutons);
  l.append(pastille(base, j), el('span', 'pa-nom', j.pseudo), actions);
  return l;
}

export function dessineAmis(box, ctx) {
  const { api, base } = ctx;
  const [msg, dire] = messager();
  const faire = async (chemin, methode, texte) => {
    try {
      await appel(api, chemin, methode);
      if (texte) dire(texte, true);
      await charger();
      if (champ.value.trim().length >= 2) await chercher();
      ctx.change();
    } catch (err) {
      dire(err.message, false);
    }
  };

  // Recherche par pseudo.
  const champ = el('input', 'pp-champ');
  champ.type = 'search';
  champ.placeholder = 'Pseudo du joueur…';
  champ.maxLength = 16;
  champ.autocomplete = 'off';
  champ.spellcheck = false;
  const trouves = el('div', 'pa-liste');
  let attente = 0;
  const chercher = async () => {
    const q = champ.value.trim();
    trouves.textContent = '';
    if (q.length < 2) return;
    try {
      const { joueurs } = await appel(api, `/api/amis/chercher?q=${encodeURIComponent(q)}`);
      if (!joueurs.length) trouves.append(el('p', 'pa-vide', 'Personne avec ce pseudo.'));
      for (const j of joueurs) {
        const action = {
          aucun: () => bouton('Ajouter', '', () => faire(`/api/amis/${j.id}`, 'POST', `Demande envoyée à ${j.pseudo}.`)),
          recue: () => bouton('Accepter', '', () => faire(`/api/amis/${j.id}`, 'POST', `${j.pseudo} est ton ami.`)),
          envoyee: () => bouton('Annuler', 'discret', () => faire(`/api/amis/${j.id}`, 'DELETE')),
          ami: () => bouton('Écrire', 'discret', () => ctx.ecrire(j)),
        }[j.lien]();
        trouves.append(ligneJoueur(base, j, action));
      }
    } catch (err) {
      dire(err.message, false);
    }
  };
  champ.oninput = () => {
    clearTimeout(attente);
    attente = setTimeout(chercher, 250);
  };

  const listes = el('div', 'pa-sections');
  const section = (titre, joueurs, boutons) => {
    if (!joueurs.length) return;
    const s = el('div', 'pa-section');
    s.append(el('span', 'pp-titre', `${titre} · ${joueurs.length}`));
    const l = el('div', 'pa-liste');
    for (const j of joueurs) l.append(ligneJoueur(base, j, ...boutons(j)));
    s.append(l);
    listes.append(s);
  };
  const charger = async () => {
    try {
      const { amis, recues, envoyees } = await appel(api, '/api/amis');
      listes.textContent = '';
      section('Demandes reçues', recues, (j) => [
        bouton('Accepter', '', () => faire(`/api/amis/${j.id}`, 'POST', `${j.pseudo} est ton ami.`)),
        bouton('Refuser', 'discret', () => faire(`/api/amis/${j.id}`, 'DELETE')),
      ]);
      section('Mes amis', amis, (j) => [
        bouton('Écrire', '', () => ctx.ecrire(j)),
        sur('Retirer', () => faire(`/api/amis/${j.id}`, 'DELETE', `${j.pseudo} n’est plus ton ami.`)),
      ]);
      section('Demandes envoyées', envoyees, (j) => [
        bouton('Annuler', 'discret', () => faire(`/api/amis/${j.id}`, 'DELETE')),
      ]);
      if (!amis.length && !recues.length && !envoyees.length) {
        listes.append(el('p', 'pa-vide', 'Pas encore d’amis : cherche un joueur par son pseudo.'));
      }
    } catch (err) {
      dire(err.message, false);
    }
  };

  box.textContent = '';
  box.classList.add('pa-large');
  box.append(el('h3', 'pp-titre-pop', 'Amis'), champ, trouves, msg, listes);
  charger();
  setTimeout(() => champ.focus(), 0);
}
