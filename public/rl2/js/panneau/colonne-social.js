// Zones sociales de la colonne du panneau, tenues a jour en direct par
// `social.js` :
//
//   Groupe   ses membres (couronne sur le chef) et les invitations recues
//   Amis     en ligne d'abord, avec une pastille d'etat, puis hors ligne
//            par ordre alphabetique ; un clic ouvre la conversation, le
//            chiffre rouge compte ses messages non lus
//
// Les icones passent par `panneau._icone` : infobulles et manette comme
// les autres.

import { badge, el, pastille } from './outils.js';
import { statutTexte } from './social.js';

/** Pastille d'etat : `partie`, `menu`, `solo` ou `hors`. */
function etat(statut) {
  return statut?.en_ligne ? statut.lieu : 'hors';
}

/** Avatar d'un joueur pour la colonne, avec son etat, et une couronne
 *  pour le chef du groupe. */
function portrait(pn, j, chef = false) {
  const box = el('span', 'pn-ami-img');
  box.append(pastille(pn.base, j, 'pn-conv-img'), el('span', `pn-etat ${etat(j.statut)}`));
  if (chef) box.append(el('span', 'pn-couronne', '♛'));
  return box;
}

function separateur(texte) {
  const sep = el('div', 'pn-sep');
  sep.append(el('span', null, texte));
  return sep;
}

export function dessineZoneGroupe(pn, zone) {
  const s = pn.social;
  const g = s.groupe;
  zone.textContent = '';
  zone.hidden = !g && !s.invitations.length;
  if (zone.hidden) return;
  zone.append(separateur(g ? `Groupe · ${g.membres.length}` : 'Groupe'));
  for (const m of g?.membres || []) {
    const chef = m.id === g.chef;
    const titre = m.id === s.moi ? `${m.pseudo} (toi)` : m.pseudo;
    const aide = `${chef ? 'Chef du groupe · ' : ''}${statutTexte(m.statut)}`;
    const x = pn._icone('membre', titre, (b) => pn._ouvre_pop(b, 'groupe'), portrait(pn, m, chef), aide);
    x.dataset.cle = 'groupe';
    zone.append(x);
  }
  for (const j of s.invitations) {
    const x = pn._icone(
      'invit',
      `Invitation de ${j.pseudo}`,
      (b) => pn._ouvre_pop(b, `invit:${j.id}`, j),
      portrait(pn, j),
      'Il t’invite dans son groupe. Clique pour répondre.',
    );
    x.dataset.cle = `invit:${j.id}`;
    x.append(el('span', 'pn-badge', '?'));
    zone.append(x);
  }
}

export function dessineZoneAmis(pn, zone) {
  const tous = pn.social.amisTries();
  zone.textContent = '';
  zone.hidden = !tous.length;
  if (zone.hidden) return;
  const enLigne = tous.filter((a) => a.statut.en_ligne).length;
  zone.append(separateur(`Amis · ${enLigne}/${tous.length}`));
  for (const a of tous) {
    const cle = `conv:${a.id}`;
    const x = pn._icone('ami-col', a.pseudo, (b) => pn._ouvre_pop(b, cle, { type: 'ami', joueur: a }), portrait(pn, a), statutTexte(a.statut));
    x.dataset.cle = cle;
    if (!a.statut.en_ligne) x.classList.add('pn-hors');
    badge(x, pn.nonLus?.get(a.id) || 0);
    zone.append(x);
  }
}
