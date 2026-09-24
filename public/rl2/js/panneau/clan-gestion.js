// Gestion de son clan, dans le pop-up « Clan » : membres et rangs,
// demandes, reglages du chef, discussion, depart.
//
// Les boutons suivent les regles du serveur (`admin2/clans.rs`) : le chef
// nomme, destitue, exclut et passe la main ; un officier accepte les
// demandes et exclut les membres.

import { caseACocher, ecusson } from './clan.js';
import { appel, bouton, carre, el, messager, pastille, sur } from './outils.js';

const RANGS = { chef: 'Chef', officier: 'Officier', membre: 'Membre' };
const POIDS = { chef: 3, officier: 2, membre: 1 };

export function dessineGestion(box, ctx, d, recharger) {
  const { api, base } = ctx;
  const { clan: k, rang, membres, demandes } = d;
  const chef = rang === 'chef';
  const [msg, dire] = messager();
  const agir = async (chemin, methode, corps, texte, clanChange = false) => {
    try {
      await appel(api, chemin, methode, corps);
      if (clanChange) await ctx.clanChange();
      ctx.change();
      await recharger();
      // Le pop-up est redessine : le message va dans le nouveau.
      if (texte) box.querySelector('.pp-msg')?.replaceWith(Object.assign(el('p', 'pp-msg ok'), { textContent: texte }));
    } catch (err) {
      dire(err.message, false);
    }
  };
  const membre = (id, action, texte) => agir(`/api/clan/membres/${id}`, 'POST', { action }, texte);

  // En-tete : ecusson, nom, description.
  const tete = el('div', 'pg-tete');
  const ecu = ecusson(base, k, 'pg-ecusson');
  const texte = el('div', 'pa-texte');
  texte.append(
    el('h3', 'pp-titre-pop', `[${k.tag}] ${k.nom}`),
    el('span', 'pa-sous', `${k.membres}/50 membres · ${k.ouvert ? 'ouvert' : 'sur demande'} · ${RANGS[rang]}`),
  );
  if (k.description) texte.append(el('span', 'pa-desc', k.description));
  tete.append(ecu, texte);

  const discuter = bouton('Discussion du clan', '', () => ctx.discuter(k));

  // Demandes d'entree : chef et officiers.
  const blocs = [];
  if (demandes.length) {
    const s = el('div', 'pa-section');
    s.append(el('span', 'pp-titre', `Demandes · ${demandes.length}`));
    const l = el('div', 'pa-liste');
    for (const j of demandes) {
      const ligne = el('div', 'pa-ligne');
      const actions = el('div', 'pa-actions');
      actions.append(
        bouton('Accepter', '', () => membre(j.id, 'accepter', `${j.pseudo} rejoint le clan.`)),
        bouton('Refuser', 'discret', () => membre(j.id, 'refuser')),
      );
      ligne.append(pastille(base, j), el('span', 'pa-nom', j.pseudo), actions);
      l.append(ligne);
    }
    s.append(l);
    blocs.push(s);
  }

  // Membres, du chef aux membres.
  const s = el('div', 'pa-section');
  s.append(el('span', 'pp-titre', `Membres · ${membres.length}`));
  const l = el('div', 'pa-liste');
  for (const m of membres) {
    const j = m.joueur;
    const ligne = el('div', 'pa-ligne');
    const nom = el('div', 'pa-texte');
    nom.append(el('span', 'pa-nom', j.id === d.moi ? `${j.pseudo} (toi)` : j.pseudo), el('span', `pa-rang ${m.rang}`, RANGS[m.rang]));
    const actions = el('div', 'pa-actions');
    if (j.id !== d.moi && POIDS[m.rang] < POIDS[rang]) {
      if (chef && m.rang === 'membre') actions.append(bouton('Promouvoir', 'discret', () => membre(j.id, 'promouvoir')));
      if (chef && m.rang === 'officier') actions.append(bouton('Rétrograder', 'discret', () => membre(j.id, 'retrograder')));
      if (chef) actions.append(sur('Passer chef', () => membre(j.id, 'chef', `${j.pseudo} est le nouveau chef.`)));
      actions.append(sur('Exclure', () => membre(j.id, 'exclure', `${j.pseudo} est exclu.`)));
    }
    ligne.append(pastille(base, j), nom, actions);
    l.append(ligne);
  }
  s.append(l);
  blocs.push(s);

  // Reglages du chef : description, ouvert ou ferme, ecusson.
  if (chef) {
    const r = el('div', 'pa-section pa-form');
    r.append(el('span', 'pp-titre', 'Réglages'));
    const description = el('textarea', 'pp-champ pa-zone');
    description.maxLength = 200;
    description.rows = 2;
    description.placeholder = 'Description du clan';
    description.value = k.description;
    const ouvert = caseACocher('Ouvert : on entre sans demander', k.ouvert);
    const fichier = el('input');
    fichier.type = 'file';
    fichier.accept = 'image/png,image/jpeg,image/webp';
    fichier.hidden = true;
    fichier.onchange = async () => {
      if (!fichier.files[0]) return;
      try {
        const image = await carre(fichier.files[0]);
        await agir('/api/clan/image', 'PUT', { image }, 'Écusson enregistré.', true);
      } catch (err) {
        dire(err.message, false);
      }
    };
    const images = el('div', 'pp-rang');
    images.append(bouton('Changer l’écusson', 'discret', () => fichier.click()), fichier);
    if (k.image) images.append(bouton('Retirer', 'discret', () => agir('/api/clan/image', 'PUT', { image: null }, 'Écusson retiré.', true)));
    r.append(
      description,
      ouvert.label,
      images,
      bouton('Enregistrer', '', () => agir('/api/clan', 'PUT', { description: description.value, ouvert: ouvert.input.checked }, 'Réglages enregistrés.')),
    );
    blocs.push(r);
  }

  // Partir : quitter, ou tout dissoudre pour le chef.
  const fin = el('div', 'pp-rang pg-fin');
  fin.append(sur('Quitter le clan', () => agir('/api/clan/quitter', 'POST', undefined, '', true)));
  if (chef) fin.append(sur('Dissoudre', () => agir('/api/clan', 'DELETE', undefined, '', true)));

  box.textContent = '';
  box.classList.add('pa-large');
  box.append(tete, discuter, ...blocs, msg, fin);
}
