// Tableau de bord : score, chrono, jauge de boost, annonces.
//
// Tout est du DOM au-dessus du canvas : plus lisible qu'un rendu dans la
// scene, et ca reste net quel que soit le zoom de la camera.

const $ = (id) => document.getElementById(id);

/** Convertit une vitesse monde en km/h affichables, calee sur Rocket League. */
const KMH = 300 / 620;

export class Hud {
  constructor(geom) {
    this.countFrom = geom.countFrom;
    this.el = {
      blue: $('score-blue'),
      orange: $('score-orange'),
      clock: $('clock'),
      tag: $('clock-tag'),
      boost: $('boost-value'),
      arc: $('boost-arc'),
      speed: $('speed-value'),
      message: $('message'),
      sonic: $('sonic'),
      board: $('scoreboard'),
      lobby: $('lobby'),
      kickoff: $('btn-kickoff'),
      lobbyInfo: $('lobby-info'),
    };
    const r = this.el.arc.r.baseVal.value;
    this.circumference = 2 * Math.PI * r;
    this.el.arc.style.strokeDasharray = `${this.circumference}`;
    this.shown = '';
    this.wasPhase = -1;
    this.goUntil = 0;
  }

  /** `phase` suit l'enum du moteur ; `lobby` decrit le salon en ligne, ou
   *  vaut `null` en solo. */
  update(state, player, phase, boostMax, lobby = null) {
    const e = this.el;
    this._lobby(phase, lobby);
    e.blue.textContent = String(state[2] | 0);
    e.orange.textContent = String(state[3] | 0);

    const overtime = state[5] > 0.5;
    const t = Math.max(0, state[1]);
    e.clock.textContent = overtime
      ? '+' + fmt(0)
      : fmt(t);
    e.tag.textContent = overtime ? 'PROLONGATION' : '';
    e.tag.hidden = !overtime;
    e.clock.classList.toggle('urgent', !overtime && t <= 30);

    const pct = Math.max(0, Math.min(1, player.boost / boostMax));
    e.boost.textContent = String(Math.round(player.boost));
    e.arc.style.strokeDashoffset = String(this.circumference * (1 - pct));
    e.arc.classList.toggle('full', pct > 0.995);
    e.speed.textContent = String(Math.round(player.speed * KMH));
    e.sonic.hidden = !player.sonic;

    this._message(state, phase, player);
  }

  /** Avant le coup d'envoi en ligne, le bouton prend la place du score. */
  _lobby(phase, lobby) {
    const waiting = phase === 4 && !!lobby;
    this.el.board.hidden = waiting;
    this.el.lobby.hidden = !waiting;
    if (!waiting) return;
    const solo = lobby.players < 2;
    this.el.kickoff.disabled = !lobby.host || solo;
    this.el.kickoff.textContent = lobby.host
      ? (solo ? 'En attente d’un adversaire' : 'Lancer la partie')
      : 'En attente de l’hôte';
    this.el.lobbyInfo.textContent = `SALON ${lobby.code} · ${lobby.players}/${lobby.seats} · ECHAUFFEMENT`;
  }

  _message(state, phase, player) {
    // Le moteur bascule en jeu dans le meme pas ou le decompte atteint zero :
    // l'annonce de depart n'existe donc dans aucun etat, on la tient ici,
    // calee sur le dernier temps de la piste sonore.
    if (phase === 1 && this.wasPhase === 0) this.goUntil = performance.now() + 900;
    this.wasPhase = phase;

    let text = '';
    let tone = '';
    if (player.demo > 0) {
      // Arrondi a la seconde : un compteur au dixieme relancerait l'animation
      // du bandeau a chaque image.
      text = `DEMOLI &middot; ${Math.ceil(player.demo)}`;
      tone = 'warn';
    } else if (phase === 0) {
      // Le decompte demarre une seconde avant le premier chiffre, en
      // silence : rien a afficher tant qu'on est dans cette avance.
      const n = Math.ceil(state[4]);
      if (state[4] > this.countFrom) return this._set('', '');
      text = String(Math.max(1, n));
      tone = 'count';
    } else if (phase === 2) {
      // La balle dort dans la cage encaissee : son cote donne le buteur.
      const blue = state[6] > 836;
      text = 'BUT&nbsp;!';
      tone = blue ? 'blue' : 'orange';
    } else if (phase === 1 && performance.now() < this.goUntil) {
      text = 'C&rsquo;EST PARTI';
      tone = 'count';
    } else if (phase === 3) {
      const d = (state[2] | 0) - (state[3] | 0);
      text = d > 0 ? 'VICTOIRE' : d < 0 ? 'D&Eacute;FAITE' : '&Eacute;GALIT&Eacute;';
      tone = d > 0 ? 'blue' : 'orange';
    }
    this._set(text, tone);
  }

  _set(text, tone) {
    const key = text + tone;
    if (key === this.shown) return;
    this.shown = key;
    const m = this.el.message;
    m.innerHTML = text;
    m.className = tone;
    m.hidden = !text;
    if (text) {
      m.classList.remove('pop');
      void m.offsetWidth;
      m.classList.add('pop');
    }
  }
}

function fmt(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
