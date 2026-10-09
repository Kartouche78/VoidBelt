// Banc de mesure, cote navigateur : rend les sons d'un moteur d'usine et
// les renvoie a Node (tests/skidmania-son/mesurer.mjs), qui les mesure.
// Rien ici n'est joue : tout est rendu hors ligne.

import { USINE, recetteUsine } from './recettes.js';
import { genererSons, SONS_MOTEUR, FREQUENCE } from './generateur.js';
import { rendreHorsLigne } from './banc.js';
import { rendreScenario } from './moteur.js';

/** Float32Array en base64, pour passer a Node sans JSON geant. */
function enBase64(f32) {
  const octets = new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength);
  let s = '';
  for (let i = 0; i < octets.length; i += 0x8000) s += String.fromCharCode(...octets.subarray(i, i + 0x8000));
  return btoa(s);
}

const mono = (buf) => {
  const g = buf.getChannelData(0);
  const d = buf.getChannelData(1);
  return Float32Array.from(g, (v, i) => (v + d[i]) * 0.5);
};

/** Balayage de regime, du ralenti a la zone rouge en 6 s, sans aucune
 *  source de bruit : ce qui descend dans le spectre ne peut etre que du
 *  repliement. */
async function balayage(recette, version) {
  const r = { ...recette, irregularite: 0, souffle: 0, aspiration: 0, turbo: 0, petarades: 0 };
  const duree = 6;
  const etats = [];
  for (let k = 0; k * (1 / 60) < duree; k += 1) {
    const t = k / 60;
    etats.push({ t, rpm: r.ralenti + (r.zoneRouge - r.ralenti) * (t / duree), charge: 0.8, coupure: false, lever: false, gaz: 0.8 });
  }
  return mono(await rendreScenario(r, etats, duree, 48000, { version }));
}

window.banc = {
  moteurs: USINE.map((u) => ({ id: u.id, nom: u.nom })),
  async rendre(id, version) {
    const recette = recetteUsine(id);
    const sons = await genererSons(recette, { version });
    const t0 = performance.now();
    const tour = await rendreHorsLigne(recette, 'tour', null, version);
    const ms = performance.now() - t0;
    const sec = tour.length / tour.sampleRate;
    return {
      fs: FREQUENCE,
      sons: Object.fromEntries(SONS_MOTEUR.map((s) => [s.id, enBase64(sons[s.id])])),
      tour: enBase64(mono(tour)),
      fsTour: tour.sampleRate,
      balayage: enBase64(await balayage(recette, version)),
      // part du temps reel que prend le rendu : la meme part d'un quantum
      // de 128 echantillons en direct
      charge: ms / 1000 / sec,
    };
  },
};
window.bancPret = true;
