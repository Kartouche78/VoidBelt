// Onglet « Skins Voitures > Voiture » : le meme atelier que les arenes,
// pour les carrosseries.
//
//   1. Exemple          la voiture de reference, jointe a chaque demande
//   2. Prompt auto      style et gabarit a respecter, modifiable
//   3. Prompt design    la livree voulue
//   4. Nombre d'images  fournisseur, modele, generation
//   5. Apercu           hitbox par-dessus ; jeter, retoucher, caler, accepter
//   6. Voitures creees  les essayer en jeu, les equiper
//
// La generation passe par les memes routes que les arenes, avec
// `kind: voiture` : portrait 1024 x 1536 et fond transparent.

import { api, BASE } from '../api.js';
import { remplitFournisseurs, remplitModeles } from '../arenes/fournisseurs.js';
import { EXEMPLES, PROMPT_VOITURE, SPRITE } from './exemples.js';
import { apercu, applique, cadreParDefaut, gesteDe, GESTES, resume, versSprite } from './cadre.js';
import { dessineVoitures } from './creees.js';
import { TEINTES, teinter } from './teinte.js';

const CLE = 'voidbelt.rl2.gen-voiture';

let st;
let say;

function charge() {
  let s = {};
  try {
    s = JSON.parse(localStorage.getItem(CLE) || '{}');
  } catch {
    // Illisible : on repart de zero.
  }
  return {
    exemple: EXEMPLES.some((x) => x.id === s.exemple) ? s.exemple : EXEMPLES[0].id,
    auto: s.auto ?? PROMPT_VOITURE,
    extra: s.extra ?? '',
    n: s.n ?? 4,
    provider: s.provider ?? 'openai',
    modeles: s.modeles ?? {},
    drafts: s.drafts ?? [],
    job: s.job ?? null,
    joint: s.joint ?? null,
  };
}

function garde() {
  try {
    localStorage.setItem(CLE, JSON.stringify(st));
  } catch {
    // Plein : le travail vaut pour la session.
  }
}

const exemple = () => EXEMPLES.find((x) => x.id === st.exemple) || EXEMPLES[0];

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function bouton(text, cls, onclick, title) {
  const b = el('button', cls, text);
  b.type = 'button';
  b.onclick = onclick;
  if (title) b.title = title;
  return b;
}

function etape(page, n, titre, aide) {
  const box = el('section', 'etape');
  const h = el('h3', null, titre);
  h.prepend(el('span', 'num', String(n)));
  box.append(h);
  if (aide) box.append(el('p', 'aide', aide));
  page.append(box);
  return box;
}

function image(src) {
  return new Promise((ok, ko) => {
    const i = new Image();
    i.crossOrigin = 'anonymous';
    i.onload = () => ok(i);
    i.onerror = () => ko(new Error(`Image illisible : ${src}`));
    i.src = src;
  });
}

async function json(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Refus du serveur (${res.status}).`);
  return data;
}

const brouillon = (id) => `${BASE}/api/arenes/brouillons/${id}`;
const post = (path, body) => api(path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export async function drawVoiture(page) {
  st = charge();
  const msg = el('p', 'msg');
  page.append(msg);
  say = (text, kind = '') => {
    msg.textContent = text;
    msg.className = `msg ${kind}`;
  };

  // 1. Exemple
  const e1 = etape(page, 1, 'Exemple', 'La voiture de référence : elle fixe le style, la vue de dessus et la silhouette maximale.');
  const choix = el('select', 'champ');
  for (const x of EXEMPLES) choix.append(new Option(x.name, x.id, false, x.id === st.exemple));
  const vue = el('img', 'exemple');
  const note = el('p', 'aide');
  e1.append(choix, vue, note);

  // 2. Prompt automatique, et la piece jointe
  const e2 = etape(page, 2, 'Prompt automatique', 'Ce que le modèle doit respecter. Écris, supprime, ajuste librement.');
  const auto = el('textarea', 'champ grand');
  auto.rows = 12;
  auto.value = st.auto;
  auto.oninput = () => {
    st.auto = auto.value;
    garde();
  };
  e2.append(auto, bouton('Recréer le prompt', 'small', () => {
    auto.value = st.auto = PROMPT_VOITURE;
    garde();
  }));
  const joint = el('div', 'joint');
  const apercuJoint = el('img', 'portrait');
  const legende = el('div', 'legende');
  const fichier = el('input');
  fichier.type = 'file';
  fichier.accept = 'image/png,image/webp';
  fichier.hidden = true;
  const retour = bouton('Revenir à l’exemple', 'small', () => {
    st.joint = null;
    garde();
    montre();
  });
  const montre = () => {
    vue.src = exemple().image;
    note.textContent = exemple().note;
    apercuJoint.src = st.joint || exemple().image;
    legende.textContent = '';
    legende.append(
      el('strong', null, '📎 Fichier joint'),
      el('span', null, st.joint ? 'image personnelle' : `car_exemple.png — ${exemple().name}`),
      el('span', 'aide', `Envoyé avec le prompt à chaque demande, en ${SPRITE.w} × ${SPRITE.h}, transparence comprise.`),
    );
    retour.hidden = !st.joint;
  };
  choix.onchange = () => {
    st.exemple = choix.value;
    garde();
    montre();
  };
  fichier.onchange = () => {
    const f = fichier.files[0];
    if (!f) return;
    const lecteur = new FileReader();
    lecteur.onload = () => {
      st.joint = String(lecteur.result);
      garde();
      montre();
    };
    lecteur.readAsDataURL(f);
  };
  const actions = el('div', 'rang');
  actions.append(bouton('Remplacer…', 'small', () => fichier.click()), retour, fichier);
  joint.append(apercuJoint, legende);
  e2.append(joint, actions);
  montre();

  // 3. Prompt design
  const e3 = etape(page, 3, 'Prompt supplémentaire', 'La livrée : couleurs, motifs, matériaux, style de carrosserie…');
  const extra = el('textarea', 'champ');
  extra.rows = 5;
  extra.placeholder = 'Ex. : livrée noir mat et or, bandes fines, jantes dorées, style muscle car futuriste.';
  extra.value = st.extra;
  extra.oninput = () => {
    st.extra = extra.value;
    garde();
  };
  e3.append(extra);

  // 4. Nombre d'images
  const e4 = etape(page, 4, 'Nombre d’images', 'Fournisseur et version exacte du modèle. Chaque image est facturée ; trois partent en même temps. Le fond transparent n’est garanti qu’avec OpenAI.');
  const rang = el('div', 'rang');
  const n = el('select', 'champ court');
  for (let i = 1; i <= 100; i += 1) n.append(new Option(String(i), String(i), false, i === st.n));
  n.onchange = () => {
    st.n = Number(n.value);
    garde();
  };
  const fournisseur = el('select', 'champ court');
  const modele = el('select', 'champ court');
  const autre = el('input', 'champ court');
  autre.placeholder = 'nom exact du modèle';
  autre.hidden = true;
  autre.oninput = () => {
    st.modeles[st.provider] = autre.value.trim();
    garde();
  };
  modele.onchange = () => {
    autre.hidden = modele.value !== '*';
    if (modele.value === '*') {
      const courant = st.modeles[st.provider] || '';
      autre.value = [...modele.options].some((o) => o.value === courant) ? '' : courant;
      st.modeles[st.provider] = autre.value.trim();
      autre.focus();
    } else {
      st.modeles[st.provider] = modele.value;
    }
    garde();
  };
  fournisseur.onchange = () => {
    st.provider = fournisseur.value;
    garde();
    remplitModeles(modele, autre, st, garde, say);
  };
  const go = bouton('Générer', 'go', () => generer());
  const stop = bouton('Arrêter', 'small', () => st.job && api(`/api/arenes/jobs/${st.job}/annuler`, { method: 'POST' }));
  stop.hidden = true;
  const avance = el('span', 'avance');
  rang.append(n, fournisseur, modele, autre, go, stop, avance);
  e4.append(rang);
  remplitFournisseurs(fournisseur, st, garde, say).then(() => remplitModeles(modele, autre, st, garde, say));

  // 5. Apercu
  const e5 = etape(page, 5, 'Aperçu', 'Violet : le cadre qui deviendra la voiture en jeu, étiré sur le rectangle où rebondit la balle. Jaune : le disque qui touche les murs ; jaune pointillé : celui qui touche les autres voitures. Gris pointillé : la silhouette maximale de l’exemple. Glisse l’image pour déplacer le cadre, ou clique dessus puis flèches, A/D (largeur), W/S (longueur). Maj = par dix.');
  const grille = el('div', 'brouillons voitures');
  const accepter = bouton('Accepter les modifs', 'go enorme', () => accepterTout());
  e5.append(grille, accepter);

  // 6. Voitures creees
  const e6 = etape(page, 6, 'Voitures créées', '« Équiper » en fait ta voiture dans ce navigateur, en solo comme en ligne.');
  const liste = el('div', 'creees voitures');
  const jeu = el('div', 'essai');
  e6.append(liste, jeu);

  const dessineBrouillons = () => {
    grille.textContent = '';
    if (!st.drafts.length) grille.append(el('p', 'aide', 'Aucune voiture en attente. Lance une génération à l’étape 4.'));
    for (const d of st.drafts) grille.append(carte(d));
    accepter.disabled = !st.drafts.length;
  };

  const carte = (d) => {
    const box = el('div', 'brouillon');
    const nom = el('input', 'champ');
    nom.value = d.name;
    nom.placeholder = 'Nom de la voiture';
    nom.oninput = () => {
      d.name = nom.value;
      garde();
    };
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const chiffres = el('p', 'chiffres', resume(d.cadre));
    const maj = () => {
      paint();
      chiffres.textContent = resume(d.cadre);
      garde();
    };
    // Ce qu'on montre : l'image generee, ou sa version recoloree.
    let vue = null;
    const { canvas, paint } = apercu(() => vue, () => d.cadre, (dx, dy) => {
      applique(d.cadre, { dx, dy });
      maj();
    });
    const colore = () => {
      if (!img.complete || !img.naturalWidth) return;
      vue = d.teinte ? teinter(img, d.teinte) : img;
      paint();
      for (const [id, b] of pastilles) b.classList.toggle('active', id === d.teinte);
    };
    img.onload = colore;
    img.src = brouillon(d.id);
    // Deux pastilles : bleu ou rouge pour le blanc de la carrosserie ; la
    // pastille active, pressee de nouveau, rend le blanc.
    const pastilles = Object.entries(TEINTES).map(([id, t]) => {
      const b = bouton('', `carre pastille ${id}`, () => {
        d.teinte = d.teinte === id ? null : id;
        garde();
        colore();
      }, `Carrosserie ${t.nom.toLowerCase()} (encore une fois : blanc)`);
      return [id, b];
    });
    canvas.addEventListener('keydown', (e) => {
      const m = gesteDe(e);
      if (!m) return;
      e.preventDefault();
      applique(d.cadre, m, e.shiftKey ? 10 : 1);
      maj();
    });

    const retouche = el('div', 'retouche');
    retouche.hidden = true;
    const calage = el('div', 'calage');
    calage.hidden = true;
    const outils = el('div', 'carres');
    outils.append(
      ...pastilles.map(([, b]) => b),
      bouton('✕', 'carre danger', () => jeter(d), 'Supprimer cette voiture'),
      bouton('✎', 'carre', () => { retouche.hidden = !retouche.hidden; }, 'Modifier un peu avec un prompt'),
      bouton('⌖', 'carre', () => { calage.hidden = !calage.hidden; }, 'Caler la hitbox aux boutons'),
    );

    const texte = el('textarea', 'champ');
    texte.rows = 3;
    texte.placeholder = 'Ce qu’il faut changer : « aileron plus bas », « jantes noires »…';
    const etat = el('span', 'avance');
    const lance = bouton('Retoucher', 'go small', async () => {
      if (!texte.value.trim()) return;
      lance.disabled = true;
      etat.textContent = 'Retouche en cours (une à deux minutes)…';
      try {
        const r = await json(await post('/api/arenes/retoucher', {
          kind: 'voiture',
          provider: st.provider,
          model: st.modeles[st.provider] || '',
          id: d.id,
          prompt: `${texte.value.trim()}\n\n${st.auto}`,
        }));
        api(`/api/arenes/brouillons/${d.id}`, { method: 'DELETE' });
        d.id = r.id;
        garde();
        img.src = brouillon(d.id);
        etat.textContent = 'Retouchée.';
      } catch (err) {
        etat.textContent = err.message;
      }
      lance.disabled = false;
    });
    retouche.append(texte, lance, etat);

    for (const [nomGeste, gestes] of GESTES) {
      const ligne = el('div', 'geste');
      ligne.append(el('span', null, nomGeste));
      for (const [signe, m] of gestes) {
        ligne.append(bouton(signe, 'mini', (e) => {
          applique(d.cadre, m, e.shiftKey ? 10 : 1);
          maj();
        }));
      }
      calage.append(ligne);
    }
    calage.append(bouton('Image entière', 'small', () => {
      d.cadre = cadreParDefaut();
      maj();
    }));

    const tete = el('div', 'tete');
    tete.append(nom, outils);
    box.append(tete, retouche, canvas, chiffres, calage);
    return box;
  };

  const jeter = (d) => {
    st.drafts = st.drafts.filter((x) => x !== d);
    garde();
    api(`/api/arenes/brouillons/${d.id}`, { method: 'DELETE' });
    dessineBrouillons();
  };

  let suivi = null;
  const suivre = () => {
    clearTimeout(suivi);
    go.disabled = !!st.job;
    stop.hidden = !st.job;
    if (!st.job) return;
    api(`/api/arenes/jobs/${st.job}`).then(json).then((j) => {
      for (const id of j.done) {
        if (!st.drafts.some((x) => x.id === id)) {
          st.drafts.push({ id, name: `Voiture créée ${st.drafts.length + 1}`, cadre: cadreParDefaut() });
        }
      }
      garde();
      dessineBrouillons();
      const erreurs = j.errors.length ? ` · ${j.errors.length} en erreur : ${j.errors[j.errors.length - 1]}` : '';
      avance.textContent = `${j.done.length} / ${j.total} prêtes${erreurs}`;
      if (j.finished) {
        st.job = null;
        garde();
        say(j.cancelled ? 'Génération arrêtée.' : 'Génération terminée.', j.errors.length ? 'bad' : 'ok');
      }
      suivi = setTimeout(suivre, 3000);
    }).catch((err) => {
      avance.textContent = err.message;
      st.job = null;
      garde();
      suivi = setTimeout(suivre, 3000);
    });
  };

  const generer = async () => {
    const prompt = st.extra.trim() ? `${st.auto.trim()}\n\nDesign demandé :\n${st.extra.trim()}` : st.auto.trim();
    go.disabled = true;
    avance.textContent = 'Préparation de l’exemple…';
    try {
      // L'exemple part au format des sprites, transparence comprise.
      const base = await image(st.joint || exemple().image);
      const cv = el('canvas');
      cv.width = SPRITE.w;
      cv.height = SPRITE.h;
      cv.getContext('2d').drawImage(base, 0, 0, SPRITE.w, SPRITE.h);
      const r = await json(await post('/api/arenes/generer', {
        kind: 'voiture',
        provider: st.provider,
        model: st.modeles[st.provider] || '',
        prompt,
        n: st.n,
        gabarit: cv.toDataURL('image/png'),
      }));
      st.job = r.job;
      garde();
      say(`${r.total} voiture${r.total > 1 ? 's' : ''} demandée${r.total > 1 ? 's' : ''}. Elles arrivent au fil de l’eau.`);
      suivre();
    } catch (err) {
      go.disabled = false;
      avance.textContent = '';
      say(err.message, 'bad');
    }
  };

  const accepterTout = async () => {
    accepter.disabled = true;
    let ok = 0;
    for (const d of [...st.drafts]) {
      try {
        const base = await image(brouillon(d.id));
        const { sprite, mini } = versSprite(d.teinte ? teinter(base, d.teinte) : base, d.cadre);
        await json(await post('/api/voitures/accepter', {
          name: d.name,
          image: sprite,
          thumb: mini,
          cadre: d.cadre.map(Math.round),
        }));
        api(`/api/arenes/brouillons/${d.id}`, { method: 'DELETE' });
        st.drafts = st.drafts.filter((x) => x !== d);
        garde();
        ok += 1;
      } catch (err) {
        say(`${d.name} : ${err.message}`, 'bad');
      }
    }
    dessineBrouillons();
    await dessineCreees();
    if (ok) {
      say(`${ok} voiture${ok > 1 ? 's' : ''} ajoutée${ok > 1 ? 's' : ''} au jeu.`, 'ok');
      e6.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const dessineCreees = () => dessineVoitures(liste, jeu, say);

  dessineBrouillons();
  dessineCreees();
  suivre();
}
