// Pop-ups du groupe : les actions sur un ami (inviter, rejoindre sa
// partie), le groupe lui-meme, et une invitation recue.
//
// Les actions partent par la connexion sociale (`ctx.social`) ; la
// reponse revient en direct et redessine le pop-up ouvert.
//
// `ctx` : { api, base, social, rejoindre(code), voirProfil(id), change() }.

import { bouton, el, pastille, sur } from './outils.js';
import { statutTexte } from './social.js';

function tete(base, j, sous) {
  const t = el('div', 'pc-tete');
  const texte = el('div', 'pa-texte');
  texte.append(el('h3', 'pp-titre-pop', j.pseudo), el('span', `pa-sous pg-statut ${j.statut?.en_ligne ? j.statut.lieu : 'hors'}`, sous));
  t.append(pastille(base, j), texte);
  return t;
}

/** Ce qu'on peut faire avec un ami, au-dessus de sa conversation :
 *  l'inviter, rejoindre sa partie, voir son profil. */
export function actionsAmi(ctx, ami) {
  const { social } = ctx;
  const s = ami.statut || {};
  const dansMonGroupe = !!social.groupe?.membres.some((m) => m.id === ami.id);
  const actions = el('div', 'pg-rang');
  // Il joue en ligne : le rejoindre passe en premier, bien visible.
  if (s.salon) {
    const texte = s.prive ? 'Rejoindre sa partie privée' : 'Rejoindre sa partie';
    actions.append(bouton(texte, '', () => ctx.rejoindre(s.salon)));
  }
  if (s.en_ligne && !dansMonGroupe) {
    actions.append(bouton('Inviter dans le groupe', 'discret', () => social.inviter(ami.id)));
  }
  actions.append(bouton('Profil', 'discret', () => ctx.voirProfil(ami.id)));
  return actions;
}

/** Le groupe : ses membres, les amis a inviter, et le depart. */
export function dessineGroupe(box, ctx) {
  const { social, base } = ctx;
  const g = social.groupe;
  box.textContent = '';
  box.classList.add('pa-large');
  if (!g) {
    box.append(el('h3', 'pp-titre-pop', 'Groupe'), el('p', 'pa-vide', 'Tu n’es dans aucun groupe. Invite un ami en ligne depuis la colonne.'));
    return;
  }
  const chef = social.estChef();
  const nomChef = g.membres.find((m) => m.id === g.chef)?.pseudo || 'le chef';
  box.append(
    el('h3', 'pp-titre-pop', `Groupe · ${g.membres.length}`),
    el('p', 'pa-vide', chef
      ? 'Tu es le chef : quand tu entres dans un serveur Occasionnel, tout le groupe te suit, dans ton équipe.'
      : `En attente de ${nomChef} : quand il lance une partie, tu le suis automatiquement, dans son équipe.`),
  );

  const liste = el('div', 'pa-liste');
  for (const m of g.membres) {
    const l = el('div', 'pa-ligne');
    const texte = el('div', 'pa-texte');
    const nom = m.id === social.moi ? `${m.pseudo} (toi)` : m.pseudo;
    texte.append(el('span', 'pa-nom', m.id === g.chef ? `♛ ${nom}` : nom), el('span', 'pa-sous', statutTexte(m.statut)));
    const actions = el('div', 'pa-actions');
    if (chef && m.id !== social.moi) {
      actions.append(
        sur('Chef', () => social.passerChef(m.id)),
        sur('Exclure', () => social.exclure(m.id)),
      );
    }
    l.append(pastille(base, m), texte, actions);
    liste.append(l);
  }
  box.append(liste);

  // Amis en ligne qui ne sont pas encore la.
  const dedans = new Set(g.membres.map((m) => m.id));
  const libres = social.amisTries().filter((a) => a.statut.en_ligne && !dedans.has(a.id));
  if (libres.length) {
    const s = el('div', 'pa-section');
    s.append(el('span', 'pp-titre', 'Inviter'));
    const l = el('div', 'pa-liste');
    for (const a of libres) {
      const ligne = el('div', 'pa-ligne');
      const actions = el('div', 'pa-actions');
      actions.append(bouton('Inviter', '', () => social.inviter(a.id)));
      ligne.append(pastille(base, a), el('span', 'pa-nom', a.pseudo), actions);
      l.append(ligne);
    }
    s.append(l);
    box.append(s);
  }
  const fin = el('div', 'pp-rang pg-fin');
  fin.append(sur('Quitter le groupe', () => social.quitter()));
  box.append(fin);
}

/** Une invitation recue : accepter ou refuser. */
export function dessineInvitation(box, ctx, de) {
  const { social } = ctx;
  box.textContent = '';
  const rang = el('div', 'pp-rang');
  rang.append(
    bouton('Accepter', '', () => social.repondre(de.id, true)),
    bouton('Refuser', 'discret', () => social.repondre(de.id, false)),
  );
  box.append(
    tete(ctx.base, de, statutTexte(de.statut)),
    el('p', 'pa-vide', `${de.pseudo} t’invite dans son groupe. Accepter te fait quitter ton groupe actuel.`),
    rang,
  );
}
