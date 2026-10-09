// Finition v2 des sons generes : apres la chaine d'origine (graves, aigus,
// grain, douceur, compresseur, petite salle), un filet de securite contre
// la stridence, puis une normalisation en sonie et un limiteur de true peak.
//
//   - de-esser : un egaliseur dynamique sur 2,5-6 kHz qui ne mord que quand
//     cette bande deborde du reste. Ce n'est pas la correction principale
//     (elle est dans le generateur), seulement un filet.
//   - sonie : chaque son vise sa propre cible (LUFS), ce qui garde les
//     ecarts voulus entre eux (le ralenti plus bas que le regime continu),
//     au lieu d'une normalisation en crete qui laisse le volume percu
//     varier d'un moteur a l'autre.
//   - limiteur a anticipation : true peak sous -1 dBTP, sans distorsion.
//
// Une boucle est traitee deux fois de suite et on garde le second passage :
// enveloppes et limiteur y sont deja lances, le raccord reste propre.

import { appliquerSynthese } from './generateur.js';
import { synthese as reglages } from './recettes.js';
import { lufs, truePeak } from './mesures.js';

/** Sonie visee par chaque son (LUFS) : le continu sert de reference. */
export const CIBLES = { demarrage: -17, froid: -19, continu: -16, deceleration: -18 };
const VOLUME_SON = { demarrage: 'vDemarrage', froid: 'vFroid', continu: 'vContinu', deceleration: 'vDeceleration' };

/** Coefficients RBJ normalises `[b0, b1, b2, a1, a2]`. */
function coefs(type, f, q, fs) {
  const w = (2 * Math.PI * f) / fs;
  const cs = Math.cos(w);
  const al = Math.sin(w) / (2 * q);
  const a0 = 1 + al;
  const b = type === 'bas' ? [(1 - cs) / 2, 1 - cs, (1 - cs) / 2] : [(1 + cs) / 2, -(1 + cs), (1 + cs) / 2];
  return [b[0] / a0, b[1] / a0, b[2] / a0, (-2 * cs) / a0, (1 - al) / a0];
}

function filtrer(x, c) {
  const y = new Float32Array(x.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i += 1) {
    const v = c[0] * x[i] + c[1] * x1 + c[2] * x2 - c[3] * y1 - c[4] * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v;
    y[i] = v;
  }
  return y;
}

/** De-esser : quand l'energie 2,5-6 kHz depasse `seuil` (dB) par rapport au
 *  signal entier, la bande est reduite au taux de 3:1. */
export function deEsser(x, fs, seuil = -14) {
  const band = filtrer(filtrer(filtrer(filtrer(x, coefs('haut', 2500, 0.7, fs)), coefs('haut', 2500, 0.7, fs)), coefs('bas', 6000, 0.7, fs)), coefs('bas', 6000, 0.7, fs));
  const kEnv = 1 - Math.exp(-1 / (0.005 * fs));
  const kAtt = 1 - Math.exp(-1 / (0.002 * fs));
  const kRel = 1 - Math.exp(-1 / (0.06 * fs));
  const lim = Math.pow(10, seuil / 10);
  const y = new Float32Array(x.length);
  let eb = 0;
  let ex = 1e-9;
  let g = 1;
  for (let i = 0; i < x.length; i += 1) {
    eb += (band[i] * band[i] - eb) * kEnv;
    ex += (x[i] * x[i] - ex) * kEnv;
    const rapport = eb / Math.max(ex, 1e-12);
    // au-dela du seuil : 3:1 sur l'exces (en puissance)
    const cible = rapport > lim ? Math.pow(lim / rapport, (1 - 1 / 3) / 2) : 1;
    g += (cible - g) * (cible < g ? kAtt : kRel);
    y[i] = x[i] - band[i] * (1 - g);
  }
  return y;
}

/** Limiteur a anticipation : gain jamais au-dessus de ce qu'il faut pour
 *  rester sous `seuil` (dBFS), rampes douces, pas de distorsion. */
export function limiter(x, fs, seuil = -1.5) {
  const lim = Math.pow(10, seuil / 20);
  const L = Math.round(0.003 * fs);
  const n = x.length;
  const besoin = new Float32Array(n);
  for (let i = 0; i < n; i += 1) besoin[i] = Math.min(1, lim / Math.max(Math.abs(x[i]), 1e-9));
  // minimum glissant sur +-L : le gain commence a baisser L echantillons
  // avant le pic (l'anticipation), avec une attaque exponentielle qui l'y
  // amene a temps ; puis il remonte lentement.
  const mini = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    let m = 1;
    for (let j = Math.max(0, i - L); j < Math.min(n, i + L); j += 1) if (besoin[j] < m) m = besoin[j];
    mini[i] = m;
  }
  const y = new Float32Array(n);
  const kAtt = 1 - Math.exp(-5 / L);
  const kRel = 1 - Math.exp(-1 / (0.08 * fs));
  let g = 1;
  for (let i = 0; i < n; i += 1) {
    g += (mini[i] - g) * (mini[i] < g ? kAtt : kRel);
    // garde-fou : jamais au-dessus du besoin de cet echantillon
    y[i] = x[i] * Math.min(g, besoin[i]);
  }
  return y;
}

/** Fin propre d'un son ponctuel : quelques millisecondes de fondu. */
function fondu(x, fs) {
  const n = Math.round(fs * 0.04);
  for (let i = 0; i < n && i < x.length; i += 1) x[x.length - 1 - i] *= i / n;
  return x;
}

/** Finit un son brut (`Float32Array`, mono) : rend un `Float32Array`. */
export async function finir(brut, son, s, fs) {
  const r = reglages(s);
  const base = await appliquerSynthese(brut, son, r);
  const double = (x) => {
    if (!son.boucle) return x;
    const d = new Float32Array(x.length * 2);
    d.set(x, 0);
    d.set(x, x.length);
    return d;
  };
  const garder = (d, L) => (son.boucle ? d.slice(d.length - L) : d);
  const L = base.length;
  let x = garder(deEsser(double(base), fs), L);
  const cible = CIBLES[son.id] + 20 * Math.log10(Math.max(1e-3, r.volume * r[VOLUME_SON[son.id]]));
  // gain de sonie, limiteur, et un second tour : le limiteur a pu retirer
  // un peu de sonie, on la rend.
  for (let tour = 0; tour < 2; tour += 1) {
    const g = Math.pow(10, (cible - lufs(x, fs)) / 20);
    const y = double(x.map((v) => v * g));
    x = garder(limiter(y, fs), L);
  }
  // true peak : le limiteur travaille sur les echantillons ; s'il reste un
  // pic entre deux, on redescend d'autant.
  const tp = truePeak(x);
  if (tp > -1) {
    const k = Math.pow(10, (-1.05 - tp) / 20);
    x = x.map((v) => v * k);
  }
  return son.boucle ? x : fondu(x, fs);
}
