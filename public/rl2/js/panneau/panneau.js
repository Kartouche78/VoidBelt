// Panneau lateral : Start a la manette, ² au clavier, a tout moment, meme
// en pleine partie (le jeu continue derriere, legerement floute).
//
// Une colonne d'icones, moins de 5 % de l'ecran : profil, ami, clan, menu
// du jeu, puis la messagerie. Chaque icone ouvre un pop-up colle au
// panneau, a la hauteur de l'icone cliquee, a la taille de son contenu.
//
// Reserve aux joueurs connectes : sans session, Start ne fait rien.

import { ICONES } from './icones.js';
import { dessineProfil } from './profil.js';

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export class Panneau {
  /** `base` : adresse de l'API. `hooks.menu()` ouvre le menu du jeu. */
  constructor(root, base, hooks) {
    this.base = base;
    this.hooks = hooks;
    this.compte = null;
    this.ouvert = false;
    this.pop = null;

    this.voile = el('div', 'pn-voile');
    this.voile.hidden = true;
    this.voile.onclick = () => this.fermer();
    this.barre = el('nav', 'pn-barre');
    this.barre.hidden = true;
    this.barre.setAttribute('aria-label', 'Panneau du joueur');
    this.popup = el('div', 'pn-pop');
    this.popup.hidden = true;
    root.append(this.voile, this.barre, this.popup);

    addEventListener('keydown', (e) => {
      if (this.ouvert && e.key === 'Escape') {
        e.stopPropagation();
        if (this.pop) this._ferme_pop();
        else this.fermer();
      }
    }, true);
  }

  api(chemin, opts = {}) {
    return fetch(`${this.base}${chemin}`, { cache: 'no-store', credentials: 'include', ...opts });
  }

  /** Relit la session : qui est connecte, s'il y a quelqu'un. */
  async actualiser() {
    try {
      const res = await this.api('/api/auth/moi');
      const moi = res.ok ? await res.json() : null;
      this.compte = moi?.connecte ? moi.compte : null;
    } catch {
      this.compte = null;
    }
    return this.compte;
  }

  async basculer() {
    if (this.ouvert) {
      this.fermer();
      return;
    }
    if (!(await this.actualiser())) return;
    this._dessine();
    this.ouvert = true;
    this.barre.hidden = false;
    this.voile.hidden = false;
    this._vise(this.barre.querySelector('button'));
  }

  fermer() {
    this._ferme_pop();
    this.ouvert = false;
    this.barre.hidden = true;
    this.voile.hidden = true;
    document.activeElement?.blur?.();
  }

  _dessine() {
    const b = this.barre;
    b.textContent = '';
    const icone = (id, titre, faire, contenu) => {
      const x = el('button', `pn-icone pn-${id}`);
      x.type = 'button';
      x.title = titre;
      x.setAttribute('aria-label', titre);
      if (contenu) x.append(contenu);
      else x.innerHTML = ICONES[id];
      x.onclick = () => faire(x);
      b.append(x);
      return x;
    };

    icone('profil', 'Profil', (x) => this._ouvre_pop(x, 'profil'));
    icone('ami', 'Ajouter un ami', (x) => this._ouvre_pop(x, 'ami'));
    // Clan : son image s'il en a une, sinon son tag ; sans clan, rejoindre.
    const clan = this.compte.clan;
    let dansClan = null;
    if (clan?.image) {
      dansClan = el('img', 'pn-clan-img');
      dansClan.src = clan.image;
      dansClan.alt = clan.tag || '';
    } else if (clan?.tag) {
      dansClan = el('span', 'pn-clan-tag', clan.tag);
    }
    icone('clan', clan ? `Clan ${clan.tag || ''}`.trim() : 'Rejoindre un clan', (x) => this._ouvre_pop(x, 'clan'), dansClan);
    icone('menu', 'Menu du jeu', () => {
      this.fermer();
      this.hooks.menu?.();
    });

    // Messagerie : un separateur, la demi-icone pour ecrire, puis les
    // personnes avec qui on parle.
    const sep = el('div', 'pn-sep');
    sep.append(el('span', null, 'Messages'));
    b.append(sep);
    const ecrire = icone('message', 'Nouveau message', (x) => this._ouvre_pop(x, 'message'));
    ecrire.classList.add('pn-demi');
    this.fil = el('div', 'pn-fil');
    b.append(this.fil);
  }

  /** Pop-up colle au panneau, a la hauteur de l'icone `x`. */
  _ouvre_pop(x, quoi) {
    if (this.pop === quoi) {
      this._ferme_pop();
      return;
    }
    this.pop = quoi;
    for (const i of this.barre.querySelectorAll('.pn-icone')) i.classList.toggle('actif', i === x);
    const p = this.popup;
    p.textContent = '';
    const fermer = el('button', 'pn-pop-fermer');
    fermer.type = 'button';
    fermer.innerHTML = ICONES.fermer;
    fermer.setAttribute('aria-label', 'Fermer');
    fermer.onclick = () => this._ferme_pop();
    const corps = el('div', 'pn-pop-corps');
    p.append(fermer, corps);

    if (quoi === 'profil') {
      dessineProfil(corps, this.compte, (c, o) => this.api(c, o), this.base, (c) => {
        this.compte = { ...this.compte, ...c };
      }, () => this._deconnecter());
    } else {
      const textes = {
        ami: ['Ajouter un ami', 'Bientôt : chercher un joueur par son pseudo et lui envoyer une demande.'],
        clan: ['Clans', 'Bientôt : rejoindre un clan, ou créer le tien avec son tag et son image.'],
        message: ['Nouveau message', 'Bientôt : écrire à un ami. Vos conversations apparaîtront sous la barre « Messages ».'],
      }[quoi];
      corps.append(el('h3', 'pp-titre-pop', textes[0]), el('p', 'pp-bientot', textes[1]));
    }
    p.hidden = false;
    // Le haut du pop-up s'aligne sur l'icone ; il remonte s'il deborderait.
    const haut = x.getBoundingClientRect().top;
    p.style.top = `${Math.max(8, Math.min(haut, innerHeight - p.offsetHeight - 8))}px`;
  }

  _ferme_pop() {
    this.pop = null;
    this.popup.hidden = true;
    for (const i of this.barre.querySelectorAll('.pn-icone')) i.classList.remove('actif');
  }

  async _deconnecter() {
    await this.api('/api/auth/deconnexion', { method: 'POST' }).catch(() => {});
    this.compte = null;
    this.fermer();
  }

  // -------------------------------------------------------- manette ---

  _vise(x) {
    for (const i of this.barre.querySelectorAll('.pn-vise')) i.classList.remove('pn-vise');
    if (!x) return;
    this.cible = x;
    x.classList.add('pn-vise');
    x.focus({ preventScroll: true });
  }

  /** Haut et bas parcourent les icones, A ouvre, B referme. */
  navigate(pulse) {
    if (!this.ouvert || !pulse) return;
    const icones = [...this.barre.querySelectorAll('button')];
    const i = Math.max(0, icones.indexOf(this.cible));
    if (pulse.y) this._vise(icones[(i + pulse.y + icones.length) % icones.length]);
    if (pulse.ok) this.cible?.click();
    if (pulse.back) {
      if (this.pop) this._ferme_pop();
      else this.fermer();
    }
  }
}
