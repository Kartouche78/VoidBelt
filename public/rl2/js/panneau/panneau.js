// Panneau lateral : Start a la manette, ² au clavier, a tout moment, meme
// en pleine partie (le jeu continue derriere, legerement floute).
//
// Une colonne d'icones, moins de 5 % de l'ecran : profil, recherche d'un
// joueur, amis, clan, le groupe, puis les amis et leur etat, en direct
// (`social.js`) : en ligne d'abord, hors ligne ensuite par ordre
// alphabetique. Un clic sur un ami ouvre votre conversation.
// Chaque icone ouvre un pop-up colle au panneau, a la hauteur de l'icone
// cliquee, a la taille de son contenu.
//
// Reserve aux joueurs connectes : sans session, Start ne fait rien. Panneau
// ferme, une pastille previent des messages et demandes en attente.

import { dessineAmis } from './amis.js';
import { dessineClan } from './clan.js';
import { dessineConversation } from './conversation.js';
import { dessineGroupe, dessineInvitation } from './groupe.js';
import { Nouvelles } from './nouvelles.js';
import { ICONES } from './icones.js';
import { adresse, el } from './outils.js';
import { dessineProfil } from './profil.js';
import { dessineRecherche } from './recherche.js';
import { Social } from './social.js';
import { Toasts } from './toast.js';

/** Ce que fait chaque icone, dit dans son infobulle. */
const AIDES = {
  profil: 'Ton avatar, ton pseudo et ton compte.',
  ami: 'Chercher un joueur par son pseudo, répondre aux demandes, voir tes amis.',
  clan: 'Rejoindre un clan, ou fonder le tien avec son tag et son écusson.',
  clanMembre: 'Ton clan : ses membres, ses demandes et ses réglages.',
  recherche: 'Trouver un joueur par son pseudo et voir son profil.',
};

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

    // En direct : amis, groupe, invitations, nouveaux messages.
    this.social = new Social(base);
    this.toasts = new Toasts(root, base);
    this.nonLus = new Map();
    this.social.on('change', () => this._social());
    this.social.on('nouvelles', () => this._nouvelles());
    this.social.on('invitation', (de) => this.toasts.invitation(de, (oui) => this.social.repondre(de.id, oui)));
    this.social.on('info', (m) => this.toasts.info(m.m));
    this.social.on('erreur', (m) => this.toasts.info(m.m, true));

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

    this.actualiser().then((c) => {
      if (!c) return;
      this._veiller();
      this.social.demarrer();
    });
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
    this.social.demarrer();
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
      social: this.social,
      // Rejoindre la partie d'un ami : `main.js` sait entrer dans un salon.
      rejoindre: (code) => {
        this.fermer();
        this.rejoindre?.(code);
      },
      discuter: (clan) => this._discuter({ type: 'clan', clan }),
      voirProfil: (id) => this._voir_profil(id),
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
    i('recherche', 'Rechercher un joueur', (x) => this._ouvre_pop(x, 'recherche'));
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

    // Le groupe, s'il y en a un, ou les invitations recues.
    this.zoneGroupe = el('div', 'pn-zone');
    b.append(this.zoneGroupe);

    // Les amis, en ligne d'abord : un clic ouvre la conversation.
    this.zoneAmis = el('div', 'pn-zone');
    b.append(this.zoneAmis);
    this._social();

    // Redessine avec un pop-up ouvert : son icone reste marquee.
    const ouverte = this.pop && !this.pop.includes(':') && b.querySelector(`.pn-${this.pop}`);
    if (ouverte) {
      ouverte.classList.add('actif');
      this.ancre = ouverte;
    }
    this._nouvelles();
  }

  // -------------------------------------------------------- pop-ups ---

  /** Ouvre le pop-up du profil, panneau compris. */
  async ouvrirProfil() {
    if (!this.ouvert) await this.basculer();
    const x = this.barre.querySelector('.pn-profil');
    if (x && this.pop !== 'profil') this._ouvre_pop(x, 'profil');
  }

  /** Ouvre le profil public d'un joueur, dans le pop-up de la recherche. */
  _voir_profil(id) {
    const x = this.barre.querySelector('.pn-recherche');
    if (!x) return;
    if (this.pop === 'recherche') this._remplir(this.popup.querySelector('.pn-pop-corps'), 'recherche', { id });
    else this._ouvre_pop(x, 'recherche', { id });
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
    this._remplir(corps, quoi, cible);
    p.hidden = false;
    this._place();
  }

  /** Contenu du pop-up `quoi`. */
  _remplir(corps, quoi, cible) {
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
    } else if (quoi === 'recherche') {
      dessineRecherche(corps, ctx, cible);
    } else if (quoi.startsWith('conv:')) {
      this.arret = dessineConversation(corps, ctx, cible);
    } else if (quoi === 'groupe') {
      dessineGroupe(corps, ctx);
    } else if (quoi.startsWith('invit:')) {
      dessineInvitation(corps, ctx, cible);
      this.toasts.oublier(cible.id);
    }
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
    this.pop = null;
    this.popup.hidden = true;
    for (const i of this.barre.querySelectorAll('.pn-icone')) i.classList.remove('actif');
  }

  async _deconnecter() {
    await this.api('/api/auth/deconnexion', { method: 'POST' }).catch(() => {});
    this.compte = null;
    this.social.arreter();
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

// Nouvelles, conversations et zones sociales : dans `nouvelles.js`.
for (const k of Object.getOwnPropertyNames(Nouvelles.prototype)) {
  if (k !== 'constructor') Object.defineProperty(Panneau.prototype, k, Object.getOwnPropertyDescriptor(Nouvelles.prototype, k));
}
