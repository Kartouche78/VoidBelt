// Onglet « Génération de stade ».
//
//   1. Gabarit          la planche technique que l'IA repeint
//   2. Prompt auto      ce que le modele doit respecter, modifiable
//   3. Prompt design    le style voulu
//   4. Nombre d'images  et fournisseur, puis generation
//   5. Apercu           hitbox par-dessus ; jeter, retoucher, caler, accepter
//   6. Arenes creees    et les essayer en jeu
//
// Le travail en cours (prompts, brouillons, calages) est garde dans ce
// navigateur : un rechargement ne perd rien, pas meme une generation en
// cours, qui continue sur le serveur.

import { api, BASE } from '../api.js';
import { GABARITS, PLANCHE, promptAuto } from './gabarits.js';
import { apercu, applique, gesteDe, GESTES, resume } from './hitbox.js';
import { remplitFournisseurs, remplitModeles } from './fournisseurs.js';
import { dessineCreees, versPlanche } from './creees.js';

const CLE = 'voidbelt.rl2.gen-stade';
/** A incrementer quand le prompt par defaut change : le prompt garde dans
 *  le navigateur est alors remplace par le nouveau. */
const PROMPT_REV = 2;
/** Format envoye a l'IA : le paysage 3:2 que les modeles savent produire.
 *  La planche y est etiree, puis ramenee au format du jeu a l'acceptation,
 *  ce qui rend au trace sa geometrie exacte. */
const ENVOI = { w: 1536, h: 1024 };

let st;
let say;

function charge() {
  let s = {};
  try {
    s = JSON.parse(localStorage.getItem(CLE) || '{}');
  } catch {
    // Stockage illisible : on repart de zero.
  }
  const g = GABARITS.find((x) => x.id === s.gabarit) || GABARITS[0];
  return {
    gabarit: g.id,
    // Le prompt garde n'est repris que s'il date du prompt par defaut en
    // vigueur ; sinon le nouveau le remplace.
    auto: s.promptRev === PROMPT_REV && s.auto ? s.auto : promptAuto(g),
    promptRev: PROMPT_REV,
    extra: s.extra ?? '',
    n: s.n ?? 4,
    provider: s.provider ?? 'openai',
    drafts: s.drafts ?? [],
    job: s.job ?? null,
    // Piece jointe choisie a la place du gabarit, en adresse `data:`.
    joint: s.joint ?? null,
    // Modele choisi, par fournisseur : changer de fournisseur ne perd pas
    // celui de l'autre.
    modeles: s.modeles ?? {},
  };
}

function garde() {
  try {
    localStorage.setItem(CLE, JSON.stringify(st));
  } catch {
    // Plein ou refuse : le travail vaut pour la session.
  }
}

const gabarit = () => GABARITS.find((x) => x.id === st.gabarit) || GABARITS[0];
const calageDe = (g) => ({ fit: [...g.fit], corner: g.corner, goal: { ...g.goal } });

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

/** Une etape numerotee de la page. */
function etape(page, n, titre, aide) {
  const box = el('section', 'etape');
  const h = el('h3', null, titre);
  h.prepend(el('span', 'num', String(n)));
  box.append(h);
  if (aide) box.append(el('p', 'aide', aide));
  page.append(box);
  return box;
}

/** Charge une image, en autorisant sa relecture dans un canevas. */
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

// -------------------------------------------------------------- la page --

export async function drawStade(page) {
  st = charge();
  const msg = el('p', 'msg');
  page.append(msg);
  say = (text, kind = '') => {
    msg.textContent = text;
    msg.className = `msg ${kind}`;
  };

  // 1. Gabarit
  const e1 = etape(page, 1, 'Gabarit', 'La planche technique que l’IA repeint : terrain, murets et cages y sont déjà à leur place.');
  const choix = el('select', 'champ');
  for (const g of GABARITS) choix.append(new Option(g.name, g.id, false, g.id === st.gabarit));
  const vue = el('img', 'gabarit');
  const note = el('p', 'aide');
  const montre = () => {
    vue.src = gabarit().image;
    note.textContent = gabarit().note;
  };
  choix.onchange = () => {
    st.gabarit = choix.value;
    montre();
    montreJoint();
    garde();
  };
  montre();
  e1.append(choix, vue, note);

  // 2. Prompt automatique
  const e2 = etape(page, 2, 'Prompt automatique', 'Ce que le modèle doit respecter. Écris, supprime, ajuste librement.');
  const auto = el('textarea', 'champ grand');
  auto.rows = 16;
  auto.value = st.auto;
  auto.oninput = () => {
    st.auto = auto.value;
    garde();
  };
  e2.append(auto, bouton('Recréer depuis le gabarit', 'small', () => {
    auto.value = st.auto = promptAuto(gabarit());
    garde();
  }));

  // Piece jointe : l'image envoyee avec le prompt a chaque demande. Le
  // gabarit par defaut, ou une image a soi pour partir d'une autre base.
  const joint = el('div', 'joint');
  const apercuJoint = el('img');
  apercuJoint.alt = '';
  const legende = el('div', 'legende');
  const fichier = el('input');
  fichier.type = 'file';
  fichier.accept = 'image/png,image/jpeg,image/webp';
  fichier.hidden = true;
  const retour = bouton('Revenir au gabarit', 'small', () => {
    st.joint = null;
    garde();
    montreJoint();
  });
  const montreJoint = () => {
    apercuJoint.src = st.joint || gabarit().image;
    legende.textContent = '';
    legende.append(
      el('strong', null, '📎 Fichier joint'),
      el('span', null, st.joint ? 'image personnelle' : `gabarit.png — ${gabarit().name}`),
      el('span', 'aide', `Envoyé avec le prompt à chaque demande, au format ${ENVOI.w} × ${ENVOI.h}.`),
    );
    retour.hidden = !st.joint;
  };
  fichier.onchange = () => {
    const f = fichier.files[0];
    if (!f) return;
    const lecteur = new FileReader();
    lecteur.onload = () => {
      st.joint = String(lecteur.result);
      garde();
      montreJoint();
    };
    lecteur.readAsDataURL(f);
  };
  const actions = el('div', 'rang');
  actions.append(bouton('Remplacer…', 'small', () => fichier.click()), retour, fichier);
  joint.append(apercuJoint, legende);
  e2.append(joint, actions);
  montreJoint();

  // 3. Prompt design
  const e3 = etape(page, 3, 'Prompt supplémentaire', 'Le design : thème, ambiance, couleurs, matériaux, éclairage…');
  const extra = el('textarea', 'champ');
  extra.rows = 5;
  extra.placeholder = 'Ex. : arène volcanique de nuit, lave sous des grilles, tribunes en obsidienne, éclairage orange.';
  extra.value = st.extra;
  extra.oninput = () => {
    st.extra = extra.value;
    garde();
  };
  e3.append(extra);

  // 4. Nombre d'images
  const e4 = etape(page, 4, 'Nombre d’images', 'Fournisseur et version exacte du modèle. Chaque image est facturée par le fournisseur ; trois partent en même temps.');
  const rang = el('div', 'rang');
  const n = el('select', 'champ court');
  for (let i = 1; i <= 100; i += 1) n.append(new Option(String(i), String(i), false, i === st.n));
  n.onchange = () => {
    st.n = Number(n.value);
    garde();
  };
  const fournisseur = el('select', 'champ court');
  const modele = el('select', 'champ court');
  modele.title = 'Version du modèle';
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
      // Vide si le modele courant est deja dans la liste : on en tape un
      // autre, pas une suite a celui-la.
      const courant = st.modeles[st.provider] || '';
      const connu = [...modele.options].some((o) => o.value === courant);
      autre.value = connu ? '' : courant;
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
  const stop = bouton('Arrêter', 'small', () => annuler());
  stop.hidden = true;
  const avance = el('span', 'avance');
  rang.append(n, fournisseur, modele, autre, go, stop, avance);
  e4.append(rang);
  remplitFournisseurs(fournisseur, st, garde, say).then(() => remplitModeles(modele, autre, st, garde, say));

  // 5. Apercu
  const e5 = etape(page, 5, 'Aperçu', 'La hitbox est tracée par-dessus : violet le terrain, jaune les cages. Glisse la planche pour déplacer le contour, ou clique dessus puis flèches, A/D, W/S, Q/E (coins), I/K, J/L, U/O (cages). Maj = par dix.');
  const grille = el('div', 'brouillons');
  const accepter = bouton('Accepter les modifs', 'go enorme', () => accepterTout());
  e5.append(grille, accepter);

  // 6. Arenes creees
  const e6 = etape(page, 6, 'Arènes créées', 'Les arènes acceptées apparaissent dans le jeu, onglet « Créées » du choix du stade.');
  const liste = el('div', 'creees');
  const jeu = el('div', 'essai');
  e6.append(liste, jeu);

  // ---------------------------------------------------------- actions --

  const dessineBrouillons = () => {
    grille.textContent = '';
    if (!st.drafts.length) grille.append(el('p', 'aide', 'Aucune image en attente. Lance une génération à l’étape 4.'));
    for (const d of st.drafts) grille.append(carte(d));
    accepter.disabled = !st.drafts.length;
  };

  const carte = (d) => {
    const box = el('div', 'brouillon');
    const nom = el('input', 'champ');
    nom.value = d.name;
    nom.placeholder = 'Nom de l’arène';
    nom.oninput = () => {
      d.name = nom.value;
      garde();
    };
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const { canvas, paint } = apercu(img, () => d.calage, (dx, dy) => {
      applique(d.calage, { dx, dy });
      maj();
    });
    img.onload = paint;
    img.src = `${BASE}/api/arenes/brouillons/${d.id}`;
    const chiffres = el('p', 'chiffres');
    const maj = () => {
      paint();
      chiffres.textContent = resume(d.calage);
      garde();
    };
    canvas.addEventListener('keydown', (e) => {
      const m = gesteDe(e);
      if (!m) return;
      e.preventDefault();
      applique(d.calage, m, e.shiftKey ? 10 : 1);
      maj();
    });

    // Boutons carres : jeter, retoucher, caler.
    const outils = el('div', 'carres');
    const retouche = el('div', 'retouche');
    retouche.hidden = true;
    const calage = el('div', 'calage');
    calage.hidden = true;
    outils.append(
      bouton('✕', 'carre danger', () => jeter(d), 'Supprimer cette image'),
      bouton('✎', 'carre', () => {
        retouche.hidden = !retouche.hidden;
      }, 'Modifier un peu avec un prompt'),
      bouton('⌖', 'carre', () => {
        calage.hidden = !calage.hidden;
      }, 'Caler la hitbox aux boutons'),
    );

    const texte = el('textarea', 'champ');
    texte.rows = 3;
    texte.placeholder = 'Ce qu’il faut changer : « tribunes plus sombres », « retire la piste d’athlétisme »…';
    const etat = el('span', 'avance');
    const lance = bouton('Retoucher', 'go small', async () => {
      if (!texte.value.trim()) return;
      lance.disabled = true;
      etat.textContent = 'Retouche en cours (une à deux minutes)…';
      try {
        const r = await json(await api('/api/arenes/retoucher', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            provider: st.provider,
            model: st.modeles[st.provider] || '',
            id: d.id,
            prompt: `${texte.value.trim()}\n\n${st.auto}`,
          }),
        }));
        api(`/api/arenes/brouillons/${d.id}`, { method: 'DELETE' });
        d.id = r.id;
        garde();
        img.src = `${BASE}/api/arenes/brouillons/${d.id}`;
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
          applique(d.calage, m, e.shiftKey ? 10 : 1);
          maj();
        }));
      }
      calage.append(ligne);
    }
    calage.append(bouton('Revenir au gabarit', 'small', () => {
      d.calage = calageDe(gabarit());
      maj();
    }));

    const tete = el('div', 'tete');
    tete.append(nom, outils);
    box.append(tete, retouche, canvas, chiffres, calage);
    chiffres.textContent = resume(d.calage);
    return box;
  };

  const jeter = (d) => {
    st.drafts = st.drafts.filter((x) => x !== d);
    garde();
    api(`/api/arenes/brouillons/${d.id}`, { method: 'DELETE' });
    dessineBrouillons();
  };

  const ajoute = (ids) => {
    for (const id of ids) {
      if (st.drafts.some((d) => d.id === id)) continue;
      st.drafts.push({ id, name: `Arène créée ${st.drafts.length + 1}`, calage: calageDe(gabarit()) });
    }
    garde();
    dessineBrouillons();
  };

  let suivi = null;
  const suivre = () => {
    clearTimeout(suivi);
    if (!st.job) {
      go.disabled = false;
      stop.hidden = true;
      return;
    }
    go.disabled = true;
    stop.hidden = false;
    api(`/api/arenes/jobs/${st.job}`).then(json).then((j) => {
      ajoute(j.done);
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
    const prompt = st.extra.trim()
      ? `${st.auto.trim()}\n\nDesign demandé :\n${st.extra.trim()}`
      : st.auto.trim();
    go.disabled = true;
    avance.textContent = 'Préparation du gabarit…';
    try {
      const base = await image(st.joint || gabarit().image);
      const cv = el('canvas');
      cv.width = ENVOI.w;
      cv.height = ENVOI.h;
      cv.getContext('2d').drawImage(base, 0, 0, ENVOI.w, ENVOI.h);
      const r = await json(await api('/api/arenes/generer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: st.provider,
          model: st.modeles[st.provider] || '',
          prompt,
          n: st.n,
          gabarit: cv.toDataURL('image/png'),
        }),
      }));
      st.job = r.job;
      garde();
      say(`${r.total} image${r.total > 1 ? 's' : ''} demandée${r.total > 1 ? 's' : ''}. Elles arrivent au fil de l’eau.`);
      suivre();
    } catch (err) {
      go.disabled = false;
      avance.textContent = '';
      say(err.message, 'bad');
    }
  };

  const annuler = () => {
    if (st.job) api(`/api/arenes/jobs/${st.job}/annuler`, { method: 'POST' });
  };

  /** Ramene chaque brouillon au format du jeu, avec sa miniature, et
   *  l'envoie au catalogue. Ceux qui echouent restent dans l'apercu. */
  const accepterTout = async () => {
    accepter.disabled = true;
    let ok = 0;
    for (const d of [...st.drafts]) {
      try {
        const { planche, mini } = versPlanche(await image(`${BASE}/api/arenes/brouillons/${d.id}`));
        const c = d.calage;
        await json(await api('/api/arenes/accepter', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: d.name,
            image: planche,
            thumb: mini,
            size: [PLANCHE.w, PLANCHE.h],
            fit: c.fit.map(Math.round),
            corner: Math.round(c.corner),
            goal: { half: Math.round(c.goal.half), depth: Math.round(c.goal.depth), post: Math.round(c.goal.post) },
          }),
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
    await dessineCreees(liste, jeu);
    if (ok) {
      say(`${ok} arène${ok > 1 ? 's' : ''} ajoutée${ok > 1 ? 's' : ''} au jeu.`, 'ok');
      e6.scrollIntoView({ behavior: 'smooth' });
    }
  };

  dessineBrouillons();
  dessineCreees(liste, jeu);
  suivre();
}
