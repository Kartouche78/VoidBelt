// Pop-up « Clan ». Sans clan : chercher et rejoindre un clan, ou fonder le
// sien. Dans un clan : sa gestion (`clan-gestion.js`). Le serveur
// (`admin2/clans.rs`) fait foi sur les rangs et les regles.
//
// `ctx` : { api, base, moi, change(), clanChange(), discuter(clan) }.

import { dessineGestion } from './clan-gestion.js';
import { adresse, appel, bouton, el, messager } from './outils.js';

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
    if (d.clan) dessineGestion(box, ctx, d, () => dessineClan(box, ctx));
    else sansClan(box, ctx, d.demandes_envoyees);
  } catch (err) {
    box.textContent = '';
    box.append(el('p', 'pp-msg ko', err.message));
  }
}

function sansClan(box, ctx, demandes) {
  const { api, base } = ctx;
  const [msg, dire] = messager();
  const attente = new Set(demandes);
  const recharger = () => dessineClan(box, ctx);

  // Chercher un clan par son nom ou son tag ; vide, les plus peuples.
  const champ = el('input', 'pp-champ');
  champ.type = 'search';
  champ.placeholder = 'Nom ou tag du clan…';
  champ.autocomplete = 'off';
  const liste = el('div', 'pa-liste');
  let minuterie = 0;
  const chercher = async () => {
    try {
      const d = await appel(api, `/api/clans?q=${encodeURIComponent(champ.value.trim())}`);
      liste.textContent = '';
      if (!d.clans.length) liste.append(el('p', 'pa-vide', 'Aucun clan trouvé. Fonde le tien !'));
      for (const k of d.clans) liste.append(ligneClan(k));
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
          attente.delete(k.id);
          dire('Demande annulée.', true);
          chercher();
        } catch (err) {
          dire(err.message, false);
        }
      }));
    } else {
      actions.append(bouton(k.ouvert ? 'Rejoindre' : 'Demander', '', async () => {
        try {
          const { etat } = await appel(api, `/api/clans/${k.id}/rejoindre`, 'POST');
          if (etat === 'membre') {
            await ctx.clanChange();
            recharger();
          } else {
            attente.add(k.id);
            dire(`Demande envoyée à [${k.tag}].`, true);
            chercher();
          }
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
  const champTexte = (place, max) => {
    const c = el('input', 'pp-champ');
    c.type = 'text';
    c.placeholder = place;
    c.maxLength = max;
    c.autocomplete = 'off';
    return c;
  };
  const nom = champTexte('Nom du clan (3 à 24)', 24);
  const tag = champTexte('Tag (2 à 5)', 5);
  tag.classList.add('pa-tag');
  tag.oninput = () => {
    tag.value = tag.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  };
  const description = el('textarea', 'pp-champ pa-zone');
  description.placeholder = 'Description (facultative)';
  description.maxLength = 200;
  description.rows = 2;
  const ouvert = caseACocher('Ouvert : on entre sans demander', true);
  const fonder = bouton('Fonder le clan', '', async () => {
    try {
      await appel(api, '/api/clans', 'POST', {
        nom: nom.value, tag: tag.value, description: description.value, ouvert: ouvert.input.checked,
      });
      await ctx.clanChange();
      recharger();
    } catch (err) {
      dire(err.message, false);
    }
  });
  const rangNom = el('div', 'pp-rang');
  rangNom.append(nom, tag);
  form.append(rangNom, description, ouvert.label, fonder);
  const ouvrir = bouton('Fonder mon clan', 'discret', () => {
    form.hidden = !form.hidden;
    ouvrir.textContent = form.hidden ? 'Fonder mon clan' : 'Plutôt rejoindre un clan';
    if (!form.hidden) nom.focus();
  });

  box.textContent = '';
  box.append(el('h3', 'pp-titre-pop', 'Clans'), champ, liste, ouvrir, form, msg);
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
