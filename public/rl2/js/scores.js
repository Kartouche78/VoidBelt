// Tableau des joueurs, sur le barème de Rocket League.
//
// À ne pas confondre avec le tableau d'affichage en haut de l'écran, qui
// compte les buts par équipe. Ici ce sont les points personnels : un but
// vaut 1 pour l'équipe et 100 pour le buteur.
//
// Il se tient enfoncé plutôt que de se basculer, comme dans le vrai jeu :
// on regarde le classement sans lâcher la manette.

import { readCar, carsIn } from './wasm.js';

/** Colonnes, dans l'ordre. */
const COLONNES = [
  ['points', 'PTS'],
  ['goals', 'BUTS'],
  ['assists', 'PASSES'],
  ['saves', 'ARRÊTS'],
  ['shots', 'TIRS'],
  ['demos', 'DÉMOS'],
];

export class Scores {
  constructor(root) {
    this.root = root;
    this.roster = [];
    this.visible = false;
    this.signature = '';
  }

  /** Composition courante : un `{ name, team }` par siège. */
  setRoster(list) {
    this.roster = list;
    this.signature = '';
  }

  show(on) {
    if (on === this.visible) return;
    this.visible = on;
    this.root.hidden = !on;
  }

  /** Redessine si quelque chose a bougé. Appelé à chaque image tant que le
   *  tableau est ouvert : on compare une signature plutôt que de refaire le
   *  tableau soixante fois par seconde pour rien. */
  update(state) {
    if (!this.visible) return;
    const n = carsIn(state);
    const lignes = [];
    for (let i = 0; i < n; i += 1) {
      const c = readCar(state, i);
      const who = this.roster[i] || { name: '', team: i % 2 };
      lignes.push({
        nom: who.name || `Joueur ${i + 1}`,
        team: who.team & 1,
        points: c.points,
        goals: c.goals,
        assists: c.assists,
        saves: c.saves,
        shots: c.shots,
        demos: c.demos,
      });
    }
    // Le meilleur en haut, chaque camp de son côté.
    lignes.sort((a, b) => b.points - a.points);
    const sig = lignes.map((l) => `${l.nom}:${l.team}:${l.points}`).join('|');
    if (sig === this.signature) return;
    this.signature = sig;
    this._draw(lignes);
  }

  _draw(lignes) {
    this.root.textContent = '';
    for (const team of [0, 1]) {
      const bloc = document.createElement('div');
      bloc.className = `camp ${team ? 'orange' : 'blue'}`;
      const gens = lignes.filter((l) => l.team === team);
      const total = gens.reduce((s, l) => s + l.points, 0);

      const tete = document.createElement('div');
      tete.className = 'tete';
      const nom = document.createElement('span');
      nom.textContent = team ? 'ORANGE' : 'BLEU';
      const pts = document.createElement('span');
      pts.className = 'total';
      pts.textContent = `${total} pts`;
      tete.append(nom, pts);
      bloc.append(tete);

      const table = document.createElement('table');
      const thead = document.createElement('thead');
      const hr = document.createElement('tr');
      hr.append(cellule('th', 'JOUEUR', 'nom'));
      for (const [, titre] of COLONNES) hr.append(cellule('th', titre));
      thead.append(hr);
      table.append(thead);

      const corps = document.createElement('tbody');
      if (!gens.length) {
        const tr = document.createElement('tr');
        const td = cellule('td', 'personne', 'vide');
        td.colSpan = COLONNES.length + 1;
        tr.append(td);
        corps.append(tr);
      }
      for (const l of gens) {
        const tr = document.createElement('tr');
        tr.append(cellule('td', l.nom, 'nom'));
        for (const [cle] of COLONNES) tr.append(cellule('td', String(l[cle])));
        corps.append(tr);
      }
      table.append(corps);
      bloc.append(table);
      this.root.append(bloc);
    }
  }
}

function cellule(balise, texte, classe) {
  const el = document.createElement(balise);
  el.textContent = texte;
  if (classe) el.className = classe;
  return el;
}
