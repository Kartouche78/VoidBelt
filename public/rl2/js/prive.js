// Ecran « Partie privee » : l'hote choisit l'arene et regle la partie,
// puis cree le lobby. Le salon n'apparait dans aucune liste : ses amis le
// rejoignent en le suivant (groupe) ou depuis le panneau (« rejoindre sa
// partie »). Le serveur (`src/rl2/prive.rs`) tient les memes bornes.
//
// Les reglages se gardent d'une fois sur l'autre dans le navigateur.

import { carteJoueur } from './carte-joueur.js';
import { moi } from './multi-connexion.js';
import { API_HTTP } from './net.js';
import { STADIUMS } from './stadiums.js';

const $ = (id) => document.getElementById(id);
const MANCHES = [1, 3, 5, 7];
const DUREES = [2, 3, 5, 7, 10];
const NOMS = ['Les Comètes', 'Les Météores'];
const CLE = 'rl2-prive';
const DEFAUT = {
  arene: 'aleatoire',
  par_equipe: 1,
  manches: 3,
  minutes: 5,
  boosts: true,
  demolitions: true,
  reapparition: false,
  noms: ['', ''],
};

function lire() {
  try {
    return { ...DEFAUT, ...JSON.parse(localStorage.getItem(CLE) || '{}') };
  } catch {
    return { ...DEFAUT, noms: ['', ''] };
  }
}

function garder(r) {
  try {
    localStorage.setItem(CLE, JSON.stringify(r));
  } catch {
    // Stockage bloque : les reglages vivent le temps de la page.
  }
}

const el = (tag, cls, texte) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (texte !== undefined) e.textContent = texte;
  return e;
};

/** Melange (deux fleches croisees) et de, pour la case « Aleatoire ». */
const MELANGE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7h3.5c2 0 3.3 1 4.4 2.6l2.2 3.3c1 1.5 2.3 2.4 4.2 2.4H21"/><path d="M3 17h3.5c1.6 0 2.7-.6 3.6-1.7M14 8.3c.9-.9 2-1.3 3.3-1.3H21"/><path d="M18.5 4.5L21 7l-2.5 2.5M18.5 14.5L21 17l-2.5 2.5"/></svg>';
const DE = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l8.5 4.8v10.4L12 22l-8.5-4.8V6.8z" opacity=".9"/><circle cx="12" cy="7" r="1.3" fill="#1a0e05"/><circle cx="8" cy="12.5" r="1.2" fill="#1a0e05"/><circle cx="16" cy="12.5" r="1.2" fill="#1a0e05"/><circle cx="12" cy="17" r="1.2" fill="#1a0e05"/></svg>';

/** Avatar d'un joueur, ou son initiale. */
function avatar(j) {
  if (j.avatar) {
    const i = el('img', 'pv-avatar');
    i.src = j.avatar.startsWith('/') ? API_HTTP + j.avatar : j.avatar;
    i.alt = '';
    i.referrerPolicy = 'no-referrer';
    return i;
  }
  return el('span', 'pv-avatar pv-initiale', (j.pseudo || '?').slice(0, 1).toUpperCase());
}

/** `creer({ reglages, stade, dire })` entre dans le salon ; `dire(texte)`
 *  ecrit sous le bouton. */
export function brancherPrive({ menu, panneau, creer }) {
  let r = lire();
  const statut = $('prive-statut');
  const dire = (t) => {
    statut.textContent = t || '';
  };
  carteJoueur($('prive-joueur'), panneau);

  const change = () => {
    garder(r);
    peindre();
  };

  // Arenes : « Aleatoire » en tete, puis tous les stades.
  function arenes() {
    const box = $('prive-arenes');
    box.textContent = '';
    const hasard = el('button', 'pv-arene pv-hasard');
    hasard.type = 'button';
    hasard.innerHTML = `${MELANGE}<span>Aléatoire</span>${DE}`;
    hasard.classList.toggle('active', r.arene === 'aleatoire');
    hasard.onclick = () => {
      r.arene = 'aleatoire';
      change();
    };
    box.append(hasard);
    for (const s of STADIUMS) {
      const b = el('button', 'pv-arene');
      b.type = 'button';
      b.classList.toggle('active', r.arene === s.id);
      const img = el('img');
      img.src = encodeURI(s.thumb);
      img.alt = '';
      img.loading = 'lazy';
      b.append(img, el('span', null, s.name));
      b.onclick = () => {
        r.arene = s.id;
        change();
      };
      box.append(b);
    }
  }

  // Un reglage a fleches : `valeurs` dans l'ordre, `texte(v)` affiche.
  function pas(id, valeurs, cle, texte) {
    const box = $(id);
    const bouger = (d) => {
      const i = Math.max(0, valeurs.indexOf(r[cle]));
      r[cle] = valeurs[Math.min(valeurs.length - 1, Math.max(0, i + d))];
      change();
    };
    box.querySelector('.pv-moins').onclick = () => bouger(-1);
    box.querySelector('.pv-plus').onclick = () => bouger(1);
    return () => {
      const i = valeurs.indexOf(r[cle]);
      box.querySelector('output').textContent = texte(r[cle]);
      box.querySelector('.pv-moins').disabled = i <= 0;
      box.querySelector('.pv-plus').disabled = i >= valeurs.length - 1;
    };
  }
  const peindreManches = pas('prive-manches', MANCHES, 'manches', String);
  const peindreDuree = pas('prive-duree', DUREES, 'minutes', (v) => `${v} minutes`);

  for (const b of document.querySelectorAll('#prive-mode button')) {
    b.onclick = () => {
      r.par_equipe = Number(b.dataset.v);
      change();
    };
  }
  for (const b of document.querySelectorAll('.pv-bascule[data-cle]')) {
    b.onclick = () => {
      r[b.dataset.cle] = !r[b.dataset.cle];
      change();
    };
  }
  [0, 1].forEach((i) => {
    $(`prive-nom-${i}`).oninput = (e) => {
      r.noms[i] = e.target.value;
      garder(r);
    };
  });

  // Equipes : le groupe du joueur, chef en tete, reparti sur l'effectif ;
  // les places libres invitent (le panneau s'ouvre sur les amis).
  async function equipes() {
    const g = panneau.social.groupe;
    let membres;
    let chef;
    if (g) {
      chef = g.chef;
      membres = [...g.membres].sort((a, b) => (b.id === chef) - (a.id === chef));
    } else {
      const c = panneau.compte || (await moi()).compte;
      membres = [{ id: c?.id, pseudo: c ? c.pseudo || c.nom : 'Toi', avatar: c?.avatar || '' }];
      chef = membres[0].id;
    }
    const cap = r.par_equipe;
    const lots = [membres.slice(0, cap), membres.slice(cap, cap * 2)];
    lots.forEach((lot, i) => {
      const box = $(`prive-joueurs-${i}`);
      box.textContent = '';
      for (const m of lot) {
        const l = el('div', 'pv-joueur');
        l.append(el('span', 'pv-couronne', m.id === chef ? '♛' : ''), avatar(m), el('span', 'pv-pseudo', m.pseudo));
        box.append(l);
      }
      for (let k = lot.length; k < cap; k += 1) {
        const b = el('button', 'pv-joueur pv-ajout');
        b.type = 'button';
        b.append(el('span', 'pv-couronne'), el('span', 'pv-plus-rond', '+'), el('span', 'pv-pseudo', 'Ajouter un joueur'));
        b.title = 'Invite un ami dans ton groupe depuis le panneau : il te suivra dans le lobby.';
        b.onclick = () => {
          if (!panneau.ouvert) panneau.basculer();
        };
        box.append(b);
      }
    });
  }

  function peindre() {
    arenes();
    for (const b of document.querySelectorAll('#prive-mode button')) {
      b.classList.toggle('active', Number(b.dataset.v) === r.par_equipe);
    }
    peindreManches();
    peindreDuree();
    for (const b of document.querySelectorAll('.pv-bascule[data-cle]')) {
      b.classList.toggle('on', !!r[b.dataset.cle]);
      b.setAttribute('aria-pressed', String(!!r[b.dataset.cle]));
    }
    [0, 1].forEach((i) => {
      $(`prive-nom-${i}`).value = r.noms[i] || '';
    });
    equipes();
  }

  panneau.social.on('change', () => {
    if (!$('screen-prive').hidden) equipes();
  });

  $('btn-prive-back').onclick = () => {
    dire('');
    menu.show('modes');
  };
  $('btn-prive-creer').onclick = async () => {
    const m = await moi();
    if (!m.connecte && !m.multi_libre) {
      dire('Connecte-toi pour créer un lobby : clique sur ton profil, en haut à gauche.');
      return;
    }
    const stade = r.arene === 'aleatoire'
      ? STADIUMS[Math.floor(Math.random() * STADIUMS.length)]
      : STADIUMS.find((s) => s.id === r.arene) || STADIUMS[0];
    dire('Création du lobby…');
    creer({
      stade,
      dire,
      reglages: {
        par_equipe: r.par_equipe,
        manches: r.manches,
        minutes: r.minutes,
        boosts: r.boosts,
        demolitions: r.demolitions,
        reapparition: r.reapparition,
        noms: [0, 1].map((i) => r.noms[i]?.trim() || NOMS[i]),
      },
    });
  };

  return {
    dire,
    ouvrir() {
      r = lire();
      dire('');
      peindre();
      menu.show('prive');
    },
  };
}
