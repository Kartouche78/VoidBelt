// Choix de la couleur du clan, dans « Modifier le clan » : quelques
// teintes toutes pretes, une couleur libre, ou aucune (chacun garde la
// couleur de son equipe). Un apercu montre la voiture peinte.
//
// En ligne, les voitures des membres, leurs pseudos et leurs explosions
// prennent cette couleur ; un trait sous le pseudo garde la couleur de
// l'equipe.

import { peindreToile } from '../peinture.js';
import { el } from './outils.js';

const TEINTES = [
  ['#e5484d', 'Rouge'],
  ['#22c55e', 'Vert'],
  ['#8b5cf6', 'Violet'],
  ['#facc15', 'Jaune'],
  ['#ec4899', 'Rose'],
  ['#06b6d4', 'Cyan'],
  ['#1f2937', 'Noir'],
  ['#f4f4f5', 'Blanc'],
];

/** Bloc de choix. `valeur()` rend `#rrggbb`, ou `''` pour aucune. */
export function choixCouleur(depart) {
  let valeur = depart || '';
  const bloc = el('div', 'cc-bloc');
  const pastilles = el('div', 'cc-pastilles');
  const apercu = el('canvas', 'cc-apercu');
  const nom = el('span', 'pa-sous');

  const libre = el('input', 'cc-libre');
  libre.type = 'color';
  libre.title = 'Couleur libre';
  libre.value = valeur || '#e5484d';

  const aucune = el('button', 'cc-pastille cc-aucune', '∅');
  aucune.type = 'button';
  aucune.title = 'Aucune : chacun garde la couleur de son équipe';

  let tour = 0;
  const montrer = () => {
    for (const b of pastilles.querySelectorAll('.cc-pastille')) {
      b.classList.toggle('choisie', (b.dataset.couleur || '') === valeur);
    }
    libre.classList.toggle('choisie', !!valeur && !TEINTES.some(([c]) => c === valeur));
    nom.textContent = valeur
      ? `${TEINTES.find(([c]) => c === valeur)?.[1] || 'Couleur libre'} · ${valeur}`
      : 'Aucune : bleu ou orange selon l’équipe';
    // Sans couleur, l'apercu montre la livree bleue par defaut. Seul le
    // dernier apercu demande compte.
    const moi = ++tour;
    const url = valeur ? 'assets/car_white.png' : 'assets/car_bleue.png';
    const toile = document.createElement('canvas');
    peindreToile(url, valeur || '#2f7ce0', 120, toile)
      .then(() => {
        if (moi !== tour) return;
        apercu.width = toile.width;
        apercu.height = toile.height;
        apercu.getContext('2d').drawImage(toile, 0, 0);
      })
      .catch(() => {});
  };
  const choisir = (c) => {
    valeur = c;
    montrer();
  };

  for (const [c, n] of TEINTES) {
    const b = el('button', 'cc-pastille');
    b.type = 'button';
    b.title = n;
    b.dataset.couleur = c;
    b.style.background = c;
    b.onclick = () => choisir(c);
    pastilles.append(b);
  }
  aucune.onclick = () => choisir('');
  libre.oninput = () => choisir(libre.value.toLowerCase());
  pastilles.append(libre, aucune);

  const texte = el('div', 'cc-texte');
  texte.append(pastilles, nom);
  bloc.append(apercu, texte);
  montrer();
  return { bloc, valeur: () => valeur };
}
