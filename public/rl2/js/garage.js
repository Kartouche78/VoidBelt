// Ecran « Personnalisation » : choisir sa voiture, et bientot son boost,
// sa trainee, son ballon.
//
// Les voitures proposees sont la livree de son camp, puis toutes celles
// validees dans l'admin (Skins Voitures). Le choix est garde dans les
// reglages : il roule en solo, et part au serveur en ligne, ou chacun voit
// la voiture des autres.

import { listSkins, skinArt } from './skins.js';

/** Onglets, dans l'ordre. Ceux sans `pret` annoncent leur arrivee. */
export const CATEGORIES = [
  ['voiture', 'Voiture', true],
  ['boost', 'Boost', false],
  ['trainee', 'Traînée', false],
  ['ballon', 'Ballon', false],
];

/** Livree de camp : ce qu'on roule sans skin. */
const LIVREE = { id: '', name: 'Livrée d’équipe', thumb: 'assets/car_bleue.png' };

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Dessine l'ecran : onglets, grille de l'onglet, et l'apercu de ce qui
 *  est equipe. `onTab(id)` change d'onglet, `onPick(id)` equipe. */
export function renderGarage(nav, box, vue, tab, equipe, onTab, onPick) {
  nav.innerHTML = '';
  for (const [id, label] of CATEGORIES) {
    const b = el('button', null, label);
    b.type = 'button';
    b.dataset.cat = id;
    b.classList.toggle('active', id === tab);
    b.onclick = () => onTab(id);
    nav.append(b);
  }

  box.innerHTML = '';
  const cat = CATEGORIES.find(([id]) => id === tab);
  if (!cat?.[2]) {
    box.append(el('p', 'note garage-bientot', `${cat?.[1] ?? ''} : bientôt personnalisable ici.`));
  } else {
    for (const v of [LIVREE, ...listSkins()]) {
      const b = el('button', 'stadium voiture');
      b.type = 'button';
      b.classList.toggle('active', v.id === equipe);
      const img = el('img');
      img.src = v.thumb;
      img.alt = '';
      img.loading = 'lazy';
      const nom = el('span', null, v.id === equipe ? `${v.name} · équipée` : v.name);
      b.append(img, nom);
      b.onclick = () => onPick(v.id);
      box.append(b);
    }
  }

  // Apercu en grand de la voiture equipee, dans le sens de la route.
  vue.innerHTML = '';
  const art = skinArt(equipe) || LIVREE.thumb;
  const img = el('img');
  img.src = art;
  img.alt = '';
  const nom = equipe ? (listSkins().find((v) => v.id === equipe)?.name ?? 'Voiture') : LIVREE.name;
  vue.append(img, el('p', 'garage-nom', nom));
}
