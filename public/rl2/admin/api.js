// Acces au serveur depuis l'admin : adresse de l'API et jeton d'hote.
//
// Sur le site statique (voidbelt.com, Cloudflare), il n'y a pas d'API a
// cote des pages : elle est sur `api.voidbelt.com`, comme pour les salons.
// En local ou derriere un tunnel, c'est le serveur qui sert la page.
//
// Hors de la machine du serveur, agir demande d'etre connecte avec un compte
// admin : le cookie de session part avec chaque requete (`credentials`).
// Le jeton `RL2_ADMIN_TOKEN` reste accepte en secours, pour des scripts.

const STATIC = /(^|\.)voidbelt\.com$|\.pages\.dev$/.test(location.hostname);
export const BASE = STATIC ? 'https://api.voidbelt.com' : '';
/** Vrai quand l'admin ecrit dans la base du site en ligne, celle que lisent
 *  tous les joueurs ; faux sur une copie locale du serveur. */
export const EN_LIGNE = STATIC;

const CLE = 'voidbelt.rl2.admin-token';

export function token() {
  try {
    return localStorage.getItem(CLE) || '';
  } catch {
    return '';
  }
}

export function setToken(v) {
  try {
    if (v) localStorage.setItem(CLE, v);
    else localStorage.removeItem(CLE);
  } catch {
    // Stockage refuse : le jeton ne tiendra que jusqu'au rechargement.
  }
  memo = v;
}

let memo = token();

/** `fetch` vers l'API, jeton compris. `path` commence par `/api/`. */
export function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (memo) headers['x-admin-token'] = memo;
  return fetch(`${BASE}${path}`, { cache: 'no-store', credentials: 'include', ...opts, headers });
}
