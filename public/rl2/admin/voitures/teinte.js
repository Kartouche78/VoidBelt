// Recolore le blanc de la carrosserie : bleu ou rouge, en un clic.
//
// Seuls les pixels clairs et sans couleur (la peinture blanche et ses
// ombres grises) changent : vitres, pneus, feux et details sombres restent
// tels quels. Le modele garde son modele : on multiplie la couleur par la
// luminosite d'origine, et les reflets les plus vifs restent blancs, sans
// quoi la carrosserie deviendrait mate.

export const TEINTES = {
  bleu: { nom: 'Bleu', rgb: [47, 124, 224] },
  rouge: { nom: 'Rouge', rgb: [214, 38, 44] },
};

const lisse = (x) => Math.min(1, Math.max(0, x));

/** Rend une copie de `img` dont le blanc de carrosserie est passe a la
 *  teinte `id`. */
export function teinter(img, id) {
  const [cr, cg, cb] = TEINTES[id].rgb;
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const data = g.getImageData(0, 0, w, h);
  const p = data.data;
  for (let i = 0; i < p.length; i += 4) {
    if (p[i + 3] === 0) continue;
    const r = p[i];
    const v = p[i + 1];
    const b = p[i + 2];
    const max = Math.max(r, v, b);
    const min = Math.min(r, v, b);
    const lum = 0.299 * r + 0.587 * v + 0.114 * b;
    const sat = max ? (max - min) / max : 0;
    // Part de « peinture blanche » : claire, et sans teinte propre.
    const part = lisse((lum - 105) / 45) * lisse((0.2 - sat) / 0.08);
    if (part <= 0) continue;
    // La couleur prend l'ombre du blanc ; les reflets vifs blanchissent.
    const k = lum / 225;
    const reflet = lisse((lum - 236) / 18) * 0.7;
    const t = (c) => Math.min(255, c * k * (1 - reflet) + 255 * reflet);
    p[i] = r + (t(cr) - r) * part;
    p[i + 1] = v + (t(cg) - v) * part;
    p[i + 2] = b + (t(cb) - b) * part;
  }
  g.putImageData(data, 0, 0);
  return cv;
}
