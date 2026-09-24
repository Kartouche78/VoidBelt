// Pop-up « Clan ». Sans clan : chercher et rejoindre un clan, ou fonder le
// sien. Dans un clan : sa gestion (`clan-gestion.js`), d'ou l'on peut aussi
// parcourir les autres clans et changer de clan. Le serveur
// (`admin2/clans.rs`) fait foi sur les rangs et les regles.
//
// Un joueur n'est que dans un clan a la fois : rejoindre ou fonder un
// autre clan fait quitter le sien (le serveur passe la main si l'on etait
// chef). Une demande a un clan ferme ne fait rien quitter tant qu'elle
// attend.
//
// `ctx` : { api, base, moi, change(), clanChange(), discuter(clan) }.

import { dessineGestion } from './clan-gestion.js';
import { adresse, appel, bouton, el, messager, sur } from './outils.js';

/** Ecusson du clan : son image, sinon son tag. */
export function ecusson(base, k, cls = 'pa-avatar') {
  if (k.image) {
    const i = el('img', cls);
    i.src = adresse(base, k.image);
    i.alt = '';
    return i;
  }
  return el('span', `${cls} pa-initiale pc-tag`, k.tag);
}

export async function dessineClan(box, ctx) {
  box.textContent = '';
  box.classList.add('pa-large');
  box.append(el('p', 'pa-vide', 'Chargement…'));
  try {
    const d = await appel(ctx.api, '/api/clan');
    if (d.clan) dessineGestion(box, ctx, d, () => dessineClan(box, ctx), () => parcourir(box, ctx, d.clan));
    else parcourir(box, ctx, null);
  } catch (err) {
    box.textContent = '';
    box.append(el('p', 'pp-msg ko', err.message));
  }
}

/** Champs nom et tag d'un clan, le tag en majuscules a la frappe. */
export function champsNomTag(nom = '', tag = '') {
  const champ = (place, max, valeur) => {
    const c = el('input', 'pp-champ');
    c.type = 'text';
    c.placeholder = place;
    c.maxLength = max;
    c.autocomplete = 'off';
    c.value = valeur;
    return c;
  };
  const n = champ('Nom du clan (3 à 24)', 24, nom);
  const t = champ('Tag (2 à 5)', 5, tag);
  t.classList.add('pa-tag');
  t.oninput = () => {
    t.value = t.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  };
  const rang = el('div', 'pp-rang');
  rang.append(n, t);
  return { rang, nom: n, tag: t };
}

/** Cherche un clan, le rejoint, ou fonde le sien. `actuel` : le clan du
 *  joueur s'il en a un (changer de clan le fait quitter). */
function parcourir(box, ctx, actuel) {
  const { api, base } = ctx;
  const [msg, dire] = messager();
  const attente = new Set();
  const recharger = () => dessineClan(box, ctx);
  // Changer de clan : un clic arme, le second confirme.
  const action = (texte, faire) => (actuel ? sur(texte, faire) : bouton(texte, '', faire));

  // Chercher un clan par son nom ou son tag ; vide, les plus peuples.
  const champ = el('input', 'pp-champ');
  champ.type = 'search';
  champ.placeholder = 'Nom ou tag du clan…';
  champ.autocomplete = 'off';
  const liste = el('div', 'pa-liste pa-defile');
  let minuterie = 0;
  const chercher = async () => {
    try {
      const d = await appel(api, `/api/clans?q=${encodeURIComponent(champ.value.trim())}`);
      attente.clear();
      for (const id of d.demandes_envoyees) attente.add(id);
      liste.textContent = '';
      const autres = d.clans.filter((k) => k.id !== actuel?.id);
      if (!autres.length) liste.append(el('p', 'pa-vide', actuel ? 'Aucun autre clan trouvé.' : 'Aucun clan trouvé. Fonde le tien !'));
      for (const k of autres) liste.append(ligneClan(k));
    } catch (err) {
      dire(err.message, false);
    }
  };
  champ.oninput = () => {
    clearTimeout(minuterie);
    minuterie = setTimeout(chercher, 250);
  };

  const ligneClan = (k) => {
    const l = el('div', 'pa-ligne pa-clan');
    const texte = el('div', 'pa-texte');
    texte.append(
      el('span', 'pa-nom', `[${k.tag}] ${k.nom}`),
      el('span', 'pa-sous', `${k.membres}/50 · ${k.ouvert ? 'ouvert' : 'sur demande'}`),
    );
    if (k.description) texte.append(el('span', 'pa-desc', k.description));
    const actions = el('div', 'pa-actions');
    if (attente.has(k.id)) {
      actions.append(bouton('Annuler', 'discret', async () => {
        try {
          await appel(api, `/api/clans/${k.id}/rejoindre`, 'DELETE');
          dire('Demande annulée.', true);
          chercher();
        } catch (err) {
          dire(err.message, false);
        }
      }));
    } else if (!k.ouvert) {
      // Une demande ne fait rien quitter : pas besoin de confirmer.
      actions.append(bouton('Demander', '', async () => {
        try {
          await appel(api, `/api/clans/${k.id}/rejoindre`, 'POST');
          dire(actuel ? `Demande envoyée à [${k.tag}]. Si elle est acceptée, tu quitteras [${actuel.tag}].` : `Demande envoyée à [${k.tag}].`, true);
          chercher();
        } catch (err) {
          dire(err.message, false);
        }
      }));
    } else {
      actions.append(action('Rejoindre', async () => {
        try {
          await appel(api, `/api/clans/${k.id}/rejoindre`, 'POST');
          await ctx.clanChange();
          recharger();
        } catch (err) {
          dire(err.message, false);
        }
      }));
    }
    l.append(ecusson(base, k), texte, actions);
    return l;
  };

  // Fonder son clan.
  const form = el('div', 'pa-form');
  form.hidden = true;
  const nt = champsNomTag();
  const description = el('textarea', 'pp-champ pa-zone');
  description.placeholder = 'Description (facultative)';
  description.maxLength = 200;
  description.rows = 2;
  const ouvert = caseACocher('Ouvert : on entre sans demander', true);
  const fonder = action('Fonder le clan', async () => {
    try {
      await appel(api, '/api/clans', 'POST', {
        nom: nt.nom.value, tag: nt.tag.value, description: description.value, ouvert: ouvert.input.checked,
      });
      await ctx.clanChange();
      recharger();
    } catch (err) {
      dire(err.message, false);
    }
  });
  form.append(nt.rang, description, ouvert.label, fonder);
  const ouvrir = bouton(actuel ? 'Fonder un nouveau clan' : 'Fonder mon clan', 'discret', () => {
    form.hidden = !form.hidden;
    if (!form.hidden) nt.nom.focus();
  });

  box.textContent = '';
  if (actuel) {
    const retour = bouton(`← [${actuel.tag}] Mon clan`, 'discret', recharger);
    box.append(
      el('h3', 'pp-titre-pop', 'Autres clans'),
      retour,
      el('p', 'pa-vide', `Rejoindre ou fonder un autre clan te fait quitter [${actuel.tag}]. Un seul clan à la fois.`),
    );
  } else {
    box.append(el('h3', 'pp-titre-pop', 'Clans'));
  }
  box.append(champ, liste, ouvrir, form, msg);
  chercher();
  setTimeout(() => champ.focus(), 0);
}

/** Case a cocher avec son libelle. */
export function caseACocher(texte, coche) {
  const label = el('label', 'pa-case');
  const input = el('input');
  input.type = 'checkbox';
  input.checked = coche;
  label.append(input, el('span', null, texte));
  return { label, input };
}
