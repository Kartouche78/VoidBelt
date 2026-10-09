// Le moteur du jeu : celui que la Creation a choisi, garde dans ce
// navigateur. Partage par l'atelier (qui l'ecrit) et le jeu (qui le lit).
//
// Le jeu regenere ses sons a chaque chargement a partir de la recette, il
// ne stocke aucun fichier : un changement du generateur s'applique donc
// tout seul. `versionSon` est garde pour le jour ou des sons seront
// stockes : un enregistrement plus vieux que VERSION_SON serait a refaire.

import { normaliser, recetteUsine, synthese, MOTEUR_JEU, VERSION_SON } from './recettes.js';

const CLE = 'skidmania.moteur.v1';

/** `{ recette, synthese, versionSon }` du moteur du jeu. */
export function moteurDuJeu() {
  try {
    const d = JSON.parse(localStorage.getItem(CLE));
    if (d && d.recette) return { recette: normaliser(d.recette), synthese: synthese(d.synthese), versionSon: d.versionSon ?? 1 };
  } catch {
    /* rien d'enregistre, ou stockage bloque */
  }
  return { recette: recetteUsine(MOTEUR_JEU), synthese: synthese({}), versionSon: VERSION_SON };
}

export function choisirPourLeJeu(recette, reglages) {
  try {
    localStorage.setItem(CLE, JSON.stringify({ recette, synthese: reglages, versionSon: VERSION_SON }));
    return true;
  } catch {
    return false;
  }
}
