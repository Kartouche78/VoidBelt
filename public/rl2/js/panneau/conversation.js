// Pop-up d'une conversation : avec un ami, ou la discussion du clan.
//
// Les nouveaux messages arrivent en redemandant ceux venus apres le
// dernier recu, toutes les 3 secondes tant que le pop-up est ouvert.
//
// `cible` : { type: 'ami', joueur } ou { type: 'clan', clan }.
// `ctx` : { api, base, moi, social, change() }. Rend la fonction qui
// arrete tout. Avec un ami, ses actions (inviter, rejoindre, profil)
// passent sous l'en-tete.

import { actionsAmi } from './groupe.js';
import { adresse, appel, el, messager, pastille, quand } from './outils.js';

const RYTHME = 3000;

export function dessineConversation(box, ctx, cible) {
  const { api, base, moi } = ctx;
  const clan = cible.type === 'clan';
  const chemin = clan ? '/api/clan/messages' : `/api/messages/${cible.joueur.id}`;
  let dernier = 0;
  let auteurPrecedent = null;
  let fini = false;

  // En-tete : avec qui l'on parle.
  const tete = el('div', 'pc-tete');
  if (clan) {
    const k = cible.clan;
    const ecu = k.image ? el('img', 'pa-avatar') : el('span', 'pa-avatar pa-initiale pc-tag', k.tag);
    if (k.image) {
      ecu.src = adresse(base, k.image);
      ecu.alt = '';
    }
    tete.append(ecu, el('h3', 'pp-titre-pop', `[${k.tag}] ${k.nom}`));
  } else {
    tete.append(pastille(base, cible.joueur), el('h3', 'pp-titre-pop', cible.joueur.pseudo));
  }

  const fil = el('div', 'pc-fil');
  const [msg, dire] = messager();

  // « Dis bonjour ! » tant que la conversation est vide.
  const vide = el('p', 'pc-annonce', clan ? 'Aucun message pour l’instant.' : 'Dis bonjour !');
  vide.hidden = true;
  fil.append(vide);

  const ajoute = (m) => {
    dernier = Math.max(dernier, m.id);
    vide.remove();
    // Annonce du clan : arrivee, depart, promotion.
    if (clan && !m.de) {
      fil.append(el('p', 'pc-annonce', m.texte));
      auteurPrecedent = null;
      return;
    }
    const auteur = clan ? m.de.id : m.de;
    const deMoi = auteur === moi;
    const bloc = el('div', `pc-msg ${deMoi ? 'moi' : 'lui'}`);
    if (clan && !deMoi && auteur !== auteurPrecedent) bloc.append(el('span', 'pc-auteur', m.de.pseudo));
    bloc.append(el('p', 'pc-bulle', m.texte), el('span', 'pc-quand', quand(m.cree)));
    fil.append(bloc);
    auteurPrecedent = auteur;
  };

  const suivre = async () => {
    if (fini) return;
    try {
      const d = await appel(api, `${chemin}?apres=${dernier}`);
      if (fini) return;
      const enBas = fil.scrollHeight - fil.scrollTop - fil.clientHeight < 40;
      const avant = dernier;
      for (const m of d.messages) ajoute(m);
      if (!clan) peutEcrire(d.ami);
      if (dernier !== avant) {
        if (enBas || avant === 0) fil.scrollTop = fil.scrollHeight;
        ctx.change();
      }
      if (avant === 0 && !d.messages.length) vide.hidden = false;
    } catch (err) {
      dire(err.message, false);
    }
  };

  // Saisie : Entree envoie.
  const champ = el('input', 'pp-champ');
  champ.type = 'text';
  champ.maxLength = 500;
  champ.placeholder = clan ? 'Écrire au clan…' : `Écrire à ${cible.joueur.pseudo}…`;
  champ.autocomplete = 'off';
  const envoyer = el('button', 'pp-bouton', 'Envoyer');
  envoyer.type = 'button';
  const partir = async () => {
    const texte = champ.value.trim();
    if (!texte) return;
    envoyer.disabled = true;
    try {
      await appel(api, chemin, 'POST', { texte });
      champ.value = '';
      dire('', true);
      await suivre();
      fil.scrollTop = fil.scrollHeight;
    } catch (err) {
      dire(err.message, false);
    }
    envoyer.disabled = false;
    champ.focus();
  };
  envoyer.onclick = partir;
  champ.onkeydown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      partir();
    }
  };
  const rang = el('div', 'pp-rang');
  rang.append(champ, envoyer);
  const plusAmis = el('p', 'pa-vide', 'Vous n’êtes plus amis : tu peux relire, plus répondre.');
  plusAmis.hidden = true;
  const peutEcrire = (ok) => {
    rang.hidden = !ok;
    plusAmis.hidden = ok;
  };

  box.textContent = '';
  box.classList.add('pc-conv');
  box.append(tete);
  if (!clan) box.append(actionsAmi(ctx, ctx.social.amis.get(cible.joueur.id) || cible.joueur));
  box.append(fil, plusAmis, rang, msg);
  suivre().then(() => champ.focus());
  const minuterie = setInterval(suivre, RYTHME);
  return () => {
    fini = true;
    clearInterval(minuterie);
  };
}
