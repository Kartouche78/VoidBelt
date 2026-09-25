// Menu en ligne : en multijoueur, Start (ou ², ou Echap) ouvre ensemble
// le menu du jeu (reprendre, parametres, quitter) au centre et le panneau
// du joueur a gauche.
//
// La partie ne s'arrete pas : les autres jouent. Tant que le menu est
// ouvert, la voiture recoit une commande neutre et roule sur son elan.
// A la manette, gauche et droite passent du panneau au menu ; le reste de
// la navigation va a celui qui a la main.

export function menuEnLigne({ app, menu, panneau, shell }) {
  let ouvert = false;
  /** Le panneau relit la session en s'ouvrant : on ne surveille pas
   *  l'ensemble avant qu'il soit la. */
  let enOuverture = false;
  /** Qui recoit la manette : `'menu'` ou `'panneau'`. */
  let main = 'menu';
  const titre = document.querySelector('#screen-pause h2');

  /** La manette passe au menu : le repere du panneau s'efface. */
  function versMenu() {
    main = 'menu';
    for (const i of panneau.barre.querySelectorAll('.pn-vise')) i.classList.remove('pn-vise');
    menu._focus(menu.items()[0]);
  }

  /** En ligne, dans un salon ou en match. */
  const enJeu = () => app.mode === 'online' && app.running && !app.finished;

  async function ouvrir() {
    ouvert = true;
    main = 'menu';
    shell.classList.add('menu-en-ligne');
    titre.textContent = 'Menu';
    menu.show('pause');
    enOuverture = true;
    try {
      if (!panneau.ouvert) await panneau.basculer();
    } finally {
      enOuverture = false;
    }
    // Le panneau prend le focus en s'ouvrant : on le rend au menu. Sans
    // session (essai en local), le menu du jeu s'ouvre seul.
    if (ouvert && menu.screen === 'pause') versMenu();
  }

  function fermer() {
    if (!ouvert) return;
    ouvert = false;
    shell.classList.remove('menu-en-ligne');
    titre.textContent = 'Pause';
    if (panneau.ouvert) panneau.fermer();
    if (menu.screen === 'pause' || menu.screen === 'settings') menu.hide();
  }

  return {
    ouvert: () => ouvert,

    /** Start, ² ou Echap. Rend vrai si la touche a ete prise ici. */
    basculer() {
      if (ouvert) {
        // Dans les parametres, la touche revient d'abord au menu.
        if (menu.screen === 'settings') menu.back();
        else fermer();
        return true;
      }
      if (!enJeu() || (menu.screen && menu.screen !== 'pause')) return false;
      ouvrir();
      return true;
    },

    fermer,

    /** A chaque image : si l'un des deux a ete ferme (Reprendre, clic sur
     *  le voile, fin du salon), l'autre suit. */
    suivre() {
      if (!ouvert || enOuverture) return;
      if (!enJeu() || (!panneau.ouvert && panneau.compte) || !['pause', 'settings'].includes(menu.screen)) fermer();
    },

    navigate(pulse) {
      if (!pulse) return;
      // Gauche : le panneau ; droite : le menu. Dans les parametres, les
      // fleches reglent les curseurs, elles restent au menu.
      if (pulse.x && menu.screen === 'pause' && !panneau.pop) {
        const vers = pulse.x < 0 ? 'panneau' : 'menu';
        if (vers !== main) {
          main = vers;
          if (vers === 'panneau') panneau._vise(panneau.barre.querySelector('button'));
          else versMenu();
          return;
        }
      }
      if (main === 'panneau') panneau.navigate(pulse);
      else menu.navigate(pulse);
    },
  };
}
