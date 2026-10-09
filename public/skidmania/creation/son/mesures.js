// Mesures d'un son, sans dependance : FFT, centroide, stridence, sonie
// (LUFS, ITU-R BS.1770), true peak, facteur de crete, pics tonals et
// repliement. Le meme fichier sert au banc de mesure (Node) et a la
// finition des sons dans le navigateur (normalisation en sonie).

const db = (p) => 10 * Math.log10(Math.max(p, 1e-30));

/** FFT radix 2 en place. */
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len;
    const wr = Math.cos(a);
    const wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k += 1) {
        const p = i + k;
        const q = p + len / 2;
        const tr = re[q] * cr - im[q] * ci;
        const ti = re[q] * ci + im[q] * cr;
        re[q] = re[p] - tr;
        im[q] = im[p] - ti;
        re[p] += tr;
        im[p] += ti;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

const hann = (n) => Float64Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));

/** Spectre de puissance d'une trame commencant en `o`. */
function trame(x, o, n, w) {
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i += 1) re[i] = (x[o + i] ?? 0) * w[i];
  fft(re, im);
  const p = new Float64Array(n / 2);
  for (let k = 0; k < n / 2; k += 1) p[k] = re[k] * re[k] + im[k] * im[k];
  return p;
}

/** Spectre de puissance moyen (Welch, Hann, recouvrement de moitie). */
export function spectre(x, fs, n = 4096) {
  const w = hann(n);
  const moy = new Float64Array(n / 2);
  let m = 0;
  for (let o = 0; o + n <= x.length; o += n / 2) {
    const p = trame(x, o, n, w);
    for (let k = 0; k < moy.length; k += 1) moy[k] += p[k];
    m += 1;
  }
  for (let k = 0; k < moy.length; k += 1) moy[k] /= Math.max(1, m);
  return { p: moy, df: fs / n };
}

function bande({ p, df }, f1, f2) {
  let e = 0;
  for (let k = Math.ceil(f1 / df); k <= Math.floor(f2 / df) && k < p.length; k += 1) e += p[k];
  return e;
}

export function centroide(sp) {
  let a = 0;
  let b = 0;
  for (let k = 1; k < sp.p.length; k += 1) {
    a += k * sp.df * sp.p[k];
    b += sp.p[k];
  }
  return a / Math.max(b, 1e-30);
}

/** Indice de stridence : energie 2-6 kHz rapportee a 80-1000 Hz, en dB. */
export const stridence = (sp) => db(bande(sp, 2000, 6000) / bande(sp, 80, 1000));

/** Biquad applique a tout un tableau (coefficients normalises). */
function biquad(x, [b0, b1, b2, a1, a2]) {
  const y = new Float64Array(x.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i += 1) {
    const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v;
    y[i] = v;
  }
  return y;
}

/** Ponderation K (BS.1770) a n'importe quelle frequence d'echantillonnage :
 *  plateau aigu puis passe-haut RLB, coefficients recalcules (comme
 *  pyloudnorm). */
function ponderationK(x, fs) {
  let f0 = 1681.974450955533;
  let G = 3.999843853973347;
  let Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / fs);
  const Vh = Math.pow(10, G / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const plateau = [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0];
  f0 = 38.13547087602444;
  Q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / fs);
  a0 = 1 + K / Q + K * K;
  const rlb = [1, -2, 1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0];
  return biquad(biquad(x, plateau), rlb);
}

/** Sonie integree (LUFS) d'un son mono, avec les deux portes de BS.1770. */
export function lufs(x, fs) {
  const y = ponderationK(x, fs);
  const bloc = Math.round(0.4 * fs);
  const pas = Math.round(0.1 * fs);
  const z = [];
  for (let o = 0; o + bloc <= y.length; o += pas) {
    let s = 0;
    for (let i = o; i < o + bloc; i += 1) s += y[i] * y[i];
    z.push(s / bloc);
  }
  if (!z.length) return -Infinity;
  const l = (m) => -0.691 + db(m);
  const absolus = z.filter((m) => l(m) > -70);
  if (!absolus.length) return -Infinity;
  const seuil = l(absolus.reduce((a, b) => a + b, 0) / absolus.length) - 10;
  const gardes = absolus.filter((m) => l(m) > seuil);
  return l(gardes.reduce((a, b) => a + b, 0) / gardes.length);
}

/** True peak (dBTP) : suréchantillonnage x4 par sinus cardinal fenetre. */
export function truePeak(x) {
  const T = 12;
  let pic = 0;
  for (let i = 0; i < x.length; i += 1) {
    pic = Math.max(pic, Math.abs(x[i]));
    for (let ph = 1; ph < 4; ph += 1) {
      const t = ph / 4;
      let v = 0;
      for (let k = -T + 1; k <= T; k += 1) {
        const j = i + k;
        if (j < 0 || j >= x.length) continue;
        const u = k - t;
        const w = 0.5 + 0.5 * Math.cos((Math.PI * u) / T);
        v += x[j] * (Math.sin(Math.PI * u) / (Math.PI * u)) * w;
      }
      pic = Math.max(pic, Math.abs(v));
    }
  }
  return 20 * Math.log10(Math.max(pic, 1e-12));
}

export function facteurCrete(x) {
  let pic = 0;
  let s = 0;
  for (const v of x) {
    pic = Math.max(pic, Math.abs(v));
    s += v * v;
  }
  return 20 * Math.log10(pic / Math.sqrt(s / x.length + 1e-30));
}

/** Pics tonals isoles au-dessus de 3 kHz : niveau du plus fort, en dB par
 *  rapport au fondamental (le pic le plus fort sous 1,2 kHz). Un pic compte
 *  s'il depasse de 10 dB la mediane de son voisinage. */
export function picsTonals(x, fs) {
  const sp = spectre(x, fs, 8192);
  const { p, df } = sp;
  let ref = 0;
  // le fondamental d'allumage monte jusqu'a ~800 Hz sur une F1 a mi-regime
  for (let k = Math.ceil(30 / df); k < 1200 / df; k += 1) ref = Math.max(ref, p[k]);
  let pire = -Infinity;
  let fPire = 0;
  const V = 40;
  for (let k = Math.ceil(3000 / df); k < p.length - V; k += 1) {
    if (p[k] < p[k - 1] || p[k] < p[k + 1]) continue;
    const voisins = Array.from(p.slice(k - V, k + V)).sort((a, b) => a - b);
    const mediane = voisins[V];
    if (db(p[k] / mediane) < 10) continue;
    const niveau = db(p[k] / ref);
    if (niveau > pire) {
      pire = niveau;
      fPire = k * df;
    }
  }
  return { niveau: pire, frequence: fPire };
}

/** Repliement : sur un balayage de regime montant, cherche les composantes
 *  qui descendent. Rend le niveau (dB sous le maximum de la trame) de la
 *  plus forte composante suivie qui descend sur au moins 4 trames. */
export function repliement(x, fs, detail = false) {
  // FFT de 4096 (11,7 Hz par case a 48 kHz) et pas court : assez fine pour
  // separer les harmoniques d'un V8 a mi-regime, assez courte pour qu'une
  // composante qui balaie reste un pic.
  const n = 4096;
  const hop = 512;
  const w = hann(n);
  const trames = [];
  for (let o = 0; o + n <= x.length; o += hop) {
    const p = trame(x, o, n, w);
    let max = 0;
    for (const v of p) max = Math.max(max, v);
    const pics = [];
    for (let k = Math.ceil(800 / (fs / n)); k < p.length - 6; k += 1) {
      if (!(p[k] > p[k - 1] && p[k] >= p[k + 1] && p[k] > p[k - 2] && p[k] >= p[k + 2])) continue;
      const lvl = db(p[k] / max);
      if (lvl < -60) continue;
      const voisins = Array.from(p.slice(k - 6, k + 7)).sort((a, b) => a - b);
      if (db(p[k] / voisins[6]) < 10) continue;
      pics.push({ k, lvl });
    }
    trames.push(pics);
  }
  // suivi au plus proche, 2 cases au plus d'une trame a l'autre (21 Hz en
  // 10,7 ms : plus vite que toute composante repliee d'un balayage de 6 s ;
  // plus loin, le suivi sauterait sur l'harmonique voisine quand l'une
  // s'eteint en sortant d'une resonance de la ligne). Une piste
  // compte comme descendante tant qu'elle ne remonte jamais ; il lui faut
  // 10 trames et 4 cases de descente. Les harmoniques d'un balayage
  // montant montent : elles ne passent jamais le test.
  let pire = -Infinity;
  let ou = null;
  let pistes = [];
  for (let it = 0; it < trames.length; it += 1) {
    const nouvelles = [];
    for (const pk of trames[it]) {
      let avant = null;
      for (const t of pistes) {
        if (Math.abs(t.k - pk.k) <= 2 && (!avant || Math.abs(t.k - pk.k) < Math.abs(avant.k - pk.k))) avant = t;
      }
      let piste;
      if (avant && pk.k <= avant.k) piste = { k: pk.k, k0: avant.k0, long: avant.long + 1, lvl: Math.max(avant.lvl, pk.lvl) };
      else piste = { k: pk.k, k0: pk.k, long: 0, lvl: pk.lvl };
      nouvelles.push(piste);
      if (piste.long >= 10 && piste.k0 - piste.k >= 4 && piste.lvl > pire) {
        pire = piste.lvl;
        ou = { f: (pk.k * fs) / n, f0: (piste.k0 * fs) / n, t: (it * hop) / fs };
      }
    }
    pistes = nouvelles;
  }
  if (detail) return { niveau: pire, ...ou };
  return pire;
}

/** Clic au raccord d'une boucle : saut entre la fin et le debut, rapporte
 *  au 99,9e centile des sauts d'un echantillon au suivant. */
export function clicBoucle(x) {
  const sauts = [];
  for (let i = 1; i < x.length; i += 1) sauts.push(Math.abs(x[i] - x[i - 1]));
  sauts.sort((a, b) => a - b);
  const p999 = sauts[Math.floor(sauts.length * 0.999)];
  return Math.abs(x[0] - x[x.length - 1]) / Math.max(p999, 1e-9);
}

/** Toutes les mesures d'un son. */
export function mesurer(x, fs) {
  const sp = spectre(x, fs);
  return {
    stridence: stridence(sp),
    centroide: centroide(sp),
    lufs: lufs(x, fs),
    truePeak: truePeak(x),
    crete: facteurCrete(x),
    tonal: picsTonals(x, fs),
  };
}

/** Rejoue un son plus vite (`playbackRate`), par interpolation lineaire. */
export function accelerer(x, k) {
  const n = Math.floor((x.length - 1) / k);
  const y = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const t = i * k;
    const j = Math.floor(t);
    y[i] = x[j] + (x[j + 1] - x[j]) * (t - j);
  }
  return y;
}
