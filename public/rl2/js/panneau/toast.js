// Notifications en haut a gauche, par-dessus le jeu : une invitation de
// groupe (Accepter, Refuser), ou une phrase qui s'efface seule.
//
// Elles apparaissent partout, panneau ferme compris : une invitation doit
// se voir meme en pleine partie. Elle reste aussi dans la colonne du
// panneau, pour qui repond a la manette.

import { bouton, el, pastille } from './outils.js';

const DUREE_INFO = 4000;
const DUREE_INVITATION = 60000;

export class Toasts {
  constructor(root, base) {
    this.base = base;
    this.pile = el('div', 'tt-pile');
    this.pile.setAttribute('aria-live', 'polite');
    root.append(this.pile);
  }

  _pose(carte, duree) {
    this.pile.append(carte);
    const retirer = () => carte.remove();
    setTimeout(retirer, duree);
    return retirer;
  }

  /** Une phrase courte ; rouge si `ko`. */
  info(texte, ko = false) {
    this._pose(el('div', `tt-carte${ko ? ' ko' : ''}`, texte), DUREE_INFO);
  }

  /** Invitation de groupe de `de`. `repondre(oui)` part au serveur. */
  invitation(de, repondre) {
    this.pile.querySelector(`[data-de="${de.id}"]`)?.remove();
    const carte = el('div', 'tt-carte tt-invit');
    carte.dataset.de = de.id;
    const texte = el('div', 'pa-texte');
    texte.append(el('strong', null, de.pseudo), el('span', 'pa-sous', 't’invite dans son groupe'));
    const actions = el('div', 'pp-rang');
    let retirer = () => {};
    actions.append(
      bouton('Accepter', '', () => {
        repondre(true);
        retirer();
      }),
      bouton('Refuser', 'discret', () => {
        repondre(false);
        retirer();
      }),
    );
    const haut = el('div', 'tt-haut');
    haut.append(pastille(this.base, de), texte);
    carte.append(haut, actions);
    retirer = this._pose(carte, DUREE_INVITATION);
  }

  /** Retire l'invitation de `de` (repondue ailleurs). */
  oublier(id) {
    this.pile.querySelector(`[data-de="${id}"]`)?.remove();
  }
}
