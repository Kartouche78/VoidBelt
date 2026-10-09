// Recettes de son moteur : les curseurs, les valeurs par defaut, les 13
// moteurs d'usine et les reglages de finition. Repris de Skidball
// (`web/src/game/effets.js`) ; les curseurs gardent leur nom et leur sens,
// seul leur effet interne a change (voir `moteur-worklet.js`).
//
// `versionSon` : version du generateur qui a fabrique les sons d'une
// recette. Skid Mania regenere ses sons a chaque chargement, donc rien n'est
// jamais perime ici ; le champ sert le jour ou des sons seront stockes (un
// fichier publie dont la version est plus vieille que VERSION_SON est a
// regenerer).

import { ARCHITECTURES } from './moteur.js';

/** Version du generateur de son. 1 : celui de Skidball ; 2 : sans stridence. */
export const VERSION_SON = 2;

/** `[cle, titre, min, max, pas, groupe]`. */
export const CURSEURS = [
  ['cylindree', 'Cylindrée (L)', 0.8, 8, 0.1, 'Moteur'],
  ['ralenti', 'Ralenti (tr/min)', 600, 5000, 10, 'Moteur'],
  ['zoneRouge', 'Zone rouge (tr/min)', 5000, 20000, 100, 'Moteur'],
  ['reactivite', 'Réactivité (inertie)', 0, 1, 0.01, 'Moteur'],
  ['irregularite', 'Ralenti irrégulier', 0, 1, 0.01, 'Moteur'],
  ['collecteur', 'Longueur des collecteurs (m)', 0.2, 1.2, 0.01, 'Échappement'],
  ['inegal', 'Collecteurs inégaux', 0, 1, 0.01, 'Échappement'],
  ['ligne', 'Longueur de la ligne (m)', 0.6, 4, 0.05, 'Échappement'],
  ['silencieux', 'Silencieux', 0, 1, 0.01, 'Échappement'],
  // v2 : le mordant raidit le front de la bouffee au lieu d'amplifier les
  // aigus (meme sens a l'oreille : plus d'attaque).
  ['mordant', 'Mordant (attaque)', 0, 1, 0.01, 'Échappement'],
  ['souffle', 'Souffle', 0, 1, 0.01, 'Échappement'],
  ['rugosite', 'Rugosité', 0, 1, 0.01, 'Échappement'],
  ['aspiration', 'Bruit d’admission', 0, 1, 0.01, 'Admission et turbo'],
  ['resoAdm', 'Résonance d’admission (Hz)', 80, 600, 5, 'Admission et turbo'],
  ['turbo', 'Turbo', 0, 1, 0.01, 'Admission et turbo'],
  ['soupape', 'Soupape de décharge', 0, 1, 0.01, 'Admission et turbo'],
  ['rapports', 'Rapports', 3, 7, 1, 'Boîte'],
  ['passage', 'Passage du rapport (part de la zone rouge)', 0.7, 0.98, 0.01, 'Boîte'],
  ['tempsPassage', 'Durée du passage (s)', 0.05, 0.4, 0.01, 'Boîte'],
  ['sifflementBoite', 'Sifflement de boîte', 0, 1, 0.01, 'Boîte'],
  ['petarades', 'Pétarades au lever de pied', 0, 1, 0.01, 'Lever de pied'],
  ['volume', 'Volume', 0, 1.5, 0.01, 'Mixage'],
  ['largeur', 'Largeur stéréo (V)', 0, 1, 0.01, 'Mixage'],
];

export const LISTE_ARCHITECTURES = Object.entries(ARCHITECTURES).map(([id, [nom]]) => [id, nom]);

export const DEFAUT = {
  architecture: 'l4', cylindree: 2, ralenti: 850, zoneRouge: 7800, reactivite: 0.6, irregularite: 0.3,
  collecteur: 0.5, inegal: 0, ligne: 1.8, silencieux: 0.45, mordant: 0.4, souffle: 0.35, rugosite: 0.3,
  aspiration: 0.5, resoAdm: 260, turbo: 0, soupape: 0.6, rapports: 6, passage: 0.93, tempsPassage: 0.15, sifflementBoite: 0,
  petarades: 0.2, volume: 1, largeur: 0.4,
};

/** Les 13 moteurs d'usine de Skidball. */
export const USINE = [
  { id: 'quatre-sport', nom: 'Kestrel', architecture: 'l4', cylindree: 2, zoneRouge: 8200, mordant: 0.45, aspiration: 0.65, petarades: 0.25 },
  { id: 'v6-turbo', nom: 'Typhoon', architecture: 'v6-60', cylindree: 3, ralenti: 800, zoneRouge: 7200, ligne: 2.2, silencieux: 0.5, mordant: 0.35, souffle: 0.4, rugosite: 0.35, turbo: 0.8, soupape: 0.75, petarades: 0.35, volume: 1.35 },
  { id: 'flat-six', nom: 'Mirage', architecture: 'flat6', cylindree: 3.8, ralenti: 900, zoneRouge: 9000, reactivite: 0.85, collecteur: 0.45, inegal: 0.15, ligne: 1.6, silencieux: 0.3, mordant: 0.55, souffle: 0.3, rugosite: 0.25, aspiration: 0.75, resoAdm: 300, sifflementBoite: 0.25, rapports: 7 },
  { id: 'boxer-rallye', nom: 'Grizzly', architecture: 'flat4', cylindree: 2.5, ralenti: 900, zoneRouge: 7500, collecteur: 0.55, inegal: 0.85, ligne: 1.4, silencieux: 0.35, mordant: 0.4, souffle: 0.45, rugosite: 0.45, turbo: 0.9, soupape: 0.8, petarades: 0.6, sifflementBoite: 0.5, tempsPassage: 0.08 },
  { id: 'v8-muscle', nom: 'Mammoth', architecture: 'v8-croise', cylindree: 6.2, ralenti: 700, zoneRouge: 6800, reactivite: 0.4, irregularite: 0.55, collecteur: 0.7, ligne: 2.6, silencieux: 0.35, mordant: 0.3, souffle: 0.5, rugosite: 0.6, aspiration: 0.55, resoAdm: 180, rapports: 5, petarades: 0.45, largeur: 0.6, volume: 1.45 },
  { id: 'v8-course', nom: 'Raptor', architecture: 'v8-plat', cylindree: 4.5, ralenti: 1000, zoneRouge: 9000, reactivite: 0.9, collecteur: 0.4, ligne: 1.3, silencieux: 0.2, mordant: 0.6, souffle: 0.25, rugosite: 0.35, aspiration: 0.6, sifflementBoite: 0.4, tempsPassage: 0.07, petarades: 0.5, volume: 1.3 },
  { id: 'v10', nom: 'Banshee', architecture: 'v10', cylindree: 5.2, ralenti: 950, zoneRouge: 8700, reactivite: 0.85, collecteur: 0.45, ligne: 1.8, silencieux: 0.3, mordant: 0.55, souffle: 0.3, rugosite: 0.3, aspiration: 0.65, resoAdm: 320, sifflementBoite: 0.2, volume: 1.3 },
  { id: 'v12', nom: 'Leviathan', architecture: 'v12', cylindree: 6.5, ralenti: 800, zoneRouge: 9200, reactivite: 0.7, collecteur: 0.5, ligne: 2.4, silencieux: 0.4, mordant: 0.5, souffle: 0.25, rugosite: 0.2, aspiration: 0.6, resoAdm: 280, volume: 1.3 },
  { id: 'cinq-rallye', nom: 'Cobra', architecture: 'l5', cylindree: 2.2, zoneRouge: 7500, collecteur: 0.55, inegal: 0.3, ligne: 1.5, silencieux: 0.3, mordant: 0.45, souffle: 0.45, rugosite: 0.45, turbo: 0.6, soupape: 0.7, petarades: 0.55, sifflementBoite: 0.35 },
  { id: 'rx7-biturbo', nom: 'Cyclone', architecture: 'rotatif-2', cylindree: 1.3, ralenti: 800, zoneRouge: 8000, reactivite: 0.92, irregularite: 0.65, collecteur: 0.35, inegal: 0, ligne: 2, silencieux: 0.32, mordant: 0.6, souffle: 0.45, rugosite: 0.55, aspiration: 0.55, resoAdm: 340, turbo: 0.85, soupape: 0.6, rapports: 5, passage: 0.95, tempsPassage: 0.12, sifflementBoite: 0.15, petarades: 0.55, volume: 1.15 },
  { id: 'rx7-6-rotors', nom: 'Hydra', architecture: 'rotatif-6', cylindree: 3.9, ralenti: 1000, zoneRouge: 9500, reactivite: 0.95, irregularite: 0.55, collecteur: 0.45, inegal: 0.1, ligne: 2.2, silencieux: 0.28, mordant: 0.6, souffle: 0.4, rugosite: 0.5, aspiration: 0.6, resoAdm: 360, turbo: 0.9, soupape: 0.7, rapports: 6, passage: 0.95, tempsPassage: 0.1, sifflementBoite: 0.25, petarades: 0.6, volume: 1.2, largeur: 0.5 },
  { id: 'f1-v10', nom: 'Howler', architecture: 'v10', cylindree: 3, ralenti: 4200, zoneRouge: 19000, reactivite: 1, irregularite: 0.12, collecteur: 0.38, inegal: 0, ligne: 0.9, silencieux: 0, mordant: 0.7, souffle: 0.15, rugosite: 0.15, aspiration: 0.85, resoAdm: 520, turbo: 0, soupape: 0, rapports: 7, passage: 0.96, tempsPassage: 0.05, sifflementBoite: 0.7, petarades: 0.3, volume: 1.15, largeur: 0.55 },
  { id: 'trois-turbo', nom: 'Hornet', architecture: 'l3', cylindree: 1, ralenti: 900, zoneRouge: 6800, irregularite: 0.45, ligne: 1.6, silencieux: 0.55, mordant: 0.35, souffle: 0.4, rugosite: 0.4, turbo: 0.55, soupape: 0.6, rapports: 6 },
];

/** Moteur de la Koenigsegg tant qu'on n'en a pas choisi d'autre : un V8 a
 *  vilebrequin plat, comme le vrai. */
export const MOTEUR_JEU = 'v8-course';

const borne = (x, a, b, d) => (Number.isFinite(Number(x)) ? Math.min(b, Math.max(a, Number(x))) : d);

/** Recette complete et bornee, quelle que soit sa provenance. */
export function normaliser(e) {
  const out = {
    id: String(e?.id ?? 'perso').replace(/[^a-z0-9-]/gi, '').slice(0, 40) || 'perso',
    nom: String(e?.nom ?? 'Moteur').slice(0, 40),
    architecture: ARCHITECTURES[e?.architecture] ? e.architecture : DEFAUT.architecture,
    versionSon: VERSION_SON,
  };
  for (const [cle, , min, max] of CURSEURS) out[cle] = borne(e?.[cle], min, max, DEFAUT[cle]);
  return out;
}

export const recetteUsine = (id) => normaliser({ ...DEFAUT, ...(USINE.find((u) => u.id === id) ?? USINE[0]) });

/** Finition des sons generes. v2 : douceur 0,4 et grain 0,45 par defaut
 *  (0,25 et 0,3 avant), un cran de plus vers le doux. Leur part dans la
 *  baisse de stridence n'a pas ete mesuree a part : elle etait en place
 *  des la premiere mesure de la v2 (voir RESULTATS-SON.md).
 *  `[cle, titre, min, max, pas, defaut, unite]`. */
export const SYNTHESE = [
  ['grave', 'Graves', -12, 12, 0.5, 0, 'dB'],
  ['aigus', 'Aigus', -12, 12, 0.5, 0, 'dB'],
  ['douceur', 'Douceur (lisse les aigus agressifs)', 0, 1, 0.01, 0.4, ''],
  ['grain', 'Grain (adoucit le crépitement)', 0, 1, 0.01, 0.45, ''],
  ['compression', 'Compression (son plus égal)', 0, 1, 0.01, 0.2, ''],
  ['hauteur', 'Hauteur', -6, 6, 0.5, 0, 'demi-tons'],
  ['espace', 'Espace (réverbération)', 0, 1, 0.01, 0.12, ''],
  ['volume', 'Volume général', 0, 2, 0.01, 1, ''],
  ['vDemarrage', 'Volume : démarrage', 0, 2, 0.01, 1, ''],
  ['vFroid', 'Volume : moteur à froid', 0, 2, 0.01, 1, ''],
  ['vContinu', 'Volume : régime continu', 0, 2, 0.01, 1, ''],
  ['vDeceleration', 'Volume : décélération', 0, 2, 0.01, 1, ''],
];

export function synthese(s) {
  return Object.fromEntries(SYNTHESE.map(([cle, , min, max, , defaut]) => [cle, borne(s?.[cle], min, max, defaut)]));
}
