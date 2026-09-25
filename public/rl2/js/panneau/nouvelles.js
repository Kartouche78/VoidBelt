// Nouvelles du panneau : la messagerie (conversations sous « Messages »,
// pastilles de non-lus, alerte panneau ferme) et les zones sociales (groupe,
// amis en ligne). Ces methodes se greffent sur `Panneau` (voir la fin de
// `panneau.js`) : `this` est le panneau.

import { dessineZoneAmis, dessineZoneGroupe } from './colonne-social.js';
import { entreeNeuve, entreesFil } from './messages.js';
import { el } from './outils.js';

/** Relecture des nouvelles, en secours : la connexion sociale previent
 *  deja de chaque message, a l'instant. */
const RYTHME_OUVERT = 20000;
const RYTHME_FERME = 60000;

export class Nouvelles {
  /** Relit la messagerie : conversations de la colonne, pastilles. */
  async _nouvelles() {
    let r;
    try {
      const res = await this.api('/api/messagerie');
      if (!res.ok) return;
      r = await res.json();
    } catch {
      return;
    }
    const nonLus = (r.clan?.non_lus || 0) + r.conversations.reduce((n, c) => n + c.non_lus, 0);
    const demandes = r.demandes_amis + (r.clan?.demandes || 0);
    if (!this.ouvert) {
      const total = nonLus + demandes;
      this.alerte.hidden = !total;
      this.alerte.textContent = total > 9 ? '9+' : String(total);
      this.alerte.title = [
        nonLus && `${nonLus} message${nonLus > 1 ? 's' : ''} non lu${nonLus > 1 ? 's' : ''}`,
        demandes && `${demandes} demande${demandes > 1 ? 's' : ''} en attente`,
      ].filter(Boolean).join(' · ') + ' (Start ou ²)';
      return;
    }
    badge(this.barre.querySelector('.pn-ami'), r.demandes_amis);
    badge(this.barre.querySelector('.pn-clan'), r.clan?.demandes || 0);
    const entrees = entreesFil(r, this.base, this.compte?.id);
    // Une conversation neuve, sans message encore, reste en tete tant que
    // son pop-up est ouvert.
    if (this.neuve && this.pop === this.neuve.cle && !entrees.some((e) => e.cle === this.neuve.cle)) {
      entrees.unshift(this.neuve);
    }
    this._dessine_fil(entrees);
  }

  _entree(e) {
    const x = this._icone('conv', e.titre, (b) => this._ouvre_pop(b, e.cle, e.cible), e.contenu, e.aide);
    x.dataset.cle = e.cle;
    if (e.cle === 'conv:clan') x.classList.add('pn-conv-clan');
    badge(x, e.badge);
    return x;
  }

  /** Conversations sous « Messages ». */
  _dessine_fil(entrees) {
    if (!this.fil) return;
    const visee = this.cible?.dataset.cle;
    this.fil.textContent = '';
    for (const e of entrees) {
      const x = this._entree(e);
      this.fil.append(x);
      if (e.cle === this.pop) {
        x.classList.add('actif');
        this.ancre = x;
      }
      if (visee && e.cle === visee) {
        this.cible = x;
        x.classList.add('pn-vise');
      }
    }
  }

  /** Groupe et amis ont change : on redessine leurs zones, et le pop-up
   *  ouvert s'il parle d'eux. Le repere de la manette reste sur la meme
   *  icone. */
  _social() {
    if (!this.ouvert || !this.zoneAmis) return;
    const visee = this.cible?.dataset.cle;
    dessineZoneGroupe(this, this.zoneGroupe);
    dessineZoneAmis(this, this.zoneAmis);
    for (const x of this.barre.querySelectorAll('.pn-zone [data-cle]')) {
      if (x.dataset.cle === this.pop) {
        x.classList.add('actif');
        this.ancre = x;
      }
      if (visee && x.dataset.cle === visee) {
        this.cible = x;
        x.classList.add('pn-vise');
      }
    }
    const p = this.pop || '';
    if (p === 'groupe' || p.startsWith('ami:') || p.startsWith('invit:')) {
      const id = Number(p.split(':')[1]);
      const cible = p.startsWith('ami:') ? this.social.amis.get(id) : this.social.invitations.find((j) => j.id === id);
      if (p !== 'groupe' && !cible) this._ferme_pop();
      else this._remplir(this.popup.querySelector('.pn-pop-corps'), p, cible);
    }
  }

  /** Ouvre une conversation, meme sans message encore. */
  _discuter(cible) {
    const neuve = entreeNeuve(cible, this.base);
    if (this.pop === neuve.cle) return;
    let x = this.fil.querySelector(`[data-cle="${neuve.cle}"]`);
    if (x) {
      this.neuve = null;
    } else {
      x = this._entree(neuve);
      this.fil.prepend(x);
      this.neuve = neuve;
    }
    this._ouvre_pop(x, neuve.cle, cible);
  }

  /** Relit les nouvelles regulierement : souvent panneau ouvert, plus
   *  rarement ferme (pour la pastille). */
  _veiller() {
    clearInterval(this.veille);
    if (!this.compte) {
      this.alerte.hidden = true;
      return;
    }
    this.veille = setInterval(() => this._nouvelles(), this.ouvert ? RYTHME_OUVERT : RYTHME_FERME);
    if (!this.ouvert) this._nouvelles();
  }

}

/** Petit chiffre rouge sur une icone ; rien a zero. */
function badge(x, n) {
  if (!x) return;
  x.querySelector('.pn-badge')?.remove();
  if (n > 0) x.append(el('span', 'pn-badge', n > 9 ? '9+' : String(n)));
}
