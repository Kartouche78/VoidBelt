// Affichage par-dessus le jeu : chrono, checkpoints, vitesse, jauge de
// boost, points de drift. Le record personnel reste dans ce navigateur.

import { S, PHASE } from './moteur.js';

// v3 : le circuit a ete redessine (vertige, 9,7 km) ; les anciens chronos
// ne valent plus rien.
// v5 : physique x3 (900 km/h) et trace tech d'une minute.
const KEY = 'skidmania.record.v5';

/** Petite empreinte d'une chaine, pour nommer la cle d'un jeu de reglages. */
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}
const $ = (id) => document.getElementById(id);

export function fmt(t) {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

export const records = {
  /** Un record par jeu de reglages : vide pour les reglages par defaut. */
  key: KEY,
  useSettings(signature) {
    this.key = signature ? `${KEY}.${hash(signature)}` : KEY;
  },
  load() {
    try {
      return JSON.parse(localStorage.getItem(this.key)) || null;
    } catch {
      return null;
    }
  },
  save(r) {
    try {
      localStorage.setItem(this.key, JSON.stringify(r));
    } catch {
      /* navigation privee : tant pis, le record ne survit pas */
    }
  },
};

export class Hud {
  constructor(engine) {
    this.el = {
      time: $('chrono'), cp: $('cp'), split: $('split'), speed: $('vitesse'),
      gauge: $('jauge'), fill: $('jauge-plein'), drift: $('drift'), driftPts: $('drift-pts'),
      score: $('score'), count: $('decompte'), bar: $('progression-curseur'),
      bank: $('encaisse'), best: $('meilleur'),
      slide: $('speedslide'),
      gear: $('rapport'), tours: $('tours-plein'), toursTexte: $('tours-texte'),
    };
    this.length = engine.checkpoints[engine.checkpoints.length - 1];
    this.start = engine.startLine;
    const ticks = $('progression-reperes');
    for (const s of engine.checkpoints) {
      const t = document.createElement('i');
      t.style.left = `${(this.pct(s) * 100).toFixed(2)}%`;
      ticks.appendChild(t);
    }
    this.record = records.load();
    this.showBest();
    this.splitTimer = 0;
    this.countTimer = 0;
    this.bankTimer = 0;
  }

  pct(s) {
    return Math.max(0, Math.min(1, (s - this.start) / (this.length - this.start)));
  }

  /** A rappeler apres un changement de reglages. */
  reloadRecord(custom) {
    this.record = records.load();
    this.custom = custom;
    this.showBest();
  }

  showBest() {
    const tag = this.custom ? ' (RÉGLAGES PERSO)' : '';
    this.el.best.textContent = this.record
      ? `RECORD ${fmt(this.record.time)}${tag}` : `PAS ENCORE DE RECORD${tag}`;
  }

  /** Moteur joue : son regime de passage colore le compte-tours. */
  moteur(r) {
    this.passage = r.passage;
  }

  countdown(n) {
    const c = this.el.count;
    c.textContent = n > 0 ? String(n) : 'GO !';
    c.classList.remove('pop');
    void c.offsetWidth;
    c.classList.add('pop');
    this.countTimer = n > 0 ? 1.2 : 0.9;
  }

  /** Ecart au record sur ce checkpoint ; renvoie vrai si on est en avance. */
  split(i, t) {
    const el = this.el.split;
    const ref = this.record && this.record.splits[i];
    let ahead = true;
    if (ref != null) {
      const d = t - ref;
      ahead = d <= 0;
      el.textContent = `${ahead ? '-' : '+'}${Math.abs(d).toFixed(3)}`;
      el.className = ahead ? 'avance' : 'retard';
    } else {
      el.textContent = fmt(t);
      el.className = '';
    }
    el.classList.add('vu');
    this.splitTimer = 2.5;
    return ahead;
  }

  bank(pts) {
    const el = this.el.bank;
    el.textContent = `+${pts.toLocaleString('fr-FR')}`;
    el.classList.remove('pop');
    void el.offsetWidth;
    el.classList.add('pop');
  }

  update(st, dt) {
    const e = this.el;
    e.time.textContent = fmt(st[S.TIME]);
    const n = st[S.CP_COUNT] - 1;
    e.cp.textContent = st[S.PHASE] === PHASE.FINISHED
      ? 'ARRIVEE' : `CP ${Math.min(st[S.NEXT_CP], n)}/${n}`;
    e.speed.textContent = Math.round(st[S.SPEED] * 3.6);
    // compte-tours : rapport, regime, et la barre qui rougit au passage
    const g = st[S.GEAR];
    e.gear.textContent = g === 0 ? 'N' : g < 0 ? 'R' : String(g);
    const part = Math.min(1, st[S.RPM] / Math.max(1, st[S.REDLINE]));
    e.tours.style.transform = `scaleX(${part.toFixed(3)})`;
    e.tours.classList.toggle('rouge', part >= (this.passage ?? 0.93) * 0.97);
    e.tours.classList.toggle('coupe', st[S.ENG_CUT] > 0 && st[S.ENG_LIFT] === 0);
    e.toursTexte.textContent = `${Math.round(st[S.RPM] / 50) * 50} TR/MIN`;

    const boost = st[S.BOOST];
    e.fill.style.transform = `scaleX(${boost.toFixed(3)})`;
    e.gauge.classList.toggle('pleine', boost >= 0.999);
    e.gauge.classList.toggle('active', st[S.BOOSTING] > 0);

    const pts = Math.round(st[S.DRIFT_POINTS]);
    e.drift.classList.toggle('vu', pts > 0);
    e.slide.classList.toggle('vu', st[S.SPEEDSLIDE] > 0);
    if (pts > 0) e.driftPts.textContent = pts.toLocaleString('fr-FR');
    e.score.textContent = Math.round(st[S.SCORE]).toLocaleString('fr-FR');
    e.bar.style.left = `${(this.pct(st[S.PROGRESS]) * 100).toFixed(2)}%`;

    if (this.splitTimer > 0) {
      this.splitTimer -= dt;
      if (this.splitTimer <= 0) e.split.classList.remove('vu');
    }
    if (this.countTimer > 0) {
      this.countTimer -= dt;
      if (this.countTimer <= 0) e.count.classList.remove('pop');
    }
  }
}
