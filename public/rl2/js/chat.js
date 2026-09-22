// Messagerie de partie et tchat rapide, sur le modele de Rocket League.
//
// Une premiere direction ouvre un groupe de quatre messages, affiche a
// gauche de l'ecran ; la meme direction, ou une autre, en choisit un. Le
// message part alors dans le journal, en bas a gauche, ou il reste quelques
// secondes avant de s'effacer.
//
// Le vrai jeu range seize messages en quatre groupes, un par direction de
// la croix. Le detail des libelles n'est pas documente ailleurs que dans le
// jeu lui-meme : ceux d'ici sont donc de notre cru, et se changent en une
// ligne.

/** Quatre groupes de quatre. La cle exterieure ouvre, la cle interieure
 *  choisit : haut puis haut donne « LA CHANCE !! ». */
export const QUICK = {
  up: {
    nom: 'Reactions',
    msg: { up: 'LA CHANCE !!', left: 'Ooooh !', right: 'Incroyable !', down: 'De justesse !' },
  },
  left: {
    nom: 'Infos',
    msg: { up: 'Prends-la !', left: 'Je l’ai !', right: 'A toi !', down: 'Je defends' },
  },
  right: {
    nom: 'Compliments',
    msg: { up: 'Belle passe !', left: 'Quel arret !', right: 'Joli tir !', down: 'Bien joue !' },
  },
  down: {
    nom: 'Excuses',
    msg: { up: 'Ma faute...', left: 'Oups.', right: 'Pas de souci', down: 'Desole !' },
  },
};

const FLECHE = { up: '↑', left: '←', right: '→', down: '↓' };
const ORDRE = ['up', 'left', 'right', 'down'];

/** Temps laisse pour choisir dans un groupe ouvert, en secondes. */
const OUVERT = 3;
/** Duree de vie d'un message au journal, et nombre de lignes gardees. */
const VIE = 9;
const LIGNES = 5;

export class Chat {
  /** `envoi(groupe, choix)` part au serveur quand on joue en ligne. Dans
   *  ce cas le message n'est pas affiche tout de suite : il revient par le
   *  salon, comme celui des autres, et tout le monde lit le meme ordre. */
  constructor(envoi = null) {
    this.envoi = envoi;
    this.log = document.getElementById('chat-log');
    this.quick = document.getElementById('chat-quick');
    this.groupe = null;
    this.jusqua = 0;
    this.lignes = [];
    this.moi = 'Vous';
  }

  /** Message rapide recu du salon. `g` et `m` sont les deux directions. */
  recu(qui, g, m) {
    const texte = QUICK[g]?.msg[m];
    if (texte) this.say(qui || 'Joueur', texte);
  }

  /** Nom affiche pour les messages du joueur. */
  setName(nom) {
    this.moi = nom || 'Vous';
  }

  /** Une direction vient d'etre pressee. Ouvre un groupe, ou envoie. */
  pulse(dir, now) {
    if (!dir) return;
    if (!this.groupe) {
      this.groupe = dir;
      this.jusqua = now + OUVERT;
    } else {
      const groupe = this.groupe;
      this.groupe = null;
      const texte = QUICK[groupe]?.msg[dir];
      // En ligne, c'est le retour du serveur qui ecrira la ligne.
      if (texte && !this.envoi?.(groupe, dir)) this.say(this.moi, texte);
    }
    this._paintQuick();
  }

  /** Referme le groupe sans rien envoyer. */
  cancel() {
    if (!this.groupe) return;
    this.groupe = null;
    this._paintQuick();
  }

  /** Ajoute une ligne au journal. */
  say(qui, texte) {
    this.lignes.push({ qui, texte, ne: performance.now() / 1000 });
    if (this.lignes.length > LIGNES) this.lignes.shift();
    this._paintLog();
  }

  /** Efface ce qui a fait son temps. A appeler a chaque image. */
  update(now) {
    if (this.groupe && now > this.jusqua) {
      this.groupe = null;
      this._paintQuick();
    }
    const reste = this.lignes.filter((l) => now - l.ne < VIE);
    if (reste.length !== this.lignes.length) {
      this.lignes = reste;
      this._paintLog();
    }
  }

  /** Vide tout : entre deux matchs, la conversation ne se poursuit pas. */
  clear() {
    this.lignes = [];
    this.groupe = null;
    this._paintLog();
    this._paintQuick();
  }

  _paintQuick() {
    const el = this.quick;
    if (!el) return;
    el.hidden = !this.groupe;
    el.innerHTML = '';
    if (!this.groupe) return;
    const g = QUICK[this.groupe];
    const titre = document.createElement('div');
    titre.className = 'chat-groupe';
    titre.textContent = g.nom;
    el.append(titre);
    for (const dir of ORDRE) {
      const l = document.createElement('div');
      l.className = 'chat-choix';
      const f = document.createElement('b');
      f.textContent = FLECHE[dir];
      const t = document.createElement('span');
      t.textContent = g.msg[dir];
      l.append(f, t);
      el.append(l);
    }
  }

  _paintLog() {
    const el = this.log;
    if (!el) return;
    el.hidden = this.lignes.length === 0;
    el.innerHTML = '';
    for (const l of this.lignes) {
      const d = document.createElement('div');
      d.className = 'chat-ligne';
      const q = document.createElement('b');
      q.textContent = `${l.qui} :`;
      const t = document.createElement('span');
      t.textContent = l.texte;
      d.append(q, t);
      el.append(d);
    }
  }
}
