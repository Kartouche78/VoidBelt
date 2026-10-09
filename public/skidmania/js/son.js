// Sons synthetises : moteur, crissement des pneus, boost, bips de course.
// Rien a telecharger ; le contexte audio ne demarre qu'apres une touche.

import { S } from './moteur.js';
import { EngineLive } from './moteur-son.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Les familles de sons, chacune avec son volume dans les Parametres. */
export const PISTES = [
  { id: 'moteur', label: 'Moteur' },
  { id: 'pneus', label: 'Crissement des pneus' },
  { id: 'boost', label: 'Boost' },
  { id: 'vent', label: 'Vent' },
  { id: 'chocs', label: 'Chocs contre les murets' },
  { id: 'course', label: 'Bips de course' },
];

function noiseBuffer(ctx) {
  const b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
    /** Parametres ouverts : tout le son du jeu se tait. */
    this.enPause = false;
    // le generateur de la Creation, pilote par la boite du moteur Rust
    this.loops = new EngineLive();
    // onglet cache : tout le son s'arrete (le contexte audio est suspendu),
    // et reprend au retour
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) this.ctx.suspend();
      else this.ctx.resume();
    });
    this.dernier = 0;
    this.volume = 0.55;
    /** Volume de chaque famille, 0..1. */
    this.niveaux = Object.fromEntries(PISTES.map((p) => [p.id, 1]));
    this.pistes = {};
  }

  /** A appeler depuis un geste du joueur. */
  start() {
    if (this.ctx) {
      this.ctx.resume();
      return;
    }
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.niveauGeneral();
    this.master.connect(ctx.destination);
    for (const p of PISTES) {
      this.pistes[p.id] = ctx.createGain();
      this.pistes[p.id].gain.value = this.niveaux[p.id];
      this.pistes[p.id].connect(this.master);
    }
    const noise = noiseBuffer(ctx);

    // moteur : deux oscillateurs desaccordes dans un passe-bas
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    this.engLp = lp;
    this.osc = ['sawtooth', 'square'].map((type, i) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = 60;
      const g = ctx.createGain();
      g.gain.value = i ? 0.25 : 0.5;
      o.connect(g).connect(lp);
      o.start();
      return o;
    });
    lp.connect(this.engGain).connect(this.pistes.moteur);

    // crissement : bruit filtre en bande etroite
    const loop = (piste, q, f, type = 'bandpass') => {
      const src = ctx.createBufferSource();
      src.buffer = noise;
      src.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = type;
      bp.frequency.value = f;
      bp.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(bp).connect(g).connect(this.pistes[piste]);
      src.start();
      return { g, bp };
    };
    this.screech = loop('pneus', 6, 1250);
    this.whoosh = loop('boost', 0.7, 500, 'lowpass');
    this.wind = loop('vent', 0.5, 380, 'lowpass');
    this.noise = noise;
    this.loops.pret.then(() => this.loops.brancher(ctx, this.pistes.moteur));
  }

  /** Le moteur demarre (lancement d'une course). */
  engineStart() {
    this.loops.demarrage();
  }

  /** Autre moteur, choisi dans les Parametres. */
  changerMoteur(recette) {
    this.loops.changer(recette);
  }

  /** `v` de 0 a 1. */
  setVolume(v) {
    this.volume = 0.8 * v;
    this.appliquer();
  }

  niveauGeneral() {
    return this.muted || this.enPause ? 0 : this.volume;
  }

  /** Volume general, en fondu court pour eviter les clics. */
  appliquer() {
    if (!this.master) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(this.niveauGeneral(), t, 0.04);
  }

  /** Parametres ouverts (`true`) ou fermes : coupe tout le son du jeu. */
  pause(on) {
    this.enPause = on;
    this.appliquer();
  }

  /** Volume d'une famille de sons, `v` de 0 a 1. */
  setNiveau(id, v) {
    this.niveaux[id] = v;
    if (this.pistes[id]) this.pistes[id].gain.value = v;
  }

  toggleMute() {
    this.muted = !this.muted;
    this.appliquer();
    return this.muted;
  }

  update(st, input) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const speed = st[S.SPEED];
    // sept rapports fictifs : le regime monte puis retombe a chaque passage
    const gear = Math.min(6, Math.floor(speed / 16));
    const inGear = (speed - gear * 16) / 16;
    const f = 48 + gear * 9 + inGear * 70 + speed * 0.6;
    this.osc[0].frequency.setTargetAtTime(f, t, 0.03);
    this.osc[1].frequency.setTargetAtTime(f * 1.505, t, 0.03);
    this.engLp.frequency.setTargetAtTime(500 + input.throttle * 1400 + speed * 10, t, 0.05);
    // le synthe ne sert que si le generateur ne demarre pas (navigateur
    // sans AudioWorklet)
    const synthe = this.loops.actif ? 0 : 0.10 + input.throttle * 0.10;
    this.engGain.gain.setTargetAtTime(synthe, t, 0.05);
    this.loops.update(st, input, Math.min(0.1, t - this.dernier));
    this.dernier = t;

    const vl = Math.abs(st[S.VL]);
    // physique a l'echelle x3 : glisse et vitesse aussi
    const sq = clamp((vl - 7.5) / 30, 0, 1) * (speed > 12 ? 1 : 0);
    this.screech.g.gain.setTargetAtTime(sq * 0.32, t, 0.04);
    this.screech.bp.frequency.setTargetAtTime(1050 + vl * 6, t, 0.05);
    this.whoosh.g.gain.setTargetAtTime(st[S.BOOSTING] > 0 ? 0.35 : 0, t, 0.08);
    this.wind.g.gain.setTargetAtTime(clamp(speed / 240, 0, 1) * 0.14, t, 0.2);
  }

  beep(freq, dur = 0.14, type = 'square', vol = 0.25, when = 0, piste = 'course') {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.pistes[piste]);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  count(n) { this.beep(n > 0 ? 520 : 1040, n > 0 ? 0.18 : 0.45, 'square', 0.22); }

  boost() {
    this.beep(880, 0.08, 'sine', 0.3, 0, 'boost');
    this.beep(1320, 0.12, 'sine', 0.3, 0.07, 'boost');
  }

  checkpoint(faster) {
    this.beep(faster ? 990 : 660, 0.12, 'triangle', 0.35);
    this.beep(faster ? 1480 : 880, 0.2, 'triangle', 0.35, 0.1);
  }

  finish() {
    [660, 880, 1100, 1320].forEach((f, i) => this.beep(f, 0.35, 'triangle', 0.3, i * 0.11));
  }

  bank() { this.beep(1600, 0.06, 'sine', 0.15); }

  thud(v) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 260;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(clamp(v / 15, 0.15, 1), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    src.connect(lp).connect(g).connect(this.pistes.chocs);
    src.start(t);
    src.stop(t + 0.3);
  }
}
