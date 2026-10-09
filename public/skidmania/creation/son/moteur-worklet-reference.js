// REFERENCE « AVANT » : le generateur de son de Skidball tel qu'il etait
// (web/src/game/moteur-worklet.js), garde pour le banc de mesure. Une seule
// retouche : le hasard vient d'un generateur a graine au lieu du hasard du
// navigateur, pour que deux rendus soient identiques et comparables.
// Le jeu et l'atelier utilisent `moteur-worklet.js`, la version corrigee.

// Son moteur procedural, echantillon par echantillon (AudioWorklet).
//
// D'apres l'architecture d'Engine Simulator (ange-yaghi/engine-sim), mais
// sans sa thermodynamique, trop lourde pour un navigateur de telephone :
//
//   1. Un vilebrequin tourne au regime demande ; chaque cylindre ouvre son
//      echappement a son angle propre (architecture, ordre d'allumage).
//   2. L'ouverture lache une impulsion de pression (la « bouffee »), dont la
//      force suit la charge et varie d'un cycle a l'autre (ralenti vivant,
//      rates). Coupure d'injection : il ne reste que le pompage.
//   3. L'impulsion parcourt le collecteur de son cylindre : elle arrive avec
//      un retard longueur / 343 m/s et s'affaiblit avec la longueur au carre,
//      comme dans Engine Simulator. Des collecteurs de longueurs inegales
//      decalent les bouffees (le grondement des boxers).
//   4. Les bouffees se somment par ligne d'echappement (une, ou une par
//      rangee sur un V), puis traversent la ligne : un tube resonant (aller-
//      retour de l'onde, reflechie a la sortie) et le silencieux.
//   5. Synthese, comme celle d'Engine Simulator : melange du signal et de sa
//      derivee (le mordant), modulation par un bruit d'air (le souffle),
//      saturation (la rugosite), puis nivellement du volume.
//   6. Autour : admission (grondement sous charge), turbo (montee en
//      pression, sifflement, soupape de decharge), petarades au lever de
//      pied, sifflement de boite.
//
// Le fichier se suffit a lui-meme : un AudioWorklet ne charge pas de module.
// La configuration arrive par `port` (`config`), l'etat du moteur aussi
// (`etat`, une soixantaine de fois par seconde), voir `moteur.js`.

const C_SON = 343;

class Biquad {
  constructor() {
    this.b0 = 1; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0;
    this.x1 = 0; this.x2 = 0; this.y1 = 0; this.y2 = 0;
  }
  regler(type, f, q, fs) {
    const w = (2 * Math.PI * Math.min(f, fs * 0.45)) / fs;
    const cs = Math.cos(w);
    const al = Math.sin(w) / (2 * q);
    let b0;
    let b1;
    let b2;
    if (type === 'passe-bas') {
      b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = (1 - cs) / 2;
    } else if (type === 'passe-haut') {
      b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = (1 + cs) / 2;
    } else {
      b0 = al; b1 = 0; b2 = -al;
    }
    const a0 = 1 + al;
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0;
    this.a1 = (-2 * cs) / a0; this.a2 = (1 - al) / a0;
  }
  f(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

/** Une ligne d'echappement : tube resonant, silencieux, synthese. */
class Ligne {
  constructor(fs) {
    this.fs = fs;
    this.tube = new Float32Array(4096);
    this.ecrit = 0;
    this.retour = 0;
    this.boucle = 0;
    this.dc = 0;
    this.avant = 0;
    this.sil1 = new Biquad();
    this.sil2 = new Biquad();
    this.corps = new Biquad();
    this.air = 0;
    this.derivee = 0;
  }
  regler(c, fs) {
    // Aller-retour de l'onde dans la ligne : la frequence propre du tube.
    this.retour = Math.max(8, Math.min(4000, Math.round(((2 * c.ligne) / C_SON) * fs)));
    // Reflexion a la sortie, inversee (bout ouvert) ; le silencieux
    // l'amortit.
    this.reflexion = -(0.72 - c.silencieux * 0.4);
    const coupure = (5200 - c.silencieux * 4300) * (1 - c.turbo * 0.3);
    this.sil1.regler('passe-bas', coupure, 0.7, fs);
    this.sil2.regler('passe-bas', coupure * 1.3, 0.6, fs);
    // Le volume de la caisse : un gros moteur sonne plus bas.
    this.corps.regler('passe-bande', 150 - c.cylindree * 12, 1.1, fs);
  }
  f(x, c, bruit) {
    // Tube : on reinjecte l'onde reflechie, filtree par la ligne.
    const lu = this.tube[(this.ecrit - this.retour + 4096) & 4095];
    this.boucle += (lu - this.boucle) * 0.35;
    const y = x + this.reflexion * this.boucle;
    this.tube[this.ecrit] = y;
    this.ecrit = (this.ecrit + 1) & 4095;
    // Synthese : signal sans continu, sa derivee (le mordant) et le bruit
    // d'air qui le module (le souffle), comme dans Engine Simulator.
    this.dc += (y - this.dc) * 0.0015;
    const f = y - this.dc;
    // Derivee lissee (vers 3 kHz) : l'attaque sans les clics qu'une
    // derivee brute tirerait du moindre angle du signal.
    this.derivee += ((y - this.avant) * 6 - this.derivee) * 0.32;
    this.avant = y;
    // Souffle : un bruit d'air lent qui module le signal sans jamais
    // l'inverser (sinon il grésille).
    this.air += (bruit - this.air) * 0.06;
    const airMix = 1 + c.souffle * 1.4 * this.air;
    let v = this.derivee * c.mordant + f * airMix * (1 - c.mordant);
    v = this.sil2.f(this.sil1.f(v));
    v += this.corps.f(f) * (0.4 + c.cylindree * 0.08);
    return v;
  }
}

class MoteurReference extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.graine = options?.processorOptions?.graine ?? 12345;
    const fs = sampleRate;
    this.fs = fs;
    this.c = null;
    this.angle = 0;
    this.rpm = 0;
    this.rpmCible = 0;
    this.charge = 0;
    this.chargeCible = 0;
    this.coupure = false;
    this.lever = false;
    this.gaz = 0;
    this.marche = 0;
    this.marcheCible = 0;
    this.n = 0;
    // Reserves fixes de bouffees et de petarades.
    this.bouffees = Array.from({ length: 64 }, () => ({ actif: false, debut: 0, duree: 1, amp: 0, ligne: 0 }));
    this.dernierClaque = 0;
    this.lignes = [new Ligne(fs), new Ligne(fs)];
    this.adm = new Biquad();
    this.sifflet = new Biquad();
    this.soupapeF = new Biquad();
    this.pression = 0;
    this.phaseTurbo = 0;
    this.phaseBoite = 0;
    this.soupape = 0;
    this.soupapeCible = 0;
    this.demarreur = 0;
    this.demarreurCible = 0;
    this.phaseDemarreur = 0;
    this.demarreurF = new Biquad();
    this.demarreurF.regler('passe-bande', 900, 1.4, sampleRate);
    this.gazAvant = 0;
    this.claques = Array.from({ length: 6 }, () => ({ actif: false, n: 0, duree: 1, force: 0, freq: 150, phase: 0 }));
    this.niveau = 0.05;
    this.gain = 1;
    this.effort = 0.6;
    this.port.onmessage = (e) => this.message(e.data);
    // Rendu hors ligne : la configuration et tout le scenario arrivent a la
    // creation (`processorOptions`). Firefox ne sait pas mettre en pause un
    // rendu hors ligne pour y glisser des messages : le scenario, ecrit
    // d'avance, s'applique ici a l'echantillon pres.
    const o = options?.processorOptions;
    if (o?.config) this.message({ t: 'config', config: o.config });
    this.programme = Array.isArray(o?.programme) ? o.programme : null;
    this.iProgramme = 0;
  }

  message(m) {
    if (m.t === 'config') {
      this.c = m.config;
      for (const l of this.lignes) l.regler(this.c, this.fs);
      this.adm.regler('passe-bande', this.c.resoAdm, 3.5, this.fs);
      this.sifflet.regler('passe-bande', 2400, 6, this.fs);
      this.soupapeF.regler('passe-bande', 2200, 0.9, this.fs);
    } else if (m.t === 'etat') {
      this.rpmCible = m.rpm;
      this.chargeCible = m.charge;
      this.coupure = m.coupure;
      this.lever = m.lever;
      this.gaz = m.gaz;
      this.marcheCible = m.marche ? 1 : 0;
      // Demarreur : le moteur electrique qui entraine le vilebrequin.
      this.demarreurCible = m.demarreur ?? 0;
    }
  }

  // mulberry32 : rapide, a graine, assez bon pour du bruit audio.
  rnd() {
    this.graine = (this.graine + 0x6d2b79f5) | 0;
    let t = this.graine;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  alea() {
    return this.rnd() * 2 - 1;
  }

  /** Une bouffee d'echappement : son amplitude et ce qui la rend vivante. */
  combustion(c) {
    if (this.coupure) {
      // Plus d'injection : il ne reste que le pompage, et de temps en temps
      // une petarade au lever de pied, a haut regime. Jamais en rafale
      // continue : au moins 70 ms entre deux.
      const ecart = this.n - this.dernierClaque;
      if (this.lever && this.rpm > c.ralenti * 2 && ecart > this.fs * 0.07 && this.rnd() < c.petarades * 0.07) this.claque(0.6 + this.rnd() * 0.7);
      return 0.1;
    }
    const auRalenti = this.rpm < c.ralenti * 1.4;
    // Variations d'un cycle a l'autre, bien plus franches au ralenti, et un
    // rate de temps en temps.
    const irr = c.irregularite * (auRalenti ? 0.5 : 0.12);
    if (auRalenti && this.rnd() < c.irregularite * 0.035) return 0.15;
    return Math.max(0.05, this.charge * (1 + this.alea() * irr));
  }

  claque(force) {
    const q = this.claques.find((x) => !x.actif);
    if (!q) return;
    this.dernierClaque = this.n;
    q.actif = true;
    q.n = 0;
    q.force = force;
    q.duree = Math.round(this.fs * (0.04 + this.rnd() * 0.05));
    q.freq = 110 + this.rnd() * 120;
    q.phase = 0;
  }

  process(_entrees, sorties) {
    const sortie = sorties[0];
    const g = sortie[0];
    const d = sortie[1] ?? sortie[0];
    const c = this.c;
    if (!c) {
      g.fill(0);
      if (d !== g) d.fill(0);
      return true;
    }
    const fs = this.fs;
    const N = c.cylindres.length;
    // Soupape de decharge : gaz relache d'un coup avec de la pression.
    if (this.gazAvant > 0.5 && this.gaz < 0.15 && this.pression > 0.35) this.soupapeCible = 1;
    this.gazAvant = this.gaz;
    for (let i = 0; i < g.length; i += 1) {
      if (this.programme) {
        while (this.iProgramme < this.programme.length && this.programme[this.iProgramme].n <= this.n) {
          // Le type en dernier : chaque etape porte aussi son instant (`t`, en s).
          this.message({ ...this.programme[this.iProgramme], t: 'etat' });
          this.iProgramme += 1;
        }
      }
      // Regime et charge lisses a l'echantillon : pas de marches audibles.
      this.rpm += (this.rpmCible - this.rpm) * 0.0009;
      this.charge += (this.chargeCible - this.charge) * 0.002;
      this.marche += (this.marcheCible - this.marche) * 0.0004;
      const pas = (this.rpm * 6) / fs;
      const avant = this.angle;
      this.angle += pas;
      if (this.angle >= 720) this.angle -= 720;
      // Ouverture d'echappement de chaque cylindre, 130 degres apres son
      // allumage : la bouffee part dans son collecteur.
      for (let k = 0; k < N; k += 1) {
        const cy = c.cylindres[k];
        const e = cy.ouverture;
        const passe = avant <= this.angle ? avant < e && e <= this.angle : avant < e || e <= this.angle;
        if (!passe) continue;
        const amp = this.combustion(c);
        const retard = Math.round(((cy.collecteur + c.ligne * 0.25) / C_SON) * fs);
        const long = cy.collecteur + c.ligne;
        const b = this.bouffees.find((x) => !x.actif);
        if (b) {
          b.actif = true;
          b.debut = this.n + retard;
          b.duree = Math.max(48, Math.round((c.dureeBouffee / Math.max(this.rpm * 6, 1)) * fs));
          b.amp = (amp * 4) / (1 + long * long * 0.12);
          b.ligne = cy.ligne;
        }
      }
      // Les bouffees en cours, sommees par ligne.
      let x0 = 0;
      let x1 = 0;
      for (let k = 0; k < this.bouffees.length; k += 1) {
        const b = this.bouffees[k];
        if (!b.actif) continue;
        const t = this.n - b.debut;
        if (t < 0) continue;
        if (t >= b.duree) {
          b.actif = false;
          continue;
        }
        // Front raide mais arrondi, decroissance, et une queue qui rejoint
        // zero en douceur : la pression s'echappe d'un coup sans que le
        // signal ne fasse de marche (une marche, c'est un clic).
        const tau = t / b.duree;
        const montee = tau < c.montee ? 0.5 - 0.5 * Math.cos((Math.PI * tau) / c.montee) : 1;
        const queue = (1 - tau) * (1 - tau);
        const v = b.amp * (montee * Math.exp(-tau * 4.5) * queue - 0.07 * Math.sin(Math.PI * tau));
        if (b.ligne === 0) x0 += v;
        else x1 += v;
      }
      for (let k = 0; k < this.claques.length; k += 1) {
        const q = this.claques[k];
        if (!q.actif) continue;
        const t = q.n / q.duree;
        const env = Math.sin(Math.PI * Math.min(1, t * 6)) * Math.exp(-t * 6);
        q.phase += (2 * Math.PI * q.freq) / fs;
        const p = q.force * env * (Math.sin(q.phase) * 1.2 + this.alea() * 0.5 * Math.exp(-t * 14));
        x0 += p;
        x1 += p;
        q.n += 1;
        if (q.n >= q.duree) q.actif = false;
      }
      const bruit = this.alea();
      let s0 = this.lignes[0].f(x0, c, bruit);
      let s1 = c.double ? this.lignes[1].f(x1, c, this.alea()) : s0;
      // Admission : un grondement au rythme des cylindres, sous charge.
      const rythme = 0.5 + 0.5 * Math.cos(((this.angle * N) / 720) * 2 * Math.PI);
      const adm = this.adm.f(this.alea()) * rythme * c.aspiration * (0.15 + this.gaz * 0.85) * (0.3 + (this.rpm / c.zoneRouge) * 0.9) * 0.9;
      // Turbo : la pression monte avec charge et regime, avec du retard.
      const cibleP = c.turbo > 0 && !this.coupure ? Math.min(1, this.charge * (this.rpm / c.zoneRouge) * 1.6) : 0;
      this.pression += (cibleP - this.pression) * (cibleP > this.pression ? 1.8 : 4) / fs;
      this.phaseTurbo += ((1800 + 7000 * this.pression) / fs) * 2 * Math.PI;
      if (this.phaseTurbo > 6.283185) this.phaseTurbo -= 6.283185;
      const turbo = c.turbo * this.pression * this.pression * (Math.sin(this.phaseTurbo) * 0.05 + this.sifflet.f(bruit) * 0.25);
      // Soupape de decharge : un « pschhh » qui s'eteint.
      let soupape = 0;
      if (this.soupapeCible > 0) {
        this.soupape += (1 - this.soupape) * 0.02;
        if (this.soupape > 0.95) this.soupapeCible = 0;
      }
      if (this.soupape > 0.001) {
        soupape = this.soupapeF.f(this.alea()) * this.soupape * c.soupape * c.turbo * 1.05;
        this.soupape *= 1 - 4 / fs;
        this.pression *= 1 - 6 / fs;
      }
      // Boite : le sifflement des pignons droits, au regime.
      this.phaseBoite += ((this.rpm / 60) * 17 * 2 * Math.PI) / fs;
      if (this.phaseBoite > 6.283185) this.phaseBoite -= 6.283185;
      const boite = c.sifflementBoite * Math.sin(this.phaseBoite) * 0.04 * (0.3 + this.charge);
      // Demarreur : un moteur electrique qui geint, ralenti a chaque
      // compression (le « rrr-rrr-rrr »), et le grincement du pignon.
      let demarreur = 0;
      this.demarreur += (this.demarreurCible - this.demarreur) * 0.003;
      if (this.demarreur > 0.001) {
        this.phaseDemarreur += (2 * Math.PI * (95 + this.rpm * 0.35)) / fs;
        if (this.phaseDemarreur > 6.283185) this.phaseDemarreur -= 6.283185;
        const compression = 0.55 + 0.45 * Math.cos(((this.angle * N) / 720) * 2 * Math.PI);
        demarreur = this.demarreur * compression * (Math.sin(this.phaseDemarreur) * 0.16 + Math.sin(this.phaseDemarreur * 2) * 0.08 + this.demarreurF.f(this.alea()) * 0.12);
      }
      const commun = adm + turbo + soupape + boite + demarreur;
      s0 += commun;
      s1 += commun;
      // Rugosite : une saturation douce, qui donne du grain.
      const drive = 1 + c.rugosite * 5;
      s0 = Math.tanh(s0 * drive) / drive;
      s1 = Math.tanh(s1 * drive) / drive;
      // Nivellement : le volume suit le moteur sans exploser a haut regime
      // ni disparaitre au ralenti (le « leveler » d'Engine Simulator).
      const e = (s0 * s0 + s1 * s1) * 0.5;
      this.niveau += (e - this.niveau) * 0.0004;
      // Nivellement leger : il rapproche les moteurs entre eux sans effacer
      // l'effort ; c'est la charge qui fait monter le son sous l'accelerateur
      // et le fait retomber au lever de pied.
      const cible = Math.min(2.5, Math.max(0.4, Math.pow(0.02 / Math.max(this.niveau, 1e-6), 0.12)));
      this.gain += (cible - this.gain) * 0.0002;
      this.effort += ((this.coupure ? 0.55 : 0.45 + this.charge * 0.85) - this.effort) * 0.0015;
      const vol = c.volume * this.gain * this.effort * this.marche * 0.6;
      // Stereo : chaque rangee d'un V de son cote, selon la largeur.
      const l = c.largeur;
      g[i] = (s0 * (1 + l) + s1 * (1 - l)) * 0.5 * vol;
      d[i] = (s1 * (1 + l) + s0 * (1 - l)) * 0.5 * vol;
      this.n += 1;
    }
    return true;
  }
}

registerProcessor('moteur-reference', MoteurReference);
