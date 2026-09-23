// Skins de voitures crees dans l'admin.
//
// Le catalogue vit sur le serveur ; on le charge au demarrage. Un skin est
// un sprite deja recadre sur la hitbox : il remplace la livree du camp, et
// se pose exactement comme `car_bleue.png`.

const SKINS = new Map();

/** Charge le catalogue. Sans reponse sous trois secondes, chacun garde la
 *  livree de son camp. */
export async function loadSkins(base) {
  try {
    const res = await fetch(`${base}/api/voitures`, { cache: 'no-store', signal: AbortSignal.timeout(3000) });
    if (!res.ok) return;
    const { voitures } = await res.json();
    for (const v of voitures || []) SKINS.set(v.id, { ...v, art: base + v.art, thumb: base + v.thumb });
  } catch {
    // Pas d'API : pas de skins, rien de casse.
  }
}

/** Skins connus, dans l'ordre du catalogue. */
export function listSkins() {
  return [...SKINS.values()];
}

/** Image d'un skin, ou `null` s'il est inconnu (ou vide). */
export function skinArt(id) {
  return (id && SKINS.get(id)?.art) || null;
}
