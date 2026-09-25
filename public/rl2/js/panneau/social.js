// Connexion sociale en direct (serveur : `admin2/social.rs`).
//
// Ouverte tant que la page l'est, pour un joueur connecte. Elle tient a
// jour les amis et leur statut, le groupe et les invitations, et previent
// des nouveaux messages. Coupee, elle se reconnecte d'elle-meme, de plus en
// plus doucement.
//
// Evenements (`on`) : `change` (amis, groupe ou invitations ont bouge),
// `invitation`, `lancer`, `nouvelles`, `info`, `erreur`.

/** Attente avant de se reconnecter : 2 s, puis de plus en plus, 30 s au plus. */
const REPRISE = [2000, 4000, 8000, 15000, 30000];

export class Social {
  constructor(base) {
    this.url = `${base.replace(/^http/, 'ws')}/api/social`;
    this.moi = null;
    this.amis = new Map();
    this.groupe = null;
    this.invitations = [];
    this.ecoute = {};
    this.ws = null;
    this.actif = false;
    this.essais = 0;
    this.dernierLieu = '';
  }

  on(evt, fn) {
    (this.ecoute[evt] ||= []).push(fn);
  }

  _emet(evt, data) {
    for (const fn of this.ecoute[evt] || []) fn(data);
  }

  /** Ouvre la connexion (joueur connecte). Sans effet si elle l'est deja. */
  demarrer() {
    this.actif = true;
    if (this.ws) return;
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.essais = 0;
      if (this.dernierLieu) this.envoyer({ t: 'lieu', lieu: this.dernierLieu });
    };
    ws.onmessage = (e) => {
      try {
        this._recoit(JSON.parse(e.data));
      } catch {
        // Message illisible : on l'ignore.
      }
    };
    ws.onclose = () => {
      this.ws = null;
      if (!this.actif) return;
      const attente = REPRISE[Math.min(this.essais, REPRISE.length - 1)];
      this.essais += 1;
      setTimeout(() => this.actif && this.demarrer(), attente);
    };
  }

  /** Deconnexion du compte : on ferme et on oublie tout. */
  arreter() {
    this.actif = false;
    this.ws?.close();
    this.ws = null;
    this.amis.clear();
    this.groupe = null;
    this.invitations = [];
    this._emet('change');
  }

  envoyer(m) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  _recoit(m) {
    switch (m.t) {
      case 'etat':
        this.moi = m.moi;
        this.amis = new Map(m.amis.map((a) => [a.id, a]));
        this.groupe = m.groupe;
        this.invitations = m.invitations;
        this._emet('change');
        break;
      case 'amis':
        this.amis = new Map(m.amis.map((a) => [a.id, a]));
        this._emet('change');
        break;
      case 'ami':
        if (this.amis.has(m.ami.id)) this.amis.set(m.ami.id, m.ami);
        if (this.groupe) {
          this.groupe.membres = this.groupe.membres.map((x) => (x.id === m.ami.id ? m.ami : x));
        }
        this._emet('change');
        break;
      case 'groupe':
        this.groupe = m.groupe;
        this._emet('change');
        break;
      case 'invitation':
        this.invitations = [...this.invitations.filter((j) => j.id !== m.de.id), m.de];
        this._emet('change');
        this._emet('invitation', m.de);
        break;
      default:
        // lancer, nouvelles, info, erreur
        this._emet(m.t, m);
    }
  }

  // ---------------------------------------------------------- actions ---

  /** Ou en est la page : `menu`, `solo` ou `partie`. Envoye au changement. */
  lieu(l) {
    if (l === this.dernierLieu) return;
    this.dernierLieu = l;
    this.envoyer({ t: 'lieu', lieu: l });
  }

  inviter(id) {
    this.envoyer({ t: 'inviter', a: id });
  }

  repondre(de, oui) {
    this.invitations = this.invitations.filter((j) => j.id !== de);
    this.envoyer({ t: 'repondre', de, oui });
    this._emet('change');
  }

  quitter() {
    this.envoyer({ t: 'quitter' });
  }

  exclure(id) {
    this.envoyer({ t: 'exclure', qui: id });
  }

  passerChef(id) {
    this.envoyer({ t: 'chef', qui: id });
  }

  estChef() {
    return !!this.groupe && this.groupe.chef === this.moi;
  }

  /** Le chef vient d'entrer dans le salon `code` : le groupe le suit. */
  lancer(code) {
    if (this.estChef()) this.envoyer({ t: 'lancer', salon: code });
  }

  /** Amis en ligne d'abord (en partie, puis menus, puis solo), puis les
   *  autres ; par pseudo dans chaque lot. */
  amisTries() {
    const rang = (a) => (!a.statut.en_ligne ? 3 : { partie: 0, menu: 1, solo: 2 }[a.statut.lieu] ?? 1);
    return [...this.amis.values()].sort((a, b) => rang(a) - rang(b) || a.pseudo.localeCompare(b.pseudo));
  }
}

/** Statut d'un ami en quelques mots, pour l'infobulle et sa fiche. */
export function statutTexte(s) {
  if (!s?.en_ligne) return 'Hors ligne';
  if (s.lieu === 'partie') {
    if (!s.salon) return 'En partie';
    return s.prive ? `En partie privée (salon ${s.salon}) · tu peux le rejoindre` : `En partie · Occasionnel (serveur ${s.salon})`;
  }
  if (s.lieu === 'solo') return 'En ligne · joue en solo';
  return 'En ligne · dans les menus';
}
