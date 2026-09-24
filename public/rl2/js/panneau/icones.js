// Icones du panneau : un trait fin de 1,8, sans remplissage, dans la
// couleur du texte. Elles prennent l'orange du jeu au survol, par le CSS.

const svg = (corps) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${corps}</svg>`;

export const ICONES = {
  // Silhouette et crayon : modifier son profil, son pseudo.
  profil: svg('<circle cx="9" cy="8" r="3.4"/><path d="M3 20c.6-3.6 3-5.6 6-5.6 1.3 0 2.5.4 3.4 1"/><path d="M15.2 20.6l.5-2.6 4.6-4.6a1.4 1.4 0 0 1 2 2l-4.6 4.6-2.5.6z"/>'),
  // Silhouette et plus : ajouter un ami.
  ami: svg('<circle cx="9" cy="8" r="3.4"/><path d="M3 20c.6-3.6 3-5.6 6-5.6s5.4 2 6 5.6"/><path d="M19 8v6M16 11h6"/>'),
  // Ecusson et plus : rejoindre un clan.
  clan: svg('<path d="M12 3l7 2.6v5.2c0 4.6-3 8.1-7 10.2-4-2.1-7-5.6-7-10.2V5.6z"/><path d="M12 9v6M9 12h6"/>'),
  // Bulle et plus : ecrire a quelqu'un.
  message: svg('<path d="M4 5.5h16v10H9.5L5 19.5v-4H4z"/><path d="M12 8v5M9.5 10.5h5"/>'),
  fermer: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
};
