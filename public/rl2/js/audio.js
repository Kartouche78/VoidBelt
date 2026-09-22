// Habillage sonore. Tout ce qui s'entend vient d'un fichier : plus rien
// n'est synthetise au vol. Un evenement sans piste reste donc muet, et il
// suffira de deposer un .ogg pour lui rendre la voix.
//
// Deux bus (general, effets) pour que les curseurs des parametres agissent.

/** Pistes uniques. */
const CLIPS = {
  countdown: 'assets/audio/countdown.mp3',
  drift: 'assets/audio/drift.ogg',
  boostStart: 'assets/audio/boost_start.ogg',
  boostMax: 'assets/audio/boost_max.ogg',
  // Moteur, en trois temps : le demarreur a l'appui, le ralenti a l'arret,
  // la nappe en roulant. Les bruits de boite ne sont pas montes.
  engineStart: 'assets/audio/engine/start.ogg',
  engineCold: 'assets/audio/engine/cold.ogg',
  engineOn: 'assets/audio/engine/on.ogg',
  ballTouch: 'assets/audio/ball/touch.wav',
};

/** Evenements a plusieurs prises : on en tire une au hasard, pour qu'un match
 *  serre ne rejoue pas six fois la meme. Chaque prise est rangee sous
 *  `nom#rang`, et toutes partagent une voix : un second but coupe le
 *  commentaire du premier au lieu de s'empiler dessus. */
const VARIANTS = {
  goal: [
    'goal/SFX_GoalEvent_0001.ogg',
    'goal/VO_Champions_0001.ogg',
    'goal/VO_Champions_0012.ogg',
    'goal/VO_Champions_0015.ogg',
    'goal/VO_NeoTokyo_0003.ogg',
    'goal/VO_ScoreGoal_0001.ogg',
  ],
  save: [
    'save/VO_Champions_0006.ogg',
    'save/VO_Champions_0009.ogg',
    'save/VO_NeoTokyo_0004.ogg',
  ],
  overtime: ['overtime/VO_Champions_0003.ogg'],
};

/** Tout ce qu'il y a a telecharger, prises numerotees comprises. */
const SOURCES = { ...CLIPS };
for (const [name, takes] of Object.entries(VARIANTS)) {
  takes.forEach((file, i) => {
    SOURCES[`${name}#${i}`] = `assets/audio/${file}`;
  });
}

/** Secondes de boost tenu avant que la nappe ne remplace l'attaque.
 *  `boost_start` dure une seconde et s'est deja tue aux deux tiers ici. */
const BOOST_TAKEOVER = 0.55;

/** Vitesse au-dessous de laquelle on considere la voiture a l'arret. Une
 *  voiture qui roule au pas doit encore tourner au ralenti. */
const AU_POINT_MORT = 12;
/** Etirement de la nappe moteur entre l'arret et la vitesse maximale. Ce
 *  n'est pas une boite de vitesses, juste de quoi eviter la boucle plate. */
const RATE_BAS = 0.82;
const RATE_HAUT = 1.28;

/** Force d'un contact voiture-balle a plein regime. Une frappe lancee a la
 *  vitesse maximale en rend environ 720 ; on plafonne un peu en dessous,
 *  pour que les belles frappes sonnent toutes a fond. */
const FRAPPE_PLEINE = 650;
/** Voix qui se relaient pour les touches de balle : un dribble en enchaine
 *  plusieurs par seconde, et une voix unique les couperait l'une l'autre. */
const VOIX_BALLE = 4;

export class Audio {
  constructor(levels) {
    this.ctx = null;
    this.levels = levels;
    this.ready = false;
    this.raw = {};
    this.clips = {};
    this.voices = {};
    this.loops = {};
    /** Demandes arrivees avant que la piste ne soit prete. */
    this.waiting = {};
    this.boostOn = false;
    this.boostHeld = 0;
  }

  /** Recupere les pistes sans attendre de geste : seul le decodage a besoin
   *  du contexte, pas le telechargement. */
  async preload() {
    await Promise.all(Object.entries(SOURCES).map(async ([name, url]) => {
      try {
        const res = await fetch(url);
        if (res.ok) this.raw[name] = await res.arrayBuffer();
      } catch {
        // Piste absente : l'evenement restera muet.
      }
    }));
    this._decode();
  }

  _decode() {
    if (!this.ready) return;
    for (const [name, buf] of Object.entries(this.raw)) {
      if (this.clips[name]) continue;
      // `decodeAudioData` vide le tampon qu'on lui passe : on lui en donne
      // une copie, pour pouvoir redecoder si le contexte est recree.
      this.ctx.decodeAudioData(buf.slice(0)).then((b) => {
        this.clips[name] = b;
        this._catchUp(name);
      }).catch(() => {});
    }
  }

  /** Lance une piste reclamee avant d'etre prete, decalee du retard pris.
   *  Decoder un decompte de cinq secondes prend parfois plus longtemps que
   *  l'engagement lui-meme : sans ce rattrapage on ne l'entend pas du
   *  premier match, et l'habillage semble marcher une fois sur deux. */
  _catchUp(name) {
    for (const [as, want] of Object.entries(this.waiting)) {
      if (want.name !== name) continue;
      delete this.waiting[as];
      const late = this.ctx.currentTime - want.at;
      if (late < this.clips[name].duration) this._start(name, want.volume, as, late, want.rate ?? 1);
    }
  }

  _start(name, volume, as, offset = 0, rate = 1) {
    this.stop(as, 0.02);
    const src = this.ctx.createBufferSource();
    src.buffer = this.clips[name];
    if (rate !== 1) src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = volume;
    src.connect(g).connect(this.sfx);
    src.start(0, Math.max(0, offset));
    this.voices[as] = { src, gain: g };
    src.onended = () => {
      if (this.voices[as]?.src === src) delete this.voices[as];
    };
  }

  /** Lance une piste, en coupant la precedente du meme nom. `as` permet a
   *  plusieurs prises d'un meme evenement de se partager une seule voix.
   *  Ne rend `false` que si aucun fichier ne correspond. */
  play(name, volume = 1, as = name, rate = 1) {
    if (!this.ready) return false;
    if (!this.clips[name]) {
      // Telechargee mais pas encore decodee : on retient la demande.
      if (!this.raw[name]) return false;
      this.waiting[as] = { name, volume, at: this.ctx.currentTime, rate };
      return true;
    }
    this._start(name, volume, as, 0, rate);
    return true;
  }

  /** Joue une prise au hasard parmi celles qui ont pu etre recuperees. */
  playAny(name, volume = 1) {
    const takes = Object.keys(SOURCES).filter((k) => k.startsWith(`${name}#`) && this.raw[k]);
    if (!takes.length) return false;
    return this.play(takes[Math.floor(Math.random() * takes.length)], volume, name);
  }

  /** Coupe une piste en fondu, pour ne pas claquer. */
  stop(name, seconds = 0.12) {
    delete this.waiting[name];
    const v = this.voices[name];
    if (!v) return;
    delete this.voices[name];
    const t = this.ctx.currentTime;
    v.gain.gain.cancelScheduledValues(t);
    v.gain.gain.setValueAtTime(v.gain.gain.value, t);
    v.gain.gain.linearRampToValueAtTime(0, t + seconds);
    try {
      v.src.stop(t + seconds + 0.02);
    } catch {
      /* deja arretee */
    }
  }

  stopAll() {
    for (const name of Object.keys(this.voices)) this.stop(name);
    this.waiting = {};
    // Les boucles ne passent pas par `voices` : elles tournent en continu et
    // ne se referment que par leur volume.
    for (const name of Object.keys(this.loops)) this._loop(name, false, 0, 0, 0.12);
    this.boostOn = false;
    this.boostHeld = 0;
    // Le demarreur doit pouvoir reclaquer apres un arret general.
    this.revving = false;
    this.ballVoice = 0;
  }

  /** Ouvre ou ferme une piste qui tourne en boucle. Plutot que de la relancer
   *  a chaque fois, on la laisse tourner et on joue sur son volume : c'est ce
   *  qui permet a un crissement ou a un souffle de s'installer sans claquer. */
  _loop(name, on, volume, attack, release) {
    if (!this.ready || !this.clips[name]) return;
    // Tant qu'on ne l'a pas ouverte une fois, il n'y a rien a refermer.
    if (!on && !this.loops[name]) return;
    if (!this.loops[name]) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.clips[name];
      src.loop = true;
      const g = this.ctx.createGain();
      g.gain.value = 0;
      src.connect(g).connect(this.sfx);
      src.start();
      this.loops[name] = { src, gain: g };
    }
    const t = this.ctx.currentTime;
    this.loops[name].gain.gain.setTargetAtTime(on ? volume : 0, t, on ? attack : release);
  }

  /** Change la hauteur d'une boucle deja ouverte. Sans effet tant qu'elle
   *  n'a pas demarre : on ne cree pas de voix juste pour l'accorder. */
  _rate(name, value) {
    const l = this.loops[name];
    if (!l) return;
    l.src.playbackRate.setTargetAtTime(value, this.ctx.currentTime, 0.08);
  }

  /** Le navigateur exige un geste de l'utilisateur avant tout son. */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    const bus = (out) => {
      const n = this.ctx.createGain();
      n.connect(out);
      return n;
    };
    // Limiteur en sortie. Il ne se declenche qu'au-dessus de -1 dB, donc
    // il ne touche a rien en temps normal ; il est la pour qu'un bruitage
    // monte fort — la touche de balle, deja a pleine echelle dans son
    // fichier — sature proprement au lieu de craquer.
    const limiteur = this.ctx.createDynamicsCompressor();
    limiteur.threshold.value = -1;
    limiteur.knee.value = 0;
    limiteur.ratio.value = 20;
    limiteur.attack.value = 0.002;
    limiteur.release.value = 0.12;
    limiteur.connect(this.ctx.destination);
    this.master = bus(limiteur);
    this.sfx = bus(this.master);
    this.ready = true;
    this.applyLevels(this.levels);
    this._decode();
  }

  applyLevels(levels) {
    this.levels = levels;
    if (!this.ready) return;
    const now = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(levels.master / 100, now, 0.05);
    this.sfx.gain.setTargetAtTime(levels.sfx / 100, now, 0.05);
  }

  // ------------------------------------------------------------ signaux ---

  /** Fait taire les annonces en cours sans toucher aux boucles. La plus
   *  longue prise de but dure 5,5 s alors que la celebration en compte 4,6 :
   *  sans cela, l'ovation deborderait sur le decompte suivant. */
  hush(seconds = 0.35) {
    for (const name of Object.keys(this.voices)) this.stop(name, seconds);
    this.waiting = {};
  }

  /** Piste du decompte, lancee a l'engagement. Ses quatre temps tombent a
   *  1, 2, 3 et 4 secondes, apres une seconde de silence : c'est ce que
   *  `COUNTDOWN` et `COUNTDOWN_LEAD` reproduisent cote moteur. */
  countdown() {
    return this.play('countdown', 0.85);
  }

  /** Ovation du but : une prise au hasard parmi celles fournies. */
  goal() {
    this.playAny('goal', 0.9);
  }

  /** Arret devant la ligne. */
  save() {
    this.playAny('save', 0.85);
  }

  /** Entree en prolongation. */
  overtime() {
    this.playAny('overtime', 0.9);
  }

  /** Crissement du drift. `drift.ogg` tient un niveau constant sur cinq
   *  secondes : elle est faite pour tourner. */
  setDrift(on, force = 1) {
    this._loop('drift', on, 0.2 + Math.min(Math.max(force, 0), 1) * 0.4, 0.04, 0.1);
  }

  /** Souffle du boost : une attaque a l'appui, puis une nappe qui prend le
   *  relais si on reste dessus. `boost_start` s'eteint de lui-meme en une
   *  seconde, `boost_max` a un niveau plat fait pour boucler. On croise les
   *  deux une fois l'attaque tue, pour qu'a fond il n'en reste bien qu'une. */
  setBoost(on, dt = 0) {
    if (!this.ready) return;
    if (on && !this.boostOn) this.play('boostStart', 0.7);
    this.boostOn = on;
    this.boostHeld = on ? this.boostHeld + dt : 0;
    this._loop('boostMax', on && this.boostHeld > BOOST_TAKEOVER, 0.45, 0.18, 0.12);
  }

  /** Choc entre une voiture et la balle. Volume et hauteur suivent la
   *  force du contact : une caresse et une reprise pleine balle ne font pas
   *  le meme bruit, et une frappe forte sonne un peu plus grave. Les voix
   *  tournent, pour qu'un dribble ne se coupe pas a chaque touche.
   *
   *  Le gain depasse 1 sur les grosses frappes : le fichier est deja a
   *  pleine echelle, et c'est le limiteur de sortie qui tient le bord. */
  ballTouch(force) {
    const part = Math.min(Math.max(force, 0) / FRAPPE_PLEINE, 1);
    this.ballVoice = (this.ballVoice + 1) % VOIX_BALLE;
    this.play('ballTouch', 0.36 + part * 1.4, `ballTouch#${this.ballVoice}`, 1.12 - part * 0.2);
  }

  /** Moteur, en trois temps.
   *
   *  `cold` tourne tant que la voiture est a l'arret sans qu'on touche a
   *  l'accelerateur. Au premier appui, `start` claque une fois et `on`
   *  prend le relais, jusqu'au retour a l'arret pied leve. La hauteur de
   *  `on` monte avec la vitesse, faute de boite de vitesses.
   *
   *  `on` a false coupe tout : c'est ce qui fait taire le moteur pendant
   *  une celebration de but, ou hors match. */
  setEngine(on, speed = 0, throttle = 0, speedMax = 1) {
    if (!this.ready) return;
    if (!on) {
      this.revving = false;
      this._loop('engineCold', false, 0, 0, 0.2);
      this._loop('engineOn', false, 0, 0, 0.2);
      return;
    }
    const roule = speed > AU_POINT_MORT;
    const pousse = throttle > 0.05;
    // Le demarreur ne claque qu'une fois, a la reprise depuis l'arret.
    if (pousse && !this.revving) {
      this.play('engineStart', 0.55);
      this.revving = true;
    }
    if (!pousse && !roule) this.revving = false;

    const tourne = this.revving || roule;
    this._loop('engineCold', !tourne, 0.3, 0.12, 0.25);
    const part = Math.min(Math.max(speed / Math.max(speedMax, 1), 0), 1);
    this._loop('engineOn', tourne, 0.22 + part * 0.4, 0.08, 0.2);
    this._rate('engineOn', RATE_BAS + part * (RATE_HAUT - RATE_BAS));
  }
}
