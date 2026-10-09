// Creation > Son : choisir un moteur, le regler, l'essayer au banc,
// generer les 4 sons du jeu, les ecouter, les telecharger, et en faire le
// moteur de la Koenigsegg.

import { USINE, CURSEURS, SYNTHESE, LISTE_ARCHITECTURES, normaliser, recetteUsine, synthese } from './son/recettes.js';
import { creerBanc, SCENARIOS } from './son/banc.js';
import { genererSons, SONS_MOTEUR, FREQUENCE, wavMono } from './son/generateur.js';
import { moteurDuJeu, choisirPourLeJeu } from './son/choix.js';
import { lufs, spectre, stridence } from './son/mesures.js';

const $ = (id) => document.getElementById(id);
const CLE_PERSO = 'skidmania.creation.perso';

let recette = moteurDuJeu().recette;
let reglages = moteurDuJeu().synthese;
let sons = null;
let ctx = null;
let lecture = null;

const banc = creerBanc($('compte-tours'));

// ------------------------------------------------------- liste moteurs --

function perso() {
  try {
    return JSON.parse(localStorage.getItem(CLE_PERSO)) || null;
  } catch {
    return null;
  }
}

function listeMoteurs() {
  const jeu = moteurDuJeu().recette;
  const liste = $('liste-moteurs');
  liste.textContent = '';
  const entrees = USINE.map((u) => ({ r: recetteUsine(u.id), usine: true }));
  const p = perso();
  if (p) entrees.unshift({ r: normaliser(p), usine: false });
  for (const { r, usine } of entrees) {
    const b = document.createElement('button');
    b.className = 'carte-moteur';
    b.classList.toggle('choisi', r.id === recette.id);
    const archi = LISTE_ARCHITECTURES.find(([id]) => id === r.architecture)?.[1] ?? '';
    b.innerHTML = `<b></b><small></small>`;
    b.querySelector('b').textContent = r.nom;
    b.querySelector('small').textContent = usine ? archi : `${archi} · perso`;
    if (r.id === jeu.id) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = 'EN JEU';
      b.appendChild(badge);
    }
    b.addEventListener('click', () => choisir(r));
    liste.appendChild(b);
  }
}

function choisir(r) {
  recette = { ...r };
  sons = null;
  $('sons').textContent = '';
  $('utiliser').disabled = true;
  remplir();
  listeMoteurs();
  banc.poser(recette);
}

// --------------------------------------------------------- curseurs --

const affiche = (v, pas) => (pas >= 1 ? String(Math.round(v)) : v.toFixed(pas >= 0.1 ? 1 : 2));

function curseur(parent, [cle, titre, min, max, pas], valeur, change) {
  const ligne = document.createElement('div');
  ligne.className = 'curseur';
  const id = `c-${cle}`;
  ligne.innerHTML = `<label for="${id}"></label><output></output><input type="range" id="${id}">`;
  ligne.querySelector('label').textContent = titre;
  const entree = ligne.querySelector('input');
  const sortie = ligne.querySelector('output');
  Object.assign(entree, { min, max, step: pas, value: valeur });
  sortie.textContent = affiche(valeur, pas);
  entree.addEventListener('input', () => {
    sortie.textContent = affiche(Number(entree.value), pas);
    change(Number(entree.value));
  });
  parent.appendChild(ligne);
}

/** Toute modification fait de la recette un moteur perso, garde a part. */
function modifier(cle, v) {
  if (!recette.id.startsWith('perso')) {
    recette = { ...recette, id: 'perso', nom: `${recette.nom} perso` };
    $('nom-moteur').value = recette.nom;
  }
  recette[cle] = v;
  recette = normaliser(recette);
  try {
    localStorage.setItem(CLE_PERSO, JSON.stringify(recette));
  } catch {
    /* stockage bloque : le reglage vaut pour cette page */
  }
  banc.poser(recette);
  sons = null;
  $('utiliser').disabled = true;
  listeMoteurs();
}

function remplir() {
  $('nom-moteur').value = recette.nom;
  $('architecture').value = recette.architecture;
  const zone = $('curseurs');
  zone.textContent = '';
  const groupes = {};
  for (const c of CURSEURS) {
    if (!groupes[c[5]]) {
      const g = document.createElement('div');
      g.className = 'groupe';
      g.innerHTML = '<h3></h3>';
      g.querySelector('h3').textContent = c[5];
      zone.appendChild(g);
      groupes[c[5]] = g;
    }
    curseur(groupes[c[5]], c, recette[c[0]], (v) => modifier(c[0], v));
  }
  const fin = $('finition');
  fin.textContent = '';
  for (const s of SYNTHESE) {
    curseur(fin, s, reglages[s[0]], (v) => {
      reglages = synthese({ ...reglages, [s[0]]: v });
      sons = null;
      $('utiliser').disabled = true;
    });
  }
}

$('architecture').innerHTML = LISTE_ARCHITECTURES.map(([id, nom]) => `<option value="${id}">${nom}</option>`).join('');
$('architecture').addEventListener('change', (e) => modifier('architecture', e.target.value));
$('nom-moteur').addEventListener('change', (e) => modifier('nom', e.target.value.trim() || 'Moteur'));

// ------------------------------------------------------------- banc --

for (const [nom, sc] of Object.entries(SCENARIOS)) {
  const b = document.createElement('button');
  b.textContent = sc.nom;
  b.addEventListener('click', () => banc.jouer(nom));
  $('scenarios').appendChild(b);
}
const stop = document.createElement('button');
stop.textContent = 'Stop';
stop.addEventListener('click', () => banc.arreter());
$('scenarios').appendChild(stop);

const gaz = $('gaz');
const appui = (on) => {
  gaz.classList.toggle('appuye', on);
  banc.gaz(on ? 1 : 0);
};
gaz.addEventListener('pointerdown', (e) => {
  gaz.setPointerCapture(e.pointerId);
  appui(true);
});
gaz.addEventListener('pointerup', () => appui(false));
gaz.addEventListener('pointercancel', () => appui(false));

// -------------------------------------------------------- sons du jeu --

function jouer(x, boucle) {
  ctx ??= new AudioContext();
  ctx.resume();
  lecture?.stop();
  const buf = ctx.createBuffer(1, x.length, FREQUENCE);
  buf.copyToChannel(x, 0);
  lecture = ctx.createBufferSource();
  lecture.buffer = buf;
  lecture.loop = boucle;
  lecture.connect(ctx.destination);
  lecture.start();
}

function telecharger(x, nom) {
  const url = URL.createObjectURL(new Blob([wavMono(x, FREQUENCE)], { type: 'audio/wav' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${nom}.wav`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$('generer').addEventListener('click', async () => {
  const bouton = $('generer');
  bouton.disabled = true;
  const version = document.querySelector('input[name=version]:checked').value;
  const barre = document.createElement('i');
  $('progres').replaceChildren(barre);
  try {
    sons = await genererSons(recette, {
      version,
      synthese: reglages,
      progres: (k, n) => { barre.style.width = `${(100 * k) / n}%`; },
    });
    barre.style.width = '100%';
    const zone = $('sons');
    zone.textContent = '';
    for (const son of SONS_MOTEUR) {
      const x = sons[son.id];
      const ligne = document.createElement('div');
      ligne.className = 'son';
      ligne.innerHTML = '<span></span><button>▶</button><button>WAV</button><small></small>';
      ligne.querySelector('span').textContent = son.nom;
      const [play, wav] = ligne.querySelectorAll('button');
      play.addEventListener('click', () => jouer(x, !!son.boucle));
      wav.addEventListener('click', () => telecharger(x, `${recette.nom}-${son.id}-${version}`));
      const l = lufs(x, FREQUENCE);
      ligne.querySelector('small').textContent = `${l.toFixed(1)} LUFS · stridence ${stridence(spectre(x, FREQUENCE)).toFixed(1)} dB`;
      zone.appendChild(ligne);
    }
    $('utiliser').disabled = version !== 'v2';
    $('etat-jeu').textContent = version === 'v2' ? '' : 'La référence sert à comparer : le jeu utilise toujours le générateur v2.';
  } catch (err) {
    $('etat-jeu').textContent = `Échec de la génération : ${err.message}`;
  } finally {
    bouton.disabled = false;
  }
});

$('utiliser').addEventListener('click', () => {
  const ok = choisirPourLeJeu(recette, reglages);
  $('etat-jeu').textContent = ok
    ? `${recette.nom} est le moteur de la Koenigsegg. Recharge le jeu pour l’entendre.`
    : 'Impossible d’enregistrer (stockage du navigateur bloqué).';
  listeMoteurs();
});

// onglet cache : le banc s'arrete et l'ecoute aussi
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) return;
  banc.arreter();
  lecture?.stop();
  lecture = null;
  gaz.classList.remove('appuye');
});

remplir();
listeMoteurs();
banc.poser(recette);
