// Son moteur procedural, echantillon par echantillon (AudioWorklet), d'apres
// Engine Simulator (ange-yaghi) sans sa thermodynamique. Le vilebrequin
// tourne au regime demande ; chaque cylindre lache une « bouffee » a son
// ouverture d'echappement, qui traverse son collecteur (retard, perte), puis
// la ligne (tube resonant, silencieux). Autour : admission, turbo, soupape,
// boite, demarreur, petarades.
//
// v2 (Skid Mania, mission PROMPT-SON.md, mesures RESULTATS-SON.md) : plus de
// stridence. Mordant filtre a 1,2 kHz, saturation ADAA avant le silencieux,
// bouffees calees a la fraction d'echantillon avec un front plancher,
// bruits roses et bruns, sons purs filtres et plafonnes, silencieux qui suit
// la charge (24 dB/oct), guide d'onde fractionnaire, graves d'allumage et
// harmoniques psychoacoustiques. La reference d'origine est dans
// `moteur-worklet-reference.js`.
//
// Fichier autonome (un worklet ne charge pas de module). Configuration et
// etat arrivent par `port`, ou d'un bloc par `processorOptions` pour un rendu
// hors ligne ; voir `moteur.js`.

const C_SON = 343;

/** Passe-bas a un pole, frequence reglable a la volee. */
class UnPole {
  constructor() { this.y = 0; this.k = 1; }
  regler(f, fs) {
    this.k = 1 - Math.exp((-2 * Math.PI * Math.min(f, fs * 0.45)) / fs);
  }
  f(x) {
    this.y += (x - this.y) * this.k;
    return this.y;
  }
}

/** log(cosh(u)) sans debordement : l'antiderivee de tanh. */
function logcosh(u) {
  const a = Math.abs(u);
  return a + Math.log1p(Math.exp(-2 * a)) - Math.LN2;
}

/** Saturation douce et asymetrique, anti-repliement par ADAA du premier
 *  ordre : au lieu de f(x), on rend la moyenne de f entre l'echantillon
 *  precedent et celui-ci, (F(x) - F(x1)) / (x - x1), F antiderivee de f.
 *  La plupart des harmoniques qui se seraient repliees au-dessus de
 *  Nyquist disparaissent, sans suréchantillonnage. Le decalage `b` rend la
 *  courbe asymetrique : des harmoniques paires, plus chaudes. */
class Saturation {
  constructor() { this.x1 = 0; }
  f(x, b) {
    const tb = Math.tanh(b);
    const d = x - this.x1;
    let y;
    if (Math.abs(d) < 1e-5) {
      y = Math.tanh((x + this.x1) * 0.5 + b) - tb;
    } else {
      y = (logcosh(x + b) - x * tb - (logcosh(this.x1 + b) - this.x1 * tb)) / d;
    }
    this.x1 = x;
    return y;
  }
}

class Biquad {
  constructor() {
    this.b0 = 1; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0;
    this.x1 = 0; this.x2 = 0; this.y1 = 0; this.y2 = 0;
  }
  regler(type, f, q, fs) {
    const w = (2 * Math.PI * Math.min(f, fs * 0.45)) / fs;
    const cs = Math.cos(w);
    const al = Math.sin(w) / (2 * q);
    const [b0, b1, b2] = type === 'passe-bas' ? [(1 - cs) / 2, 1 - cs, (1 - cs) / 2]
      : type === 'passe-haut' ? [(1 + cs) / 2, -(1 + cs), (1 + cs) / 2] : [al, 0, -al];
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
    this.boucle2 = 0;
    this.lagrange = [0, 1, 0, 0];
    this.dc = 0;
    this.avant = 0;
    this.sat = new Saturation();
    this.sil1 = new Biquad();
    this.sil2 = new Biquad();
    this.corps = new Biquad();
    this.air = 0;
    this.d1 = 0;
    this.d2 = 0;
    // passe-bas a 1,5 kHz (deux poles) sur la derivee
    this.kDerivee = 1 - Math.exp((-2 * Math.PI * 1200) / fs);
  }
  regler(c, fs) {
    // Aller-retour de l'onde dans la ligne : la frequence propre du tube.
    // v2 : retard fractionnaire (Lagrange d'ordre 3) ; arrondi a
    // l'echantillon, la longueur sautait par crans et les pics du peigne
    // tombaient a cote.
    const d = Math.max(8, Math.min(4000, ((2 * c.ligne) / C_SON) * fs));
    this.retour = Math.floor(d);
    const u = d - this.retour + 1;
    this.lagrange = [
      (-(u - 1) * (u - 2) * (u - 3)) / 6,
      (u * (u - 2) * (u - 3)) / 2,
      (-u * (u - 1) * (u - 3)) / 2,
      (u * (u - 1) * (u - 2)) / 6,
    ];
    // Reflexion a la sortie, inversee (bout ouvert) ; le silencieux
    // l'amortit. v2 : un peu moins forte, moins de « metal ».
    this.reflexion = -(0.66 - c.silencieux * 0.36);
    // Perte dans la boucle : deux poles vers 2,2 kHz (un seul vers 3 kHz
    // avant), les aigus du peigne s'eteignent en quelques allers-retours.
    this.kPerte = 1 - Math.exp((-2 * Math.PI * 2200) / fs);
    // Silencieux : coupure de base, ouverte ensuite par la charge et le
    // regime (`ouvrir`). Sombre au ralenti, ouvert en pleine charge.
    this.coupureBase = (3400 - c.silencieux * 2600) * (1 - c.turbo * 0.25);
    this.fs = fs;
    this.ouvrir(0.5, 0.5);
    // Le volume de la caisse : un gros moteur sonne plus bas.
    this.corps.regler('passe-bande', 150 - c.cylindree * 12, 1.1, fs);
  }
  /** Ouvre le silencieux selon la charge (0 a 1) et le regime (part de la
   *  zone rouge). Butterworth d'ordre 4 : 24 dB par octave au-dela. */
  ouvrir(charge, regime) {
    const f = this.coupureBase * (0.55 + 0.45 * charge) * (0.75 + 0.35 * regime);
    this.sil1.regler('passe-bas', f, 0.5412, this.fs);
    this.sil2.regler('passe-bas', f, 1.3066, this.fs);
  }

  f(x, c, bruit) {
    // Tube : on reinjecte l'onde reflechie, filtree par la ligne.
    const t = this.tube;
    const r = this.ecrit - this.retour + 4096;
    const L = this.lagrange;
    const lu = L[0] * t[(r + 1) & 4095] + L[1] * t[r & 4095] + L[2] * t[(r - 1) & 4095] + L[3] * t[(r - 2) & 4095];
    this.boucle += (lu - this.boucle) * this.kPerte;
    this.boucle2 += (this.boucle - this.boucle2) * this.kPerte;
    const y = x + this.reflexion * this.boucle2;
    this.tube[this.ecrit] = y;
    this.ecrit = (this.ecrit + 1) & 4095;
    // Synthese : signal sans continu, sa derivee (le mordant) et le bruit
    // d'air qui le module (le souffle), comme dans Engine Simulator.
    this.dc += (y - this.dc) * 0.0015;
    const f = y - this.dc;
    // v2 : la derivee brute etait un passe-haut cache, qui poussait
    // exactement la bande 2-6 kHz. Elle passe maintenant sous deux poles a
    // 1,5 kHz, et c'est le front de la bouffee, plus raide, qui donne
    // l'attaque (voir `process`).
    this.d1 += ((y - this.avant) * 6 - this.d1) * this.kDerivee;
    this.d2 += (this.d1 - this.d2) * this.kDerivee;
    this.avant = y;
    // Souffle : un bruit d'air lent qui module le signal sans jamais
    // l'inverser (sinon il grésille).
    this.air += (bruit - this.air) * 0.06;
    const airMix = 1 + c.souffle * 1.4 * this.air;
    let v = this.d2 * c.mordant * 0.4 + f * airMix * (1 - c.mordant * 0.3);
    // v2 : la rugosite sature AVANT le silencieux. Apres, elle regenerait
    // les aigus qu'il venait de couper.
    const drive = 1 + c.rugosite * 5;
    v = this.sat.f(v * drive * 1.6, 0.15 + c.rugosite * 0.2) / (drive * 1.6) * 1.6;
    v = this.sil2.f(this.sil1.f(v));
    v += this.corps.f(f) * (0.4 + c.cylindree * 0.08);
    return v;
  }
}

class MoteurSkidmania extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.graine = options?.processorOptions?.graine ?? 12345;
    const fs = sampleRate;
    this.fs = fs;
    this.c = null;
    this.angle = 0; this.rpm = 0; this.rpmCible = 0;
    this.charge = 0; this.chargeCible = 0;
    this.coupure = false; this.lever = false; this.gaz = 0;
    this.marche = 0; this.marcheCible = 0;
    this.n = 0;
    this.p0 = 0; this.p1 = 0; this.p2 = 0; this.br = 0;
    this.lpBoite = new UnPole();
    // Graves pour le telephone : le fondamental d'allumage, suivi au regime,
    // et ses harmoniques 2 et 3 (fondamentale manquante).
    this.fond = new Biquad();
    this.psyHaut = new Biquad();
    this.psyBas = new Biquad();
    this.psyHaut.regler('passe-haut', 180, 0.7, sampleRate);
    this.psyBas.regler('passe-bas', 1100, 0.7, sampleRate);
    this.envFond = 1e-4;
    this.lpTurbo = new UnPole();
    // Reserves fixes de bouffees et de petarades.
    this.bouffees = Array.from({ length: 64 }, () => ({ actif: false, debut: 0, duree: 1, amp: 0, ligne: 0 }));
    this.dernierClaque = 0;
    this.lignes = [new Ligne(fs), new Ligne(fs)];
    this.sat = [new Saturation(), new Saturation()];
    this.adm = new Biquad();
    this.sifflet = new Biquad();
    this.soupapeF = new Biquad();
    this.pression = 0; this.phaseTurbo = 0; this.phaseBoite = 0;
    this.soupape = 0; this.soupapeCible = 0;
    this.demarreur = 0; this.demarreurCible = 0; this.phaseDemarreur = 0;
    this.demarreurF = new Biquad();
    this.demarreurF.regler('passe-bande', 900, 1.4, sampleRate);
    this.gazAvant = 0;
    this.claques = Array.from({ length: 6 }, () => ({ actif: false, n: 0, duree: 1, force: 0, freq: 150, phase: 0 }));
    this.niveau = 0.05; this.gain = 1; this.effort = 0.6;
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
      this.sifflet.regler('passe-bande', 2000, 3, this.fs);
      this.soupapeF.regler('passe-bande', 1600, 0.9, this.fs);
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

  /** v2 : bruit rose (filtre de Paul Kellet, version economique). Le bruit
   *  blanc a autant d'energie par Hz dans les aigus : il siffle. Le rose
   *  perd 3 dB par octave, comme le souffle d'un vrai echappement. */
  rose() {
    const w = this.alea();
    this.p0 = 0.99765 * this.p0 + w * 0.099046;
    this.p1 = 0.963 * this.p1 + w * 0.2965164;
    this.p2 = 0.57 * this.p2 + w * 1.0526913;
    return (this.p0 + this.p1 + this.p2 + w * 0.1848) * 0.22;
  }

  /** Bruit brun (marche aleatoire amortie) : le grondement des petarades. */
  brun() {
    this.br = (this.br + 0.02 * this.alea()) / 1.02;
    return this.br * 3.5;
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
        // v2 : instant exact de l'ouverture, a la fraction d'echantillon
        // pres. Arrondi a l'echantillon, le calage des bouffees tremble, et
        // ce tremblement fait des composantes repliees quand le regime monte.
        const depasse = (this.angle - e + 720) % 720;
        const retard = ((cy.collecteur + c.ligne * 0.25) / C_SON) * fs - depasse / pas;
        const long = cy.collecteur + c.ligne;
        const b = this.bouffees.find((x) => !x.actif);
        if (b) {
          b.actif = true;
          b.debut = this.n + retard;
          b.duree = Math.max(48, (c.dureeBouffee / Math.max(this.rpm * 6, 1)) * fs);
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
        // Le mordant raidit le front : l'attaque se joue dans le temps.
        // Plancher de 0,4 ms : a haut regime la bouffee raccourcit, et un
        // front plus court deviendrait un clic large bande.
        const m = Math.max(c.montee, (fs * 0.0004) / b.duree);
        const montee = tau < m ? 0.5 - 0.5 * Math.cos((Math.PI * tau) / m) : 1;
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
        const p = q.force * env * (Math.sin(q.phase) * 1.2 + this.brun() * 0.5 * Math.exp(-t * 14));
        x0 += p;
        x1 += p;
        q.n += 1;
        if (q.n >= q.duree) q.actif = false;
      }
      const bruit = this.rose();
      let s0 = this.lignes[0].f(x0, c, bruit);
      let s1 = c.double ? this.lignes[1].f(x1, c, this.rose()) : s0;
      // Admission : un grondement au rythme des cylindres, sous charge.
      const rythme = 0.5 + 0.5 * Math.cos(((this.angle * N) / 720) * 2 * Math.PI);
      const adm = this.adm.f(this.rose()) * rythme * c.aspiration * (0.15 + this.gaz * 0.85) * (0.3 + (this.rpm / c.zoneRouge) * 0.9) * 0.9;
      // Turbo : la pression monte avec charge et regime, avec du retard.
      const cibleP = c.turbo > 0 && !this.coupure ? Math.min(1, this.charge * (this.rpm / c.zoneRouge) * 1.6) : 0;
      this.pression += (cibleP - this.pression) * (cibleP > this.pression ? 1.8 : 4) / fs;
      // v2 : le sinus du turbo plafonne a 4,7 kHz (au lieu de 8,8), passe
      // sous un passe-bas a 3 kHz et s'efface au-dessus de 2,5 kHz ; le
      // sifflet, sur du bruit rose, reste discret et suit la pression.
      const fTurbo = 1200 + 3500 * this.pression;
      this.phaseTurbo += (fTurbo / fs) * 2 * Math.PI;
      if (this.phaseTurbo > 6.283185) this.phaseTurbo -= 6.283185;
      const plafondTurbo = Math.min(1, (2500 / fTurbo) ** 2);
      const turbo = c.turbo * this.pression * this.pression * (this.lpTurbo.f(Math.sin(this.phaseTurbo) * 0.05 * plafondTurbo) + this.sifflet.f(bruit) * 0.12);
      // Soupape de decharge : un « pschhh » qui s'eteint.
      let soupape = 0;
      if (this.soupapeCible > 0) {
        this.soupape += (1 - this.soupape) * 0.02;
        if (this.soupape > 0.95) this.soupapeCible = 0;
      }
      if (this.soupape > 0.001) {
        soupape = this.soupapeF.f(this.rose()) * this.soupape * c.soupape * c.turbo * 1.05;
        this.soupape *= 1 - 4 / fs;
        this.pression *= 1 - 6 / fs;
      }
      // Boite : le sifflement des pignons droits, au regime.
      // v2 : le sifflement de boite passe sous un passe-bas qui suit le
      // regime et s'efface au-dessus de 2,2 kHz (5,4 kHz sur une F1 : une
      // couleur, plus une alarme).
      const fBoite = (this.rpm / 60) * 17;
      this.phaseBoite += (fBoite * 2 * Math.PI) / fs;
      if (this.phaseBoite > 6.283185) this.phaseBoite -= 6.283185;
      if ((this.n & 63) === 0) {
        this.lpBoite.regler(Math.min(2400, fBoite * 1.1), fs);
        this.lpTurbo.regler(3000, fs);
        const regime = Math.min(1, this.rpm / c.zoneRouge);
        const ouvert = this.coupure ? 0.15 : this.charge;
        this.lignes[0].ouvrir(ouvert, regime);
        if (c.double) this.lignes[1].ouvrir(ouvert, regime);
      }
      const plafondBoite = Math.min(1, (2200 / Math.max(fBoite, 1)) ** 2);
      const boite = this.lpBoite.f(c.sifflementBoite * Math.sin(this.phaseBoite) * 0.04 * (0.3 + this.charge) * plafondBoite);
      // Demarreur : un moteur electrique qui geint, ralenti a chaque
      // compression (le « rrr-rrr-rrr »), et le grincement du pignon.
      let demarreur = 0;
      this.demarreur += (this.demarreurCible - this.demarreur) * 0.003;
      if (this.demarreur > 0.001) {
        this.phaseDemarreur += (2 * Math.PI * (95 + this.rpm * 0.35)) / fs;
        if (this.phaseDemarreur > 6.283185) this.phaseDemarreur -= 6.283185;
        const compression = 0.55 + 0.45 * Math.cos(((this.angle * N) / 720) * 2 * Math.PI);
        demarreur = this.demarreur * compression * (Math.sin(this.phaseDemarreur) * 0.16 + Math.sin(this.phaseDemarreur * 2) * 0.08 + this.demarreurF.f(this.rose()) * 0.12);
      }
      // Graves : le fondamental d'allumage, tire des bouffees elles-memes,
      // et des harmoniques 2 et 3 fabriquees a partir de lui. Sur un
      // haut-parleur qui ne descend pas sous 300 Hz, l'oreille reconstruit
      // le fondamental a partir d'elles. Rien n'est ajoute dans les aigus.
      if ((this.n & 63) === 0) {
        const fAllumage = Math.max(25, Math.min(400, (this.rpm / 60) * (N / 2)));
        this.fond.regler('passe-bande', fAllumage, 1.2, fs);
      }
      const h = this.fond.f(x0 + x1);
      this.envFond += (Math.abs(h) - this.envFond) * 0.001;
      const hn = Math.max(-2, Math.min(2, h / (this.envFond + 1e-4)));
      const psy = this.psyBas.f(this.psyHaut.f((hn * Math.abs(hn) * 0.5 + hn * hn * hn * 0.25) * this.envFond));
      const graves = (h * (0.6 + c.cylindree * 0.06) + psy * 0.9) * 0.6;
      const commun = adm + turbo + soupape + boite + demarreur + graves;
      s0 += commun;
      s1 += commun;
      // Rugosite : une saturation douce, qui donne du grain.
      // v2 : plus de saturation ici (elle est dans la ligne, avant le
      // silencieux) ; seul un ecretage tres doux garde le niveau borne.
      s0 = this.sat[0].f(s0, 0);
      s1 = this.sat[1].f(s1, 0);
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

registerProcessor('moteur-skidmania', MoteurSkidmania);
