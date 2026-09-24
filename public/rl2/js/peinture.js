// Carrosseries peintes : une voiture blanche prend la couleur de son
// equipe (bleu a gauche, orange a droite) ou celle de son clan.
//
// Le calcul se fait dans le moteur Rust (`teinte.rs`) ; ici on charge
// l'image, on la lui passe, et on en fait une texture. Chaque couple
// image + couleur n'est peint qu'une fois.

import * as THREE from '../vendor/three.module.js';

/** Largeur de travail : la voiture fait une centaine de pixels a l'ecran,
 *  512 suffit largement et reste leger a peindre. */
const LARGEUR = 512;

let moteur = null;
const CACHE = new Map();

/** Donne le moteur wasm qui sait peindre. A appeler au demarrage. */
export function brancherPeinture(engine) {
  moteur = engine;
}

/** `#rrggbb` ou nombre `0xrrggbb` vers `[r, g, b]`. */
export function rgb(couleur) {
  const n = typeof couleur === 'number' ? couleur : parseInt(String(couleur).slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** `0xrrggbb` vers `#rrggbb`. */
export function hex(n) {
  return `#${n.toString(16).padStart(6, '0')}`;
}

/** Peint l'image `url` en `couleur` (`#rrggbb`) dans un canevas de
 *  `largeur` px au plus. Sans moteur, ou si l'image refuse d'etre lue,
 *  elle garde ses couleurs d'origine. */
export function peindreToile(url, couleur, largeur = LARGEUR, toile = document.createElement('canvas')) {
  return new Promise((ok, ko) => {
    const img = new Image();
    // Les skins viennent de l'API : sans CORS, l'image ne se relit pas.
    img.crossOrigin = 'anonymous';
    img.onerror = () => ko(new Error(`image introuvable : ${url}`));
    img.onload = () => {
      const w = Math.min(largeur, img.naturalWidth);
      const h = Math.round((img.naturalHeight * w) / img.naturalWidth);
      toile.width = w;
      toile.height = h;
      const g = toile.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0, w, h);
      try {
        const donnees = g.getImageData(0, 0, w, h);
        moteur?.teinter(donnees.data, rgb(couleur));
        g.putImageData(donnees, 0, 0);
      } catch {
        // Image d'une autre origine sans CORS : on la montre telle quelle.
      }
      ok(toile);
    };
    img.src = encodeURI(url);
  });
}

/** Texture de la carrosserie `url` peinte en `couleur`. Elle se remplit
 *  quand l'image arrive. Chaque couple image + couleur n'est peint qu'une
 *  fois. */
export function carrosseriePeinte(url, couleur) {
  const cle = `${url}|${couleur}`;
  const deja = CACHE.get(cle);
  if (deja) return deja;
  // Texture vide tant que l'image n'est pas peinte, comme le fait
  // `TextureLoader` : une toile qui changerait de taille apres son premier
  // envoi a la carte graphique ne serait plus mise a jour.
  const texture = new THREE.Texture();
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  CACHE.set(cle, texture);
  peindreToile(url, couleur)
    .then((toile) => {
      texture.image = toile;
      texture.needsUpdate = true;
    })
    .catch(() => {});
  return texture;
}
