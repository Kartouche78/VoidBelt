// Generateur de sons moteur : les quatre sons dont le jeu a besoin, tires du
// simulateur (`moteur.js`, `moteur-worklet.js`) et rendus hors ligne en
// fichiers.
//
//   demarrage      le demarreur entraine le moteur, il prend, s'emballe un
//                  instant et se pose au ralenti          -> engineStart
//   froid          ralenti a froid : plus haut, irregulier, en boucle
//                                                         -> engineCold
//   continu        regime de croisiere sous charge, en boucle ; le jeu en
//                  fait varier la hauteur avec la vitesse -> engineOn
//   deceleration   lever de pied a haut regime : le regime tombe, frein
//                  moteur et petarades                    -> engineDecel
//
// Chaque scenario est une suite d'etats, pilotee image par image comme en
// jeu : directement (regime impose) ou par la boite pour l'acceleration.
//
// Repris de Skidball (`web/src/game/generateur-moteur.js`). Deux versions :
// `reference` refait exactement la chaine d'origine (normalisation en crete,
// finition d'origine) pour le banc de mesure ; `v2` finit les sons en sonie
// (`finition.js`).

import { Boite, rendreScenario } from './moteur.js';
import { synthese as reglagesSynthese } from './recettes.js';
import { finir } from './finition.js';

const FS = 44100;
const PAS = 1 / 60;

/** Les cinq sons, dans l'ordre, et l'emplacement du jeu de chacun. */
export const SONS_MOTEUR = [
  { id: 'demarrage', nom: 'Démarrage', emplacement: 'engineStart', duree: 2.8 },
  { id: 'froid', nom: 'Moteur à froid', emplacement: 'engineCold', duree: 3, boucle: true },
  { id: 'continu', nom: 'Régime continu', emplacement: 'engineOn', duree: 3, boucle: true },
  { id: 'deceleration', nom: 'Décélération', emplacement: 'engineDecel', duree: 2.6 },
];

/** Regime du son « continu » : le jeu le joue plus bas a petite vitesse et
 *  plus haut a pleine vitesse (0,82 a 1,28) ; au milieu, il sonne a la
 *  moitie de la zone rouge, comme une voiture lancee sur un rapport long. */
export const REGIME_CONTINU = 0.5;

const lisse = (a, b, t) => a + (b - a) * Math.min(1, Math.max(0, t));

/** Etat du moteur a l'instant `t` de chaque scenario pilote directement. */
const SCENARIOS = {
  demarrage(r, t) {
    const ralenti = r.ralenti;
    // 0 a 0,9 s : le demarreur tourne, sans injection (les compressions).
    if (t < 0.9) return { rpm: 210 + Math.sin(t * 40) * 20, charge: 0, coupure: true, demarreur: 1 };
    // Il prend : un coup de gaz qui s'emballe, puis retombe au ralenti
    // haut d'un moteur froid.
    const u = t - 0.9;
    const pic = ralenti * 2.1;
    const rpm = u < 0.25 ? lisse(400, pic, u / 0.25) : lisse(pic, ralenti * 1.3, (u - 0.25) / 0.9);
    return { rpm, charge: u < 0.3 ? 0.65 : 0.3, coupure: false, demarreur: u < 0.12 ? 1 - u / 0.12 : 0 };
  },
  froid(r, t) {
    // Ralenti haut d'un moteur froid, qui ondule un peu.
    return { rpm: r.ralenti * 1.28 + Math.sin(t * 2.1) * r.ralenti * 0.03, charge: 0.28, coupure: false };
  },
  continu(r) {
    return { rpm: r.zoneRouge * REGIME_CONTINU, charge: 0.62, coupure: false, gaz: 0.6 };
  },
  deceleration(r, t) {
    // Lever de pied a haut regime : plus d'injection, le regime tombe.
    const rpm = r.zoneRouge * (0.3 + 0.52 * Math.exp(-t * 1.25));
    return { rpm, charge: 0.18, coupure: true, lever: true, gaz: 0 };
  },
};

/** Rend un son (`SONS_MOTEUR`) : `AudioBuffer` stereo. */
async function rendre(recette, son, version) {
  // Le ralenti a froid est plus irregulier qu'a chaud.
  const r = son.id === 'froid' ? { ...recette, irregularite: Math.min(1, recette.irregularite + 0.3) } : recette;
  // Une boucle se rend un peu plus longue : la fin se fond dans le debut.
  const duree = son.duree + (son.boucle ? 0.5 : 0);
  // Le scenario est ecrit d'avance, une image (1/60 s) apres l'autre.
  let pilote;
  if (son.id === 'acceleration') {
    // Pied au plancher depuis l'arret, par la vraie boite : on entend
    // l'embrayage, la premiere qui monte et les passages.
    const boite = new Boite(r);
    let v = 0;
    pilote = (t) => {
      const gaz = t < 0.25 ? 0 : 1;
      const e = boite.maj({ vitesse: v, gaz }, PAS);
      v = Math.min(1, v + (e.coupure ? 0 : gaz * 0.3 * Math.pow(1 - v, 0.7)) * PAS);
      return { rpm: e.rpm, charge: e.charge, coupure: e.coupure, lever: e.lever, gaz };
    };
  } else {
    pilote = (t) => SCENARIOS[son.id](r, t);
  }
  const etats = [];
  for (let k = 0; k * PAS < duree; k += 1) etats.push({ gaz: 0, demarreur: 0, ...pilote(k * PAS), t: k * PAS });
  return rendreScenario(r, etats, duree, FS, { version });
}

/** Mono, et boucle sans couture : les `fondu` dernieres secondes se
 *  fondent dans le debut. Rend un `Float32Array`. */
function preparer(buffer, son) {
  const g = buffer.getChannelData(0);
  const d = buffer.getChannelData(1);
  const mono = new Float32Array(g.length);
  for (let i = 0; i < g.length; i += 1) mono[i] = (g[i] + d[i]) * 0.5;
  if (!son.boucle) {
    // Pas de clic a la fin : quelques millisecondes de fondu.
    const n = Math.round(FS * 0.03);
    for (let i = 0; i < n; i += 1) mono[mono.length - 1 - i] *= i / n;
    return mono;
  }
  const L = Math.round(son.duree * FS);
  const X = mono.length - L;
  const boucle = mono.slice(0, L);
  for (let i = 0; i < X; i += 1) {
    const a = i / X;
    boucle[i] = mono[i] * a + mono[L + i] * (1 - a);
  }
  return boucle;
}

/** Les cinq sons d'une recette de moteur : `{ [id]: Float32Array }`, a
 *  44,1 kHz, tous normalises du meme gain (leurs volumes relatifs restent
 *  ceux du moteur). `progres(k, n)` suit l'avancement. */
export async function genererBruts(recette, { version = 'v2', progres = () => {} } = {}) {
  const sons = {};
  for (const [k, son] of SONS_MOTEUR.entries()) {
    progres(k, SONS_MOTEUR.length);
    sons[son.id] = preparer(await rendre(recette, son, version), son);
  }
  let crete = 0;
  for (const s of Object.values(sons)) for (let i = 0; i < s.length; i += 1) crete = Math.max(crete, Math.abs(s[i]));
  const gain = crete > 0 ? 0.85 / crete : 1;
  for (const s of Object.values(sons)) for (let i = 0; i < s.length; i += 1) s[i] *= gain;
  progres(SONS_MOTEUR.length, SONS_MOTEUR.length);
  return sons;
}

/** Les quatre sons d'une recette, finis, prets a jouer : `{ [id]:
 *  Float32Array }` a 44,1 kHz. `synthese` : reglages de finition. */
export async function genererSons(recette, { version = 'v2', synthese = {}, progres = () => {} } = {}) {
  const bruts = await genererBruts(recette, { version, progres });
  const finis = {};
  for (const son of SONS_MOTEUR) {
    finis[son.id] = version === 'reference'
      ? await appliquerSynthese(bruts[son.id], son, { ...synthese, douceur: synthese.douceur ?? 0.25, grain: synthese.grain ?? 0.3 })
      : await finir(bruts[son.id], son, synthese, FS);
  }
  return finis;
}

/** WAV mono 16 bits d'un son genere. */
export function wavMono(echantillons, fs = FS) {
  const n = echantillons.length;
  const vue = new DataView(new ArrayBuffer(44 + n * 2));
  const ecrire = (o, s) => [...s].forEach((c, i) => vue.setUint8(o + i, c.charCodeAt(0)));
  ecrire(0, 'RIFF');
  vue.setUint32(4, 36 + n * 2, true);
  ecrire(8, 'WAVEfmt ');
  vue.setUint32(16, 16, true);
  vue.setUint16(20, 1, true);
  vue.setUint16(22, 1, true);
  vue.setUint32(24, fs, true);
  vue.setUint32(28, fs * 2, true);
  vue.setUint16(32, 2, true);
  vue.setUint16(34, 16, true);
  ecrire(36, 'data');
  vue.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i += 1) vue.setInt16(44 + i * 2, Math.max(-1, Math.min(1, echantillons[i])) * 32767, true);
  return vue.buffer;
}

export const FREQUENCE = FS;

/** Volume propre de chaque son dans les reglages de synthese. */
const VOLUME_SON = { demarrage: 'vDemarrage', froid: 'vFroid', continu: 'vContinu', deceleration: 'vDeceleration' };

/** Reponse d'une petite salle : du bruit qui s'eteint, un peu plus vite
 *  dans les aigus. Bruit a graine : deux rendus restent identiques. */
export function reponseSalle(ctx) {
  const n = Math.round(FS * 1.1);
  const b = ctx.createBuffer(1, n, FS);
  const d = b.getChannelData(0);
  let lisse = 0;
  let graine = 777;
  const alea = () => {
    graine = (Math.imul(graine, 1664525) + 1013904223) | 0;
    return (graine >>> 0) / 4294967296;
  };
  for (let i = 0; i < n; i += 1) {
    lisse += ((alea() * 2 - 1) - lisse) * (0.6 - (i / n) * 0.45);
    d[i] = lisse * Math.exp((-i / n) * 6);
  }
  return b;
}

/** Applique la synthese `s` (voir `SYNTHESE`) au son brut `brut` (mono,
 *  44,1 kHz) du son `son` de `SONS_MOTEUR`. Rend un `Float32Array`.
 *  Une boucle reste une boucle : on la traite deux fois de suite et on
 *  garde le second passage, ou filtres et reverberation sont deja lances. */
export async function appliquerSynthese(brut, son, s) {
  // Version d'origine : normalisation en crete faite par l'appelant, chaine
  // ci-dessous telle quelle.
  const r = reglagesSynthese(s);
  const vitesse = Math.pow(2, r.hauteur / 12);
  const entree = son.boucle ? new Float32Array(brut.length * 2) : brut;
  if (son.boucle) {
    entree.set(brut, 0);
    entree.set(brut, brut.length);
  }
  const queue = son.boucle ? 0 : Math.round(FS * r.espace * 0.8);
  const longueur = Math.ceil(entree.length / vitesse) + queue;
  const ctx = new OfflineAudioContext(1, longueur, FS);
  const buf = ctx.createBuffer(1, entree.length, FS);
  buf.copyToChannel(entree, 0);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = vitesse;
  const filtre = (type, f, q, gain = 0) => {
    const b = ctx.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    b.Q.value = q;
    b.gain.value = gain;
    return b;
  };
  const grave = filtre('lowshelf', 160, 0.7, r.grave);
  const aigus = filtre('highshelf', 3200, 0.7, r.aigus);
  // Douceur : un passe-bas qui descend de 18 kHz a 1,6 kHz.
  const douceur = filtre('lowpass', 1600 + 16400 * Math.pow(1 - r.douceur, 2), 0.5);
  // Grain : creuse la bande ou crepitent les bouffees (3 a 6 kHz).
  const grain = filtre('peaking', 4200, 0.8, -14 * r.grain);
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -6 - 30 * r.compression;
  comp.ratio.value = 1 + 9 * r.compression;
  comp.knee.value = 12;
  comp.attack.value = 0.01;
  comp.release.value = 0.2;
  // Le compresseur baisse le niveau : on rend une partie de ce qu'il prend.
  const rattrapage = ctx.createGain();
  rattrapage.gain.value = 1 + 0.5 * r.compression;
  const sec = ctx.createGain();
  const salleN = ctx.createConvolver();
  salleN.buffer = reponseSalle(ctx);
  const humide = ctx.createGain();
  humide.gain.value = r.espace * 0.6;
  sec.gain.value = 1 - r.espace * 0.35;
  const sortie = ctx.createGain();
  sortie.gain.value = r.volume * r[VOLUME_SON[son.id]];
  src.connect(grave).connect(aigus).connect(grain).connect(douceur).connect(comp).connect(rattrapage);
  rattrapage.connect(sec).connect(sortie);
  rattrapage.connect(salleN).connect(humide).connect(sortie);
  sortie.connect(ctx.destination);
  src.start();
  const rendu = (await ctx.startRendering()).getChannelData(0);
  let out;
  if (son.boucle) {
    const L = Math.round(brut.length / vitesse);
    out = rendu.slice(rendu.length - L);
  } else {
    out = rendu.slice();
    const n = Math.round(FS * 0.04);
    for (let i = 0; i < n && i < out.length; i += 1) out[out.length - 1 - i] *= i / n;
  }
  // Jamais de saturation : on redescend sous 0,95 si besoin.
  let crete = 0;
  for (let i = 0; i < out.length; i += 1) crete = Math.max(crete, Math.abs(out[i]));
  if (crete > 0.95) for (let i = 0; i < out.length; i += 1) out[i] *= 0.95 / crete;
  return out;
}
