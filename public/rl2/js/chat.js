// Messagerie de partie et tchat rapide, sur le modele de Rocket League.
//
// Une premiere direction ouvre un groupe de quatre messages, affiche a
// gauche de l'ecran ; la meme direction, ou une autre, en choisit un. Le
// message s'affiche alors dans une bulle, entre la voiture qui parle et son
// pseudo, le temps de quelques secondes.
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
export class Chat {
  /** `envoi(groupe, choix)` part au serveur quand on joue en ligne. Dans
   *  ce cas le message n'est pas affiche tout de suite : il revient par le
   *  salon, comme celui des autres, et tout le monde lit le meme ordre.
   *  `bulle(siege, texte)` affiche le message au-dessus de la voiture. */
  constructor(envoi, bulle) {
    this.envoi = envoi;
    this.bulle = bulle;
    this.quick = document.getElementById('chat-quick');
    this.groupe = null;
    this.jusqua = 0;
  }

  /** Message rapide recu du salon : le siege de l'auteur, puis les deux
   *  directions. */
  recu(siege, g, m) {
    const texte = QUICK[g]?.msg[m];
    if (texte && siege >= 0) this.bulle(siege, texte);
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
      // En ligne, c'est le retour du serveur qui posera la bulle. En solo
      // le joueur occupe toujours le premier siege.
      if (texte && !this.envoi?.(groupe, dir)) this.bulle(0, texte);
    }
    this._paintQuick();
  }

  /** Referme le groupe sans rien envoyer. */
  cancel() {
    if (!this.groupe) return;
    this.groupe = null;
    this._paintQuick();
  }

  /** Referme un groupe reste ouvert trop longtemps. A chaque image. */
  update(now) {
    if (this.groupe && now > this.jusqua) {
      this.groupe = null;
      this._paintQuick();
    }
  }

  /** Referme le groupe : entre deux matchs, on repart de zero. */
  clear() {
    this.groupe = null;
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
}
