// Pop-up « Rechercher un joueur » : un pseudo, les joueurs trouves, et un
// clic ouvre leur profil, dans le meme pop-up (un bouton ramene a la
// recherche). Le serveur (`admin2/fiche.rs`) fait foi.
//
// `ctx` : { api, base, ecrire(joueur), social, change() }.
// `cible` : { id } pour ouvrir directement le profil d'un joueur.

import { adresse, appel, bouton, el, messager, pastille, sur } from './outils.js';
import { statutTexte } from './social.js';

/** Ce que la recherche garde d'une ouverture a l'autre. */
let derniere = '';

export function dessineRecherche(box, ctx, cible) {
  box.textContent = '';
  box.classList.add('pa-large');
  if (cible?.id) dessineFiche(box, ctx, cible.id, false);
  else dessineListe(box, ctx);
}

function dessineListe(box, ctx) {
  const { api, base } = ctx;
  const [msg, dire] = messager();
  const champ = el('input', 'pp-champ');
  champ.type = 'search';
  champ.placeholder = 'Pseudo du joueur…';
  champ.maxLength = 16;
  champ.autocomplete = 'off';
  champ.spellcheck = false;
  champ.value = derniere;
  const trouves = el('div', 'pa-liste pa-defile');
  let attente = 0;
  const chercher = async () => {
    const q = champ.value.trim();
    derniere = q;
    trouves.textContent = '';
    if (q.length < 2) {
      trouves.append(el('p', 'pa-vide', 'Tape au moins 2 lettres.'));
      return;
    }
    try {
      const { joueurs } = await appel(api, `/api/amis/chercher?q=${encodeURIComponent(q)}`);
      if (champ.value.trim() !== q) return;
      if (!joueurs.length) trouves.append(el('p', 'pa-vide', 'Personne avec ce pseudo.'));
      for (const j of joueurs) {
        const b = el('button', 'pa-ligne pa-choix');
        b.type = 'button';
        b.append(pastille(base, j), el('span', 'pa-nom', j.pseudo));
        if (j.lien === 'ami') b.append(el('span', 'pa-sous', 'Ami'));
        b.onclick = () => {
          box.textContent = '';
          dessineFiche(box, ctx, j.id, true);
        };
        trouves.append(b);
      }
    } catch (err) {
      dire(err.message, false);
    }
  };
  champ.oninput = () => {
    clearTimeout(attente);
    attente = setTimeout(chercher, 250);
  };
  champ.onkeydown = (e) => {
    if (e.key === 'Enter') trouves.querySelector('button')?.click();
  };
  box.append(el('h3', 'pp-titre-pop', 'Rechercher un joueur'), champ, trouves, msg);
  chercher();
  setTimeout(() => champ.focus(), 0);
}

/** Profil public d'un joueur ; `retour` : un bouton ramene a la recherche.
 *  `apres` : ce que la derniere action a donne. */
async function dessineFiche(box, ctx, id, retour, apres = '') {
  const { api, base } = ctx;
  const [msg, dire] = messager();
  if (apres) dire(apres, true);
  const haut = el('div', 'pr-haut');
  if (retour) {
    haut.append(bouton('← Recherche', 'discret', () => {
      box.textContent = '';
      dessineListe(box, ctx);
    }));
  }
  const corps = el('div', 'pr-fiche');
  box.append(haut, corps, msg);

  let j;
  try {
    j = (await appel(api, `/api/joueurs/${id}`)).joueur;
  } catch (err) {
    dire(err.message, false);
    return;
  }

  const refaire = async (chemin, methode, texte) => {
    try {
      await appel(api, chemin, methode);
      ctx.change();
      box.textContent = '';
      await dessineFiche(box, ctx, id, retour, texte);
    } catch (err) {
      dire(err.message, false);
    }
  };

  // En-tete : avatar, pseudo, statut ou role.
  const tete = el('div', 'pr-tete');
  const img = pastille(base, j, 'pr-avatar');
  const texte = el('div', 'pa-texte');
  texte.append(el('h3', 'pp-titre-pop', j.pseudo));
  if (j.statut) texte.append(el('span', `pa-sous pg-statut ${j.statut.en_ligne ? j.statut.lieu : 'hors'}`, statutTexte(j.statut)));
  tete.append(img, texte);

  const infos = el('div', 'pr-infos');
  const info = (titre, ...valeur) => {
    const l = el('div', 'pp-ligne');
    l.append(el('span', 'pp-titre', titre), ...valeur);
    infos.append(l);
  };
  info('Statut', el('span', `pp-role ${j.role}`, j.role === 'admin' ? 'Admin' : 'Joueur'));
  const depuis = new Date(j.cree * 1000).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  info('Membre depuis', el('span', 'pp-valeur', depuis));
  if (j.clan) {
    const k = el('span', 'pp-valeur pr-clan');
    if (j.clan.image) {
      const e = el('img', 'pr-ecusson');
      e.src = adresse(base, j.clan.image);
      e.alt = '';
      k.append(e);
    }
    k.append(`[${j.clan.tag}] ${j.clan.nom}`);
    info('Clan', k);
  }

  // Ce qu'on peut faire, selon ce qui nous lie.
  const actions = el('div', 'pg-rang');
  const chemin = `/api/amis/${j.id}`;
  if (j.moi) {
    actions.append(el('p', 'pa-vide', 'C’est toi !'));
  } else if (j.lien === 'ami') {
    actions.append(bouton('Écrire', '', () => ctx.ecrire(j)));
    if (j.statut?.en_ligne) actions.append(bouton('Inviter dans le groupe', 'discret', () => ctx.social.inviter(j.id)));
    actions.append(sur('Retirer de mes amis', () => refaire(chemin, 'DELETE', `${j.pseudo} n’est plus ton ami.`)));
  } else if (j.lien === 'recue') {
    actions.append(
      bouton('Accepter sa demande', '', () => refaire(chemin, 'POST', `${j.pseudo} est ton ami.`)),
      bouton('Refuser', 'discret', () => refaire(chemin, 'DELETE')),
    );
  } else if (j.lien === 'envoyee') {
    actions.append(el('p', 'pa-vide', 'Demande envoyée.'), bouton('Annuler', 'discret', () => refaire(chemin, 'DELETE')));
  } else {
    actions.append(bouton('Ajouter en ami', '', () => refaire(chemin, 'POST', `Demande envoyée à ${j.pseudo}.`)));
  }

  corps.append(tete, infos, actions);
}
