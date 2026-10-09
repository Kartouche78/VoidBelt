// Le son du moteur en course : le generateur de la Creation (v2), joue en
// direct et pilote par la boite du moteur Rust. Le regime, le rapport, les
// coupures (passage, rupteur, frein moteur) et la charge viennent du
// tampon d'etat ; on les transmet tels quels au generateur, qui fait le
// reste. On entend donc chaque passage de rapport, le rupteur, le coup de
// gaz au retrogradage, et le moteur qui rugit au point mort pendant le
// compte a rebours.
//
// Le moteur joue est celui choisi dans les Parametres du jeu ou dans la
// Creation (meme enregistrement, voir creation/son/choix.js).

import { Moteur } from '../creation/son/moteur.js';
import { moteurDuJeu } from '../creation/son/choix.js';
import { S } from './moteur.js';

export class EngineLive {
  constructor() {
    this.recette = moteurDuJeu().recette;
    this.moteur = null;
    this.demarreur = 0;
    this.pret = Promise.resolve(true);
  }

  get actif() {
    return !!this.moteur?.actif;
  }

  /** Branche le generateur sur `destination`, une fois le son demarre. */
  brancher(ctx, destination) {
    if (this.moteur) return;
    // un compresseur doux : le generateur vit, son niveau aussi
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.ratio.value = 4;
    comp.attack.value = 0.005;
    comp.release.value = 0.15;
    const gain = ctx.createGain();
    gain.gain.value = 0.9;
    gain.connect(comp).connect(destination);
    this.moteur = new Moteur(ctx, gain);
    this.moteur.configurer(this.recette);
  }

  /** Autre moteur (Parametres ou Creation). */
  changer(recette) {
    this.recette = recette;
    this.moteur?.configurer(recette);
  }

  /** Le demarreur entraine le moteur, puis il prend. */
  demarrage() {
    this.demarreur = 1.1;
  }

  update(st, input, dt) {
    if (!this.moteur) return;
    if (this.demarreur > 0) {
      this.demarreur -= dt;
      if (this.demarreur > 0.25) {
        const t = 1.1 - this.demarreur;
        this.moteur.forcer({ rpm: 210 + Math.sin(t * 40) * 20, charge: 0, coupure: true, demarreur: 1 });
        return;
      }
    }
    this.moteur.forcer({
      rpm: st[S.RPM],
      charge: st[S.ENG_LOAD],
      coupure: st[S.ENG_CUT] > 0,
      lever: st[S.ENG_LIFT] > 0,
      gaz: input.throttle,
      demarreur: Math.max(0, this.demarreur / 0.25),
    });
  }
}
