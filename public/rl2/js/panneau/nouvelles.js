// Nouvelles du panneau : la messagerie (non-lus sur l'icone de chaque ami
// et sur celle du clan, alerte panneau ferme) et les zones sociales
// (groupe, amis). Ces methodes se greffent sur `Panneau` (voir la fin de
// `panneau.js`) : `this` est le panneau.

import { dessineZoneAmis, dessineZoneGroupe } from './colonne-social.js';
import { badge } from './outils.js';

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
    badge(this.barre.querySelector('.pn-clan'), (r.clan?.demandes || 0) + (r.clan?.non_lus || 0));
    this.nonLus = new Map(r.conversations.map((c) => [c.avec.id, c.non_lus]));
    for (const x of this.zoneAmis?.querySelectorAll('[data-cle^="conv:"]') || []) {
      badge(x, this.nonLus.get(Number(x.dataset.cle.slice(5))) || 0);
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
    if (p === 'groupe' || p.startsWith('invit:')) {
      const id = Number(p.split(':')[1]);
      const cible = this.social.invitations.find((j) => j.id === id);
      if (p !== 'groupe' && !cible) this._ferme_pop();
      else this._remplir(this.popup.querySelector('.pn-pop-corps'), p, cible);
    }
  }

  /** Ouvre une conversation, meme sans message encore : a cote de l'icone
   *  de l'ami (ou du clan), sinon a la place du pop-up ouvert. */
  _discuter(cible) {
    const clan = cible.type === 'clan';
    const cle = clan ? 'conv:clan' : `conv:${cible.joueur.id}`;
    if (this.pop === cle) return;
    const x = (clan ? this.barre.querySelector('.pn-clan') : this.zoneAmis?.querySelector(`[data-cle="${cle}"]`)) || this.ancre;
    this._ouvre_pop(x, cle, cible);
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
