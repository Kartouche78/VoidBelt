// Petits outils partages par les pop-ups du panneau.

export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function bouton(texte, cls, faire) {
  const b = el('button', `pp-bouton ${cls || ''}`.trim(), texte);
  b.type = 'button';
  b.onclick = faire;
  return b;
}

/** Bouton qui demande confirmation : un premier clic arme, le second agit. */
export function sur(texte, faire) {
  const b = bouton(texte, 'discret', () => {
    if (b.dataset.arme) return faire();
    b.dataset.arme = '1';
    b.textContent = 'Sûr ?';
    b.classList.add('arme');
    setTimeout(() => {
      delete b.dataset.arme;
      b.textContent = texte;
      b.classList.remove('arme');
    }, 2500);
  });
  return b;
}

/** Appelle l'API et rend le JSON, ou leve l'erreur que le serveur a dite. */
export async function appel(api, chemin, methode = 'GET', corps) {
  const opts = { method: methode };
  if (corps !== undefined) {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = JSON.stringify(corps);
  }
  const res = await api(chemin, opts);
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || `Refus du serveur (${res.status}).`);
  return d;
}

/** Adresse d'une image : celles de l'API commencent par `/`. */
export function adresse(base, src) {
  return src && src.startsWith('/') ? base + src : src || '';
}

/** Pastille ronde : l'avatar du joueur, sinon son initiale. */
export function pastille(base, joueur, cls = 'pa-avatar') {
  if (joueur?.avatar) {
    const i = el('img', cls);
    i.src = adresse(base, joueur.avatar);
    i.alt = '';
    i.referrerPolicy = 'no-referrer';
    return i;
  }
  return el('span', `${cls} pa-initiale`, (joueur?.pseudo || '?').slice(0, 1).toUpperCase());
}

/** Ligne de message sous un formulaire : vert si ok, rouge sinon. */
export function messager() {
  const msg = el('p', 'pp-msg');
  const dire = (texte, ok) => {
    msg.textContent = texte;
    msg.className = `pp-msg ${ok ? 'ok' : 'ko'}`;
  };
  return [msg, dire];
}

/** « il y a 3 min », « hier 14:02 »... pour les messages. */
export function quand(secondes) {
  const d = new Date(secondes * 1000);
  const ecart = (Date.now() - d) / 1000;
  if (ecart < 60) return 'à l’instant';
  if (ecart < 3600) return `il y a ${Math.floor(ecart / 60)} min`;
  const heure = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === new Date().toDateString()) return heure;
  return `${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} ${heure}`;
}

/** Reduit une image a un carre de `cote` px, centre, en WebP. */
export function carre(fichier, cote = 256) {
  return new Promise((ok, ko) => {
    const lecteur = new FileReader();
    lecteur.onerror = () => ko(new Error('Fichier illisible.'));
    lecteur.onload = () => {
      const img = new Image();
      img.onerror = () => ko(new Error('Image illisible.'));
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = c.height = cote;
        const m = Math.min(img.naturalWidth, img.naturalHeight);
        c.getContext('2d').drawImage(
          img,
          (img.naturalWidth - m) / 2, (img.naturalHeight - m) / 2, m, m,
          0, 0, cote, cote,
        );
        ok(c.toDataURL('image/webp', 0.9));
      };
      img.src = String(lecteur.result);
    };
    lecteur.readAsDataURL(fichier);
  });
}
