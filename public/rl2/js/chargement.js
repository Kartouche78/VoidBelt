// Ecran de chargement (dans `index.html`, style compris) : il couvre la
// page tant que le jeu demarre, puis s'efface en fondu. Il reste au moins
// un instant, pour ne pas clignoter quand tout est deja en cache.

const MINIMUM = 700;
const depart = performance.now();

export function finirChargement() {
  const box = document.getElementById('chargement');
  if (!box) return;
  const reste = Math.max(0, MINIMUM - (performance.now() - depart));
  setTimeout(() => {
    box.classList.add('fini');
    setTimeout(() => box.remove(), 600);
  }, reste);
}
