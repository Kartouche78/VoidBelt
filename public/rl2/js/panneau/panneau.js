// Panneau lateral : Start a la manette, ² au clavier, a tout moment, meme
// en pleine partie (le jeu continue derriere, legerement floute).
//
// Une colonne d'icones, moins de 5 % de l'ecran : profil, amis, clan, puis
// la messagerie (nouveau message, discussion du clan, conversations).
// Chaque icone ouvre un pop-up colle au panneau, a la hauteur de l'icone
// cliquee, a la taille de son contenu.
//
// Reserve aux joueurs connectes : sans session, Start ne fait rien. Panneau
// ferme, une pastille previent des messages et demandes en attente.

import { dessineAmis } from './amis.js';
import { dessineClan } from './clan.js';
import { dessineConversation } from './conversation.js';
import { ICONES } from './icones.js';
import { dessineNouveau, entreeNeuve, entreesFil } from './messages.js';
import { adresse, el } from './outils.js';
import { dessineProfil } from './profil.js';

/** Ce que fait chaque icone, dit dans son infobulle. */
const AIDES = {
  profil: 'Ton avatar, ton pseudo et ton compte.',
  ami: 'Chercher un joueur par son pseudo, répondre aux demandes, voir tes amis.',
  clan: 'Rejoindre un clan, ou fonder le tien avec son tag et son écusson.',
  clanMembre: 'Ton clan : ses membres, ses demandes et ses réglages.',
  message: 'Écrire à un ami. Vos conversations s’alignent juste en dessous.',
};

/** Relecture des nouvelles : panneau ouvert (colonne), ferme (pastille). */
const RYTHME_OUVERT = 8000;
const RYTHME_FERME = 20000;

export class Panneau {
  /** `base` : adresse de l'API. */
  constructor(root, base) {
    this.base = base;
    this.compte = null;
    this.ouvert = false;
    this.pop = null;
    this.arret = null;

    this.voile = el('div', 'pn-voile');
    this.voile.hidden = true;
    this.voile.onclick = () => this.fermer();
    this.barre = el('nav', 'pn-barre');
    this.barre.hidden = true;
    this.barre.setAttribute('aria-label', 'Panneau du joueur');
    this.popup = el('div', 'pn-pop');
    this.popup.hidden = true;
    this.bulle = el('div', 'pn-bulle');
    this.bulle.hidden = true;
    this.bulle.setAttribute('role', 'tooltip');
    // Pastille des nouvelles, panneau ferme : un clic ouvre le panneau.
    this.alerte = el('button', 'pn-alerte');
    this.alerte.type = 'button';
    this.alerte.hidden = true;
    this.alerte.onclick = () => this.basculer();
    root.append(this.voile, this.barre, this.popup, this.bulle, this.alerte);

    // Le pop-up change de taille (liste chargee, message envoye) : il
    // reste aligne sur son icone sans deborder de l'ecran.
    new ResizeObserver(() => this._place()).observe(this.popup);

    addEventListener('keydown', (e) => {
      if (this.ouvert && e.key === 'Escape') {
        e.stopPropagation();
        if (this.pop) this._ferme_pop();
        else this.fermer();
      }
    }, true);

    this.actualiser().then((c) => c && this._veiller());
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
    this.ouvert = true;
    this._dessine();
    this.barre.hidden = false;
    this.voile.hidden = false;
    this.alerte.hidden = true;
    this._vise(this.barre.querySelector('button'));
    this._veiller();
  }

  fermer() {
    this._cache_bulle();
    this._ferme_pop();
    this.ouvert = false;
    this.barre.hidden = true;
    this.voile.hidden = true;
    document.activeElement?.blur?.();
    this._veiller();
  }

  /** Ce que les pop-ups recoivent pour parler au serveur et au panneau. */
  _ctx() {
    return {
      api: (c, o) => this.api(c, o),
      base: this.base,
      moi: this.compte?.id,
      change: () => this._nouvelles(),
      // Clan rejoint, quitte, ecusson change : l'icone du clan suit.
      clanChange: async () => {
        await this.actualiser();
        if (this.compte) this._dessine();
      },
      ecrire: (joueur) => this._discuter({ type: 'ami', joueur }),
      discuter: (clan) => this._discuter({ type: 'clan', clan }),
    };
  }

  /** Une icone de la colonne, avec son infobulle. */
  _icone(id, titre, faire, contenu, aide) {
    const x = el('button', `pn-icone pn-${id}`);
    x.type = 'button';
    x.setAttribute('aria-label', `${titre}. ${aide}`);
    x.dataset.titre = titre;
    x.dataset.aide = aide;
    // La souris deplace le meme repere que la manette : une seule icone
    // visee a la fois.
    x.onmouseenter = () => this._vise(x);
    x.onmouseleave = () => this._cache_bulle();
    x.onfocus = () => this._montre_bulle(x);
    x.onblur = () => this._cache_bulle();
    if (contenu) x.append(contenu);
    else x.innerHTML = ICONES[id];
    x.onclick = () => faire(x);
    return x;
  }

  _dessine() {
    const b = this.barre;
    b.textContent = '';
    const i = (id, titre, faire, contenu, aide = AIDES[id]) => {
      const x = this._icone(id, titre, faire, contenu, aide);
      b.append(x);
      return x;
    };

    i('profil', 'Profil', (x) => this._ouvre_pop(x, 'profil'));
    i('ami', 'Amis', (x) => this._ouvre_pop(x, 'ami'));
    // Clan : son ecusson s'il en a un, sinon son tag ; sans clan, rejoindre.
    const clan = this.compte.clan;
    let dansClan = null;
    if (clan?.image) {
      dansClan = el('img', 'pn-clan-img');
      dansClan.src = adresse(this.base, clan.image);
      dansClan.alt = clan.tag || '';
    } else if (clan?.tag) {
      dansClan = el('span', 'pn-clan-tag', clan.tag);
    }
    i('clan', clan ? `Clan ${clan.tag}` : 'Rejoindre un clan', (x) => this._ouvre_pop(x, 'clan'), dansClan, clan ? AIDES.clanMembre : AIDES.clan);

    // Messagerie : un separateur, la demi-icone pour ecrire, puis les
    // conversations.
    const sep = el('div', 'pn-sep');
    sep.append(el('span', null, 'Messages'));
    b.append(sep);
    const ecrire = i('message', 'Nouveau message', (x) => this._ouvre_pop(x, 'message'));
    ecrire.classList.add('pn-demi');
    this.fil = el('div', 'pn-fil');
    b.append(this.fil);

    // Redessine avec un pop-up ouvert : son icone reste marquee.
    const ouverte = this.pop && !this.pop.startsWith('conv:') && b.querySelector(`.pn-${this.pop}`);
    if (ouverte) {
      ouverte.classList.add('actif');
      this.ancre = ouverte;
    }
    this._nouvelles();
  }

  // ------------------------------------------------------ nouvelles ---

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

  // -------------------------------------------------------- pop-ups ---

  /** Ouvre le pop-up du profil, panneau compris. */
  async ouvrirProfil() {
    if (!this.ouvert) await this.basculer();
    const x = this.barre.querySelector('.pn-profil');
    if (x && this.pop !== 'profil') this._ouvre_pop(x, 'profil');
  }

  /** Infobulle a droite de l'icone : son nom, et a quoi elle sert. Elle
   *  s'efface quand un pop-up occupe deja cette place. */
  _montre_bulle(x) {
    if (this.pop || !this.ouvert) return;
    const b = this.bulle;
    b.textContent = '';
    b.append(el('strong', null, x.dataset.titre), el('span', null, x.dataset.aide));
    b.hidden = false;
    const r = x.getBoundingClientRect();
    b.style.top = `${Math.max(8, Math.min(r.top + r.height / 2 - b.offsetHeight / 2, innerHeight - b.offsetHeight - 8))}px`;
  }

  _cache_bulle() {
    this.bulle.hidden = true;
  }

  /** Pop-up colle au panneau, a la hauteur de l'icone `x`. */
  _ouvre_pop(x, quoi, cible) {
    this._cache_bulle();
    if (this.pop === quoi) {
      this._ferme_pop();
      return;
    }
    this.arret?.();
    this.arret = null;
    this.pop = quoi;
    this.ancre = x;
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
    const ctx = this._ctx();

    if (quoi === 'profil') {
      dessineProfil(corps, this.compte, ctx.api, this.base, (c) => {
        this.compte = { ...this.compte, ...c };
        dispatchEvent(new Event('vb-compte'));
      }, () => this._deconnecter());
    } else if (quoi === 'ami') {
      dessineAmis(corps, ctx);
    } else if (quoi === 'clan') {
      dessineClan(corps, ctx);
    } else if (quoi === 'message') {
      dessineNouveau(corps, ctx);
    } else if (quoi.startsWith('conv:')) {
      this.arret = dessineConversation(corps, ctx, cible);
    }
    p.hidden = false;
    this._place();
  }

  /** Le haut du pop-up s'aligne sur son icone ; il remonte s'il deborde. */
  _place() {
    const p = this.popup;
    if (p.hidden || !this.ancre?.isConnected) return;
    const haut = this.ancre.getBoundingClientRect().top;
    p.style.top = `${Math.max(8, Math.min(haut, innerHeight - p.offsetHeight - 8))}px`;
  }

  _ferme_pop() {
    this.arret?.();
    this.arret = null;
    // Une conversation neuve restee sans message quitte la colonne.
    if (this.neuve && this.pop === this.neuve.cle) {
      this.fil?.querySelector(`[data-cle="${this.neuve.cle}"]`)?.remove();
    }
    this.neuve = null;
    this.pop = null;
    this.popup.hidden = true;
    for (const i of this.barre.querySelectorAll('.pn-icone')) i.classList.remove('actif');
  }

  async _deconnecter() {
    await this.api('/api/auth/deconnexion', { method: 'POST' }).catch(() => {});
    this.compte = null;
    this.fermer();
    dispatchEvent(new Event('vb-compte'));
  }

  // -------------------------------------------------------- manette ---

  _vise(x) {
    for (const i of this.barre.querySelectorAll('.pn-vise')) i.classList.remove('pn-vise');
    if (!x) return;
    this.cible = x;
    x.classList.add('pn-vise');
    this._montre_bulle(x);
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

/** Petit chiffre rouge sur une icone ; rien a zero. */
function badge(x, n) {
  if (!x) return;
  x.querySelector('.pn-badge')?.remove();
  if (n > 0) x.append(el('span', 'pn-badge', n > 9 ? '9+' : String(n)));
}
