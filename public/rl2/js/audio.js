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
      if (late < this.clips[name].duration) this._start(name, want.volume, as, late);
    }
  }

  _start(name, volume, as, offset = 0) {
    this.stop(as, 0.02);
    const src = this.ctx.createBufferSource();
    src.buffer = this.clips[name];
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
  play(name, volume = 1, as = name) {
    if (!this.ready) return false;
    if (!this.clips[name]) {
      // Telechargee mais pas encore decodee : on retient la demande.
      if (!this.raw[name]) return false;
      this.waiting[as] = { name, volume, at: this.ctx.currentTime };
      return true;
    }
    this._start(name, volume, as);
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
    this.master = bus(this.ctx.destination);
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
}
