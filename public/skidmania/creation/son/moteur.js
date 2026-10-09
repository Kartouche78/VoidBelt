// Son moteur procedural : ce qui tourne a chaque image, cote page. Repris
// de Skidball (`web/src/game/moteur.js`) ; en plus, le choix du generateur
// (`version`) : la reference d'origine, pour le banc de mesure, ou la
// version corrigee, pour l'atelier et le jeu.
//
// - Les architectures : l'angle d'allumage de chaque cylindre sur le cycle
//   de 720 degres, et sa ligne d'echappement. C'est ce rythme, et pas le
//   nombre de cylindres seul, qui fait la signature d'un moteur (le
//   « glouglou » d'un V8 a vilebrequin croise vient de ses intervalles
//   inegaux sur chaque rangee).
// - La boite virtuelle : rapports, passage avec coupure, retrogradage avec
//   coup de gaz, rupteur, frein moteur. Elle traduit la vitesse de la
//   voiture et l'accelerateur en regime et en charge.
// - Le lien avec le generateur de son (`moteur-worklet.js`), qui fabrique
//   le son echantillon par echantillon.

/** Generateurs de son : fichier et nom du processeur. */
export const GENERATEURS = {
  reference: { url: new URL('./moteur-worklet-reference.js', import.meta.url).href, nom: 'moteur-reference' },
  v2: { url: new URL('./moteur-worklet.js', import.meta.url).href, nom: 'moteur-skidmania' },
};

/** Architectures : `[nom, angles d'allumage (degres sur 720), ligne de
 *  chaque cylindre (0 ou 1), echappement double, bouffee]`. Les V ont une
 *  ligne par rangee ; les boxers et les moteurs en ligne, une seule.
 *  `bouffee` (facultatif) : `{ duree, montee }`, la duree de l'ouverture
 *  d'echappement en degres et la part de montee du front (220 et 0,08
 *  pour un moteur a pistons). */
export const ARCHITECTURES = {
  l3: ['3 cylindres en ligne', [0, 240, 480], [0, 0, 0], false],
  l4: ['4 cylindres en ligne', [0, 180, 360, 540], [0, 0, 0, 0], false],
  l5: ['5 cylindres en ligne', [0, 144, 288, 432, 576], [0, 0, 0, 0, 0], false],
  l6: ['6 cylindres en ligne', [0, 120, 240, 360, 480, 600], [0, 0, 0, 0, 0, 0], false],
  'flat4': ['4 cylindres à plat (boxer)', [0, 180, 360, 540], [0, 0, 0, 0], false],
  'flat6': ['6 cylindres à plat', [0, 120, 240, 360, 480, 600], [0, 0, 0, 0, 0, 0], false],
  'v6-60': ['V6 à 60°', [0, 120, 240, 360, 480, 600], [0, 1, 0, 1, 0, 1], true],
  // V6 a 90 degres sans manetons decales : allumage irregulier.
  'v6-90': ['V6 à 90° (irrégulier)', [0, 90, 240, 330, 480, 570], [0, 1, 0, 1, 0, 1], true],
  // Ordre 1-8-4-3-6-5-7-2, rangee gauche 1-3-5-7 : chaque rangee tire a
  // intervalles inegaux, d'ou le grondement.
  'v8-croise': ['V8 vilebrequin croisé', [0, 90, 180, 270, 360, 450, 540, 630], [0, 1, 1, 0, 1, 0, 0, 1], true],
  'v8-plat': ['V8 vilebrequin plat', [0, 90, 180, 270, 360, 450, 540, 630], [0, 1, 0, 1, 0, 1, 0, 1], true],
  v10: ['V10', [0, 72, 144, 216, 288, 360, 432, 504, 576, 648], [0, 1, 0, 1, 0, 1, 0, 1, 0, 1], true],
  v12: ['V12', [0, 60, 120, 180, 240, 300, 360, 420, 480, 540, 600, 660], [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1], true],
  // Rotatif a deux rotors (Mazda 13B) : chaque rotor allume une fois par
  // tour d'arbre, d'ou le rythme d'un quatre cylindres. Mais ses lumieres
  // d'echappement, dans le carter, s'ouvrent d'un coup et longtemps : des
  // bouffees plus franches et plus longues, qui se chevauchent — le
  // « brap » rauque du rotatif.
  'rotatif-2': ['Rotatif bi-rotor', [0, 180, 360, 540], [0, 0, 0, 0], false, { duree: 310, montee: 0.05 }],
  // Rotatif a six rotors : six bouffees par tour d'arbre, tous les 60
  // degres (le rythme d'un V12), avec la bouffee longue du rotatif. Deux
  // collecteurs de trois rotors, un de chaque cote, qui tirent en
  // alternance. Les bouffees se suivent de si pres qu'un front plus doux
  // suffit : plus raide, il claquerait.
  'rotatif-6': ['Rotatif 6 rotors', [0, 60, 120, 180, 240, 300, 360, 420, 480, 540, 600, 660], [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1], true, { duree: 310, montee: 0.09 }],
};

/** Ecart de longueur de chaque collecteur, avant le reglage « inegalite ».
 *  Sur un boxer, les collecteurs d'un cote sont plus longs que ceux de
 *  l'autre : c'est tout son grondement. */
function ecartCollecteur(arch, k) {
  if (arch === 'flat4' || arch === 'flat6') return k % 2 ? -0.6 : 0.6;
  return Math.sin(k * 2.4) * 0.5;
}

/** Configuration envoyee au generateur de son, d'apres une recette. */
export function configMoteur(r) {
  const [, angles, lignes, double, bouffee] = ARCHITECTURES[r.architecture] ?? ARCHITECTURES.l4;
  return {
    dureeBouffee: bouffee?.duree ?? 220,
    montee: bouffee?.montee ?? 0.08,
    cylindres: angles.map((a, k) => ({
      ouverture: (a + 130) % 720,
      ligne: double ? lignes[k] : 0,
      collecteur: Math.max(0.05, r.collecteur * (1 + r.inegal * ecartCollecteur(r.architecture, k))),
    })),
    double,
    cylindree: r.cylindree,
    nCylindres: angles.length,
    ralenti: r.ralenti,
    zoneRouge: r.zoneRouge,
    irregularite: r.irregularite,
    ligne: r.ligne,
    silencieux: r.silencieux,
    mordant: r.mordant,
    souffle: r.souffle,
    rugosite: r.rugosite,
    aspiration: r.aspiration,
    resoAdm: r.resoAdm,
    turbo: r.turbo,
    soupape: r.soupape,
    petarades: r.petarades,
    sifflementBoite: r.sifflementBoite,
    volume: r.volume,
    largeur: double ? r.largeur : 0,
  };
}

/** Boite de vitesses virtuelle : de la vitesse de la voiture (0 a 1 de sa
 *  vitesse maximale) et de l'accelerateur, au regime et a la charge. */
export class Boite {
  constructor(r) {
    this.rapport = 1;
    this.passage = 0;
    this.coup = 0;
    this.limite = 0;
    this.apresPassage = r.ralenti;
    this.regler(r);
    this.rpm = r.ralenti;
  }

  regler(r) {
    this.r = r;
    this.rapport = Math.min(this.rapport, r.rapports);
    // Rapports en progression geometrique. Les voitures du jeu atteignent
    // vite leur vitesse maximale : la premiere tient jusqu'a 25 % de cette
    // vitesse, et a fond sur le dernier rapport le moteur reste a 85 % de
    // la zone rouge, au lieu de hurler sans arret au rupteur.
    this.haut = 0.85;
    const premiere = (r.passage * r.zoneRouge) / 0.25;
    this.q = r.rapports > 1 ? Math.pow(premiere / (this.haut * r.zoneRouge), 1 / (r.rapports - 1)) : 1;
  }

  /** Regime par unite de vitesse, au rapport `g`. */
  k(g) {
    return this.r.zoneRouge * this.haut * Math.pow(this.q, this.r.rapports - g);
  }

  /** Avance d'un pas de `dt` secondes. Rend `{ rpm, charge, coupure,
   *  lever, rapport }`.
   *
   *  Les voitures du jeu accelerent tres fort : si le regime collait a la
   *  vitesse, chaque rapport serait parcouru en un instant et l'aiguille
   *  sauterait presque au rupteur. Le moteur a donc une inertie : il ne
   *  prend des tours qu'a un rythme borne (plus vite en premiere qu'en
   *  sixieme, plus vite s'il est reactif), l'embrayage absorbant l'ecart.
   *  Le passage se decide sur le regime du moteur, une fois atteint. */
  maj({ vitesse = 0, gaz = 0, glisse = 0 }, dt) {
    const r = this.r;
    const v = Math.max(0, vitesse);
    let coupure = false;
    if (this.passage > 0) {
      this.passage -= dt;
      coupure = true;
    }
    if (this.coup > 0) this.coup -= dt;
    let roue = v * this.k(this.rapport);
    if (this.passage <= 0) {
      if (gaz > 0.15 && this.rpm >= r.passage * r.zoneRouge && roue > r.passage * r.zoneRouge * 0.7 && this.rapport < r.rapports) {
        // Montee : coupure le temps du passage, et le regime retombe de
        // l'ecart entre les deux rapports, comme quand l'embrayage reprend.
        this.rapport += 1;
        this.passage = r.tempsPassage;
        this.apresPassage = Math.max(r.ralenti, this.rpm / this.q);
        coupure = true;
      } else if (this.rapport > 1 && roue < r.zoneRouge * 0.4 && v * this.k(this.rapport - 1) < r.zoneRouge * 0.85) {
        // Descente : petit coup de gaz pour caler le regime.
        this.rapport -= 1;
        this.coup = 0.12;
      }
      roue = v * this.k(this.rapport);
    }
    // Embrayage au demarrage : il patine vers un tiers de la zone rouge,
    // le temps que la voiture prenne de la vitesse.
    const patine = r.ralenti + gaz * (r.zoneRouge * 0.3 - r.ralenti);
    let cible = Math.max(roue, this.rapport === 1 && roue < patine ? patine : 0, r.ralenti);
    // Patinage et derive : le regime s'envole un peu.
    cible += glisse * gaz * r.zoneRouge * 0.15;
    if (this.coup > 0) cible += r.zoneRouge * 0.12;
    cible = Math.min(cible, r.zoneRouge);
    // Pendant le passage, le regime ne fait que retomber vers celui du
    // rapport suivant ; il ne remontera qu'ensuite.
    if (this.passage > 0) cible = this.apresPassage;
    if (cible > this.rpm) {
      // Montee bornee : environ une seconde pour balayer la premiere sur un
      // moteur moyen, un peu plus a chaque rapport.
      const rythme = ((r.zoneRouge - r.ralenti) * (0.45 + r.reactivite * 0.65)) / Math.pow(this.rapport, 0.75);
      this.rpm = Math.min(cible, this.rpm + rythme * dt * (this.coup > 0 ? 3 : 1));
    } else {
      // Descente franche : un passage ou un lever de pied tombent vite.
      // Au passage, la chute tient dans sa duree.
      const vif = this.passage > 0 ? 3 / Math.max(r.tempsPassage, 0.04) : 4 + r.reactivite * 10;
      this.rpm += (cible - this.rpm) * Math.min(1, vif * dt);
    }
    // Rupteur : seulement quand le moteur y est vraiment. L'injection se
    // coupe et se remet en rafale, le regime oscille d'un poil dessous.
    let rupteur = false;
    if (this.rpm >= r.zoneRouge * 0.995 && gaz > 0.15) {
      this.limite += dt;
      rupteur = Math.floor(this.limite * 16) % 2 === 0;
      if (rupteur) this.rpm -= r.zoneRouge * 0.02;
    } else {
      this.limite = 0;
    }
    const lever = gaz < 0.05 && v > 0.05;
    let charge;
    if (gaz > 0.05) charge = 0.3 + 0.7 * gaz;
    else if (v < 0.03) charge = 0.24;
    else charge = 0.18;
    // Frein moteur : plus d'injection au lever de pied a haut regime.
    if (lever && this.rpm > r.ralenti * 1.6) coupure = true;
    if (this.coup > 0) {
      coupure = false;
      charge = 0.7;
    }
    return { rpm: this.rpm, charge, coupure: coupure || rupteur, lever, rapport: this.rapport };
  }
}

/** Rend hors ligne un scenario ecrit d'avance : `etats`, une liste de
 *  `{ t (s), rpm, charge, coupure, lever, gaz, demarreur }`. Rend un
 *  `AudioBuffer` stereo. Marche partout, Firefox compris (pas de pause du
 *  rendu : le generateur recoit tout le scenario des sa creation). */
export async function rendreScenario(recette, etats, duree, fs = 44100, { version = 'v2', graine = 12345, test = null } = {}) {
  const ctx = new OfflineAudioContext(2, Math.round(duree * fs), fs);
  const programme = etats.map((e) => ({ marche: true, ...e, n: Math.round(e.t * fs) }));
  const config = { ...configMoteur(recette), ...(test ?? {}) };
  const moteur = new Moteur(ctx, ctx.destination, { config, programme, graine }, version);
  if (!(await moteur.pret)) throw new Error('Générateur audio indisponible dans ce navigateur.');
  return ctx.startRendering();
}

/** Un moteur qui sonne : le generateur de son branche sur `destination`,
 *  et sa boite. `maj` a chaque image ; `couper` le fait taire. */
export class Moteur {
  /** `options` : `processorOptions` du generateur (`{ config, programme }`),
   *  pour un rendu hors ligne ecrit d'avance. */
  constructor(ctx, destination, options = null, version = 'v2') {
    this.options = options;
    this.generateur = GENERATEURS[version] ?? GENERATEURS.v2;
    this.ctx = ctx;
    this.destination = destination;
    this.noeud = null;
    this.recette = null;
    this.boite = null;
    this.dernier = null;
    this.pret = this.demarrer();
  }

  async demarrer() {
    if (!this.ctx.audioWorklet) return false;
    try {
      await this.ctx.audioWorklet.addModule(this.generateur.url);
      this.noeud = new AudioWorkletNode(this.ctx, this.generateur.nom, {
        numberOfInputs: 0,
        outputChannelCount: [2],
        ...(this.options ? { processorOptions: this.options } : {}),
      });
      this.noeud.connect(this.destination);
      if (this.recette) this.configurer(this.recette);
      return true;
    } catch (err) {
      console.warn('moteur procedural indisponible, on garde les boucles :', err);
      return false;
    }
  }

  get actif() {
    return !!this.noeud;
  }

  configurer(recette) {
    this.recette = recette;
    if (this.boite) this.boite.regler(recette);
    else this.boite = new Boite(recette);
    this.noeud?.port.postMessage({ t: 'config', config: configMoteur(recette) });
  }

  /** `entree` : `{ vitesse (0 a 1), gaz, glisse }`. Rend l'etat de la boite. */
  maj(entree, dt) {
    if (!this.boite) return null;
    const e = this.boite.maj(entree, Math.min(dt, 0.1));
    this.dernier = e;
    this.noeud?.port.postMessage({ t: 'etat', marche: true, rpm: e.rpm, charge: e.charge, coupure: e.coupure, lever: e.lever, gaz: entree.gaz ?? 0 });
    return e;
  }

  /** Pilotage direct, sans la boite : `{ rpm, charge, coupure, lever, gaz,
   *  demarreur }`. Le generateur de sons s'en sert pour ecrire ses
   *  scenarios (demarrage, ralenti a froid...). */
  forcer(e) {
    this.dernier = { rpm: e.rpm, charge: e.charge ?? 0.3, coupure: !!e.coupure, lever: !!e.lever, rapport: 0 };
    this.noeud?.port.postMessage({ t: 'etat', marche: e.marche ?? true, rpm: e.rpm, charge: e.charge ?? 0.3, coupure: !!e.coupure, lever: !!e.lever, gaz: e.gaz ?? 0, demarreur: e.demarreur ?? 0 });
  }

  couper() {
    this.noeud?.port.postMessage({ t: 'etat', marche: false, rpm: this.recette?.ralenti ?? 800, charge: 0, coupure: true, lever: false, gaz: 0 });
  }

  detruire() {
    this.couper();
    setTimeout(() => this.noeud?.disconnect(), 400);
  }
}
