// Ecran Jouer : quatre grandes cases, une par mode de jeu.
//
//   Occasionnel   choisir une carte, puis jouer contre le bot
//   Ranked        le classement, a venir
//   S'entrainer   a venir
//   Prive         un lobby entre potes (`prive.js`)
//
// Chaque case prend son image de fond dans `assets/menu/modes/<mode>.jpg` ;
// tant qu'elle manque, un degrade la remplace (voir `style.css`).

const $ = (id) => document.getElementById(id);

/** Ce que dit une case pas encore ouverte. */
const BIENTOT = {
  ranked: 'Le mode Ranked arrive bientôt : matchs classés et saisons.',
  entrainement: 'Le mode S’entraîner arrive bientôt.',
};

export function brancherModes(menu) {
  const statut = $('modes-status');
  for (const b of document.querySelectorAll('#modes-grille .mode')) {
    b.onclick = () => {
      const mode = b.dataset.mode;
      if (mode === 'occasionnel') {
        statut.textContent = '';
        menu.showStadiums('solo');
        return;
      }
      if (mode === 'prive') {
        statut.textContent = '';
        menu.showPrive?.();
        return;
      }
      statut.textContent = BIENTOT[mode] || '';
    };
  }
  $('btn-modes-back').onclick = () => {
    statut.textContent = '';
    menu.show('title');
  };
}
