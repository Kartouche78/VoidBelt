// Habillage sonore. Les bruits de jeu sont synthetises au vol ; le decompte,
// les commentaires, le souffle du boost et le crissement du drift viennent de
// pistes fournies, avec repli sur une version synthetisee si elles manquent.
//
// Trois bus independants (general, effets, musique) pour que les curseurs
// des parametres agissent vraiment, et un moteur qui suit la vitesse.

/** Pistes uniques, telechargees au demarrage et decodees a l'ouverture du
 *  contexte audio. */
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
    this.boostOn = false;
    this.boostHeld = 0;
  }

  /** Recupere les pistes sans attendre de geste : seul le decodage a besoin
   *  du contexte, pas le telechargement. */
  async preload() {
    await Promise.all(Object.entries(SOURCES).map(async ([name, url]) => {
      try {
        this.raw[name] = await (await fetch(url)).arrayBuffer();
      } catch {
        // Piste absente : on retombera sur la version synthetisee.
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
      }).catch(() => {});
    }
  }

  /** Lance une piste, en coupant la precedente du meme nom. `as` permet a
   *  plusieurs prises d'un meme evenement de se partager une seule voix. */
  play(name, volume = 1, as = name) {
    if (!this.ready || !this.clips[name]) return false;
    this.stop(as);
    const src = this.ctx.createBufferSource();
    src.buffer = this.clips[name];
    const g = this.ctx.createGain();
    g.gain.value = volume;
    src.connect(g).connect(this.sfx);
    src.start();
    this.voices[as] = { src, gain: g };
    src.onended = () => {
      if (this.voices[as]?.src === src) delete this.voices[as];
    };
    return true;
  }

  /** Joue une prise au hasard parmi celles qui ont pu etre decodees. */
  playAny(name, volume = 1) {
    const takes = Object.keys(this.clips).filter((k) => k.startsWith(`${name}#`));
    if (!takes.length) return false;
    return this.play(takes[Math.floor(Math.random() * takes.length)], volume, name);
  }

  /** Coupe une piste en fondu, pour ne pas claquer. */
  stop(name, seconds = 0.12) {
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

  /** Le navigateur exige un geste de l'utilisateur avant tout son. */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    const g = (out) => {
      const n = this.ctx.createGain();
      n.connect(out);
      return n;
    };
    this.master = g(this.ctx.destination);
    this.sfx = g(this.master);
    this.music = g(this.master);
    this._buildEngine();
    this._buildMusic();
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
    this.music.gain.setTargetAtTime((levels.music / 100) * 0.5, now, 0.05);
  }

  _noise(seconds) {
    const n = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i += 1) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    return buf;
  }

  _buildEngine() {
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = 60;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 420;
    const g = this.ctx.createGain();
    g.gain.value = 0;
    o.connect(f).connect(g).connect(this.sfx);
    o.start();
    this.engine = { osc: o, gain: g, filter: f };
  }

  /** Nappe tres simple : une basse et deux quintes qui respirent. */
  _buildMusic() {
    const notes = [55, 82.4, 110, 164.8];
    this.musicNodes = notes.map((hz, i) => {
      const o = this.ctx.createOscillator();
      o.type = i > 1 ? 'triangle' : 'sine';
      o.frequency.value = hz;
      const g = this.ctx.createGain();
      g.gain.value = 0;
      const lfo = this.ctx.createOscillator();
      lfo.frequency.value = 0.07 + i * 0.031;
      const depth = this.ctx.createGain();
      depth.gain.value = 0.11;
      lfo.connect(depth).connect(g.gain);
      o.connect(g).connect(this.music);
      o.start();
      lfo.start();
      return g;
    });
  }

  setMusic(on) {
    if (!this.ready) return;
    const now = this.ctx.currentTime;
    for (const g of this.musicNodes) g.gain.setTargetAtTime(on ? 0.12 : 0, now, on ? 1.2 : 0.4);
  }

  /** Regime moteur : `speed` normalise 0..1, `boost` pour le souffle. */
  setEngine(speed, boost, running) {
    if (!this.ready) return;
    const now = this.ctx.currentTime;
    const e = this.engine;
    e.osc.frequency.setTargetAtTime(58 + speed * 190, now, 0.08);
    e.filter.frequency.setTargetAtTime(360 + speed * 1500 + (boost ? 700 : 0), now, 0.08);
    e.gain.gain.setTargetAtTime(running ? 0.035 + speed * 0.05 + (boost ? 0.05 : 0) : 0, now, 0.12);
  }

  _blip({ freq = 440, to = freq, type = 'sine', dur = 0.2, vol = 0.4, delay = 0 }) {
    if (!this.ready) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(to, 1), t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  _burst(dur, vol, cutoff) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const s = this.ctx.createBufferSource();
    s.buffer = this._noise(dur);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    s.connect(f).connect(g).connect(this.sfx);
    s.start(t);
  }

  /** `force` vaut la vitesse d'impact renvoyee par le moteur. */
  hit(force) {
    const p = Math.min(force / 260, 1);
    this._blip({ freq: 190 + p * 120, to: 60, type: 'square', dur: 0.14, vol: 0.14 + p * 0.3 });
    this._burst(0.1, 0.1 + p * 0.22, 1400 + p * 2600);
  }

  wall(force) {
    const p = Math.min(force / 400, 1);
    this._blip({ freq: 120, to: 48, type: 'sine', dur: 0.16, vol: 0.1 + p * 0.2 });
  }

  pad(big) {
    this._blip({ freq: big ? 520 : 760, to: big ? 1180 : 1320, dur: big ? 0.3 : 0.14, vol: 0.28 });
    if (big) this._blip({ freq: 780, to: 1560, dur: 0.34, vol: 0.18, delay: 0.05 });
  }

  bump() {
    this._burst(0.16, 0.3, 900);
    this._blip({ freq: 90, to: 40, type: 'square', dur: 0.18, vol: 0.25 });
  }

  demo() {
    this._burst(0.55, 0.6, 2600);
    this._blip({ freq: 260, to: 30, type: 'sawtooth', dur: 0.5, vol: 0.4 });
  }

  /** Ovation du but : une prise au hasard parmi celles fournies. */
  goal() {
    if (this.playAny('goal', 0.9)) return;
    for (const [i, f] of [220, 277, 330, 440].entries()) {
      this._blip({ freq: f, to: f, type: 'sawtooth', dur: 1.1, vol: 0.22, delay: i * 0.06 });
    }
    this._burst(0.8, 0.28, 3200);
  }

  /** Entree en prolongation. */
  overtime() {
    if (this.playAny('overtime', 0.9)) return;
    for (const [i, f] of [330, 392, 494].entries()) {
      this._blip({ freq: f, to: f, type: 'sawtooth', dur: 0.5, vol: 0.26, delay: i * 0.14 });
    }
  }

  /** Arret devant la ligne. */
  save() {
    if (this.playAny('save', 0.85)) return;
    this._blip({ freq: 700, to: 1100, dur: 0.22, vol: 0.28 });
  }

  /** Piste du decompte, lancee a l'engagement. Ses quatre temps tombent a
   *  1, 2, 3 et 4 secondes, apres une seconde de silence : c'est ce que
   *  `COUNTDOWN` et `COUNTDOWN_LEAD` reproduisent cote moteur. Si elle
   *  manque, `count()` egrene ses bips a la place. */
  countdown() {
    return this.play('countdown', 0.85);
  }

  /** Bips seconde par seconde, uniquement si la piste manque : sinon ils
   *  viendraient se poser par-dessus elle. */
  count(n) {
    if (this.clips.countdown) return;
    if (n > 0) this._blip({ freq: 520, to: 520, dur: 0.12, vol: 0.3 });
    else this._blip({ freq: 880, to: 1320, dur: 0.35, vol: 0.34 });
  }

  boom() {
    this._blip({ freq: 320, to: 1400, type: 'sawtooth', dur: 0.4, vol: 0.2 });
  }

  whistle() {
    this._blip({ freq: 1700, to: 2100, dur: 0.25, vol: 0.2 });
  }

  end() {
    for (const [i, f] of [440, 330, 262].entries()) {
      this._blip({ freq: f, to: f, type: 'triangle', dur: 0.6, vol: 0.3, delay: i * 0.18 });
    }
  }

  click() {
    this._blip({ freq: 660, to: 880, dur: 0.06, vol: 0.18 });
  }
}
