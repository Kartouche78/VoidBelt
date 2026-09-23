// Fournisseurs d'images et version exacte du modele, pour l'etape 4 du
// generateur. `st` est l'etat de la page, `garde` l'enregistre, `say`
// affiche un message.

import { api } from '../api.js';

export const PROVIDERS = [['openai', 'OpenAI'], ['google', 'Google Gemini']];

async function json(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Refus du serveur (${res.status}).`);
  return data;
}

/** Liste les modeles d'images que la cle donne vraiment, tels que le
 *  fournisseur les annonce, plus « Autre » pour un nom saisi a la main. */
export async function remplitModeles(select, autre, st, garde, say) {
  select.textContent = '';
  select.append(new Option('Chargement…', ''));
  select.disabled = true;
  let liste = [];
  let defaut = '';
  try {
    const r = await json(await api(`/api/arenes/modeles/${st.provider}`));
    liste = r.models || [];
    defaut = r.default || '';
    if (r.warning) say(`Liste des modèles indisponible : ${r.warning}`, 'bad');
  } catch (err) {
    say(err.message, 'bad');
  }
  select.textContent = '';
  for (const m of liste) select.append(new Option(m, m));
  select.append(new Option('Autre modèle…', '*'));
  select.disabled = false;
  const voulu = st.modeles[st.provider] || defaut;
  if (voulu && liste.includes(voulu)) {
    select.value = voulu;
    autre.hidden = true;
  } else if (voulu) {
    select.value = '*';
    autre.value = voulu;
    autre.hidden = false;
  }
  st.modeles[st.provider] = voulu || liste[0] || '';
  garde();
}

/** Liste les fournisseurs d'images, branches d'abord. */
export async function remplitFournisseurs(select, st, garde, say) {
  let etat = {};
  try {
    etat = (await json(await api('/api/ia/keys'))).providers || {};
  } catch {
    // Sans acces aux cles, on propose quand meme : le serveur tranchera.
  }
  for (const [id, nom] of PROVIDERS) {
    const branche = etat[id]?.set;
    select.append(new Option(branche ? nom : `${nom} (clé absente)`, id, false, id === st.provider));
  }
  if (!etat[st.provider]?.set) {
    const premier = PROVIDERS.find(([id]) => etat[id]?.set);
    if (premier) {
      select.value = st.provider = premier[0];
      garde();
    } else if (Object.keys(etat).length) {
      say('Aucune clé d’image branchée : ajoute une clé OpenAI ou Google dans IA & API.', 'bad');
    }
  }
}
