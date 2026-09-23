// Sections de l'admin et leurs onglets.
//
// « Gestion du jeu » est la page des reglages, tenue par `admin.js`. Les
// autres sections sont des ateliers : un menu d'onglets a gauche, la page
// de l'onglet a droite. Tant qu'un generateur n'est pas construit, sa page
// dit simplement ce qu'il fera. L'adresse suit la navigation (`#arenes/stade`)
// pour qu'un rechargement retombe au meme endroit.

import { drawKeys } from './ia.js';
import { drawStade } from './arenes/stade.js';
import { drawVoiture } from './voitures/voiture.js';

export const SECTIONS = [
  { id: 'jeu', label: 'Gestion du jeu' },
  {
    id: 'arenes',
    label: 'Arènes',
    tabs: [
      ['stade', 'Génération de stade', 'Créer une planche de stade sur le gabarit, la caler (contour, coins, cages) et la publier dans la liste des arènes.'],
      ['ambiance', 'Ambiance sonore', 'Générer la foule, les chants et l’ambiance propres à chaque arène.'],
    ],
  },
  {
    id: 'voitures',
    label: 'Skins Voitures',
    tabs: [
      ['voiture', 'Voiture', 'Générer ou recolorer une carrosserie vue de dessus, avec ses zones de peinture et ses stickers.'],
      ['boost', 'Turbo / Boost', 'Générer la flamme et le souffle du boost.'],
      ['trainee', 'Traînée', 'Générer la traînée laissée derrière la voiture.'],
    ],
  },
  {
    id: 'ballon',
    label: 'Skins Ballon',
    tabs: [
      ['ballon', 'Ballon', 'Générer la texture du ballon et la voir en direct sur le modèle 3D.'],
      ['trainee', 'Traînée', 'Générer la traînée du ballon.'],
    ],
  },
  {
    id: 'ia',
    label: 'IA & API',
    tabs: [
      ['cles', 'Clés API', null],
    ],
  },
];

const $ = (id) => document.getElementById(id);

/** Lit l'adresse : `#section/onglet`, avec des valeurs par defaut sures. */
function fromHash() {
  const [s, t] = location.hash.slice(1).split('/');
  const section = SECTIONS.find((x) => x.id === s) || SECTIONS[0];
  const tab = section.tabs?.find((x) => x[0] === t) || section.tabs?.[0];
  return { section, tab };
}

/** Pose la navigation. `onJeu` est rappele quand on revient aux reglages,
 *  qui doivent alors se redessiner. */
export function initSections(onJeu) {
  const show = () => {
    const { section, tab } = fromHash();
    drawSections(section.id);
    const jeu = section.id === 'jeu';
    $('jeu').hidden = !jeu;
    $('jeu-tools').hidden = !jeu;
    $('atelier').hidden = jeu;
    if (jeu) {
      onJeu();
      return;
    }
    drawTabs(section, tab[0]);
    drawPage(section, tab);
  };
  addEventListener('hashchange', show);
  show();
}

function drawSections(current) {
  const nav = $('sections');
  nav.textContent = '';
  for (const s of SECTIONS) {
    const a = document.createElement('a');
    a.href = `#${s.id}`;
    a.textContent = s.label;
    a.classList.toggle('active', s.id === current);
    nav.append(a);
  }
}

function drawTabs(section, current) {
  const nav = $('sous-onglets');
  nav.textContent = '';
  for (const [id, label] of section.tabs) {
    const a = document.createElement('a');
    a.href = `#${section.id}/${id}`;
    a.textContent = label;
    a.classList.toggle('active', id === current);
    nav.append(a);
  }
}

function drawPage(section, [id, label, what]) {
  const page = $('atelier-page');
  page.textContent = '';
  const h = document.createElement('h2');
  h.textContent = label;
  const sur = document.createElement('p');
  sur.className = 'crumb';
  sur.textContent = section.label;
  page.append(sur, h);

  if (section.id === 'ia' && id === 'cles') {
    drawKeys(page);
    return;
  }
  if (section.id === 'arenes' && id === 'stade') {
    drawStade(page);
    return;
  }
  if (section.id === 'voitures' && id === 'voiture') {
    drawVoiture(page);
    return;
  }

  // Onglet pas encore construit : on dit ce qu'il fera.
  const box = document.createElement('div');
  box.className = 'placeholder';
  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.textContent = 'À construire';
  const p = document.createElement('p');
  p.textContent = what;
  box.append(badge, p);
  page.append(box);
}
