// Petits outils des pages de l'admin : elements, etapes numerotees,
// images relisibles dans un canevas, reponses de l'API.

export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function bouton(text, cls, onclick, title) {
  const b = el('button', cls, text);
  b.type = 'button';
  b.onclick = onclick;
  if (title) b.title = title;
  return b;
}

/** Une etape numerotee de la page. */
export function etape(page, n, titre, aide) {
  const box = el('section', 'etape');
  const h = el('h3', null, titre);
  h.prepend(el('span', 'num', String(n)));
  box.append(h);
  if (aide) box.append(el('p', 'aide', aide));
  page.append(box);
  return box;
}

/** Charge une image, en autorisant sa relecture dans un canevas. */
export function image(src) {
  return new Promise((ok, ko) => {
    const i = new Image();
    i.crossOrigin = 'anonymous';
    i.onload = () => ok(i);
    i.onerror = () => ko(new Error(`Image illisible : ${src}`));
    i.src = src;
  });
}

export async function json(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Refus du serveur (${res.status}).`);
  return data;
}
