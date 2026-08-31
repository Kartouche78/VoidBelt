/* ============================================================
   VOIDBELT — ARBRE DE COMPETENCES
   ------------------------------------------------------------
   Regle du jeu :
   - on demarre avec MAX_PTS niveaux (20), le noyau du bas est
     deja actif et ne coute rien ;
   - 1 niveau = 1 palier debloque ;
   - un palier n'est debloquable que s'il touche un palier deja
     actif — donc chaque deblocage ouvre un ou plusieurs choix ;
   - un palier actif porte un halo orange sur son contour ;
   - on peut rembourser un palier terminal (clic droit) tant
     qu'il ne coupe personne de la racine.
   ============================================================ */
(function(){
'use strict';

var MAX_PTS = 20;
var SAVE = 'voidbelt.skilltree.v1';

/* ---------- glyphes ---------- */
var G = {
  core  : 'M-18 10 L0 -18 L18 10 L0 20 Z',
  drill : 'M-16 15 L0 -17 L16 15 M-10 5 H10 M0 -17 V20',
  pick  : 'M-17 12 L-4 -16 L8 -5 L18 -18 M-3 -3 L14 14',
  grid  : 'M-16 0 H16 M0 -16 V16 M-11 -11 L11 11 M11 -11 L-11 11',
  stack : 'M-15 -8 H15 M-12 0 H12 M-8 8 H8',
  gate  : 'M-14 -10 H14 V10 H-14 Z M-7 -16 V16 M7 -16 V16',
  ship  : 'M-16 -11 L16 0 L-16 11 Z',
  shield: 'M0 -16 L13 -5 L8 13 L-8 13 L-13 -5 Z',
  beam  : 'M-17 0 H17 M8 -10 L17 0 L8 10',
  wave  : 'M-14 8 Q0 -16 14 8 Q0 18 -14 8 Z',
  arrow : 'M-15 10 L0 -14 L15 10 M-10 10 H10',
  cross : 'M-12 12 L12 -12 M-12 -12 L12 12',
  ring  : 'M0 -15 A15 15 0 1 1 -0.01 -15 M-9 0 H9',
  plus  : 'M0 -15 A15 15 0 1 1 -0.01 -15 M-9 0 H9 M0 -9 V9',
  star  : 'M0 -17 L5 -5 L17 -5 L7 3 L11 16 L0 8 L-11 16 L-7 3 L-17 -5 L-5 -5 Z',
  dome  : 'M-14 8 Q0 -12 14 8 M-10 11 H10'
};

/* ---------- la matrice : racine en bas, 20 paliers au-dessus ---------- */
var NODES = [
  { id:'core', x:800, y:835, r:58, g:G.core, root:true, tier:0,
    n:'Noyau de colonie', d:"Le point d'ancrage du secteur 07. Actif dès l'arrivée : toute la matrice se déploie à partir de lui." },

  { id:'n01', x:800, y:700, r:40, g:G.drill, tier:1,
    n:'Forage primaire', d:"Débloque la tête de forage de base. Extraction de minerai brut sur astéroïde de classe C." },

  { id:'n02', x:600, y:600, r:36, g:G.pick, tier:2,
    n:'Branche : Extraction', d:"Ouvre la voie industrielle. +25% de rendement sur toute récolte manuelle." },
  { id:'n03', x:1000, y:600, r:36, g:G.ship, tier:2,
    n:'Branche : Propulsion', d:"Ouvre la voie mobile. Débloque le châssis léger et la poussée vectorielle." },

  { id:'n04', x:800, y:500, r:38, g:G.grid, tier:3,
    n:'Réseau logistique', d:"Relie les deux branches. Les ressources circulent entre tous les modules actifs sans transport manuel." },

  { id:'n05', x:395, y:530, r:34, g:G.stack, tier:3,
    n:'Silo orbital', d:"+400 de capacité de stockage. Les surplus ne sont plus perdus à la fin d'un cycle." },
  { id:'n06', x:1205, y:530, r:34, g:G.beam, tier:3,
    n:'Canon de proue', d:"Arme la coque. Tir cinétique court, refroidissement passif entre deux salves." },

  { id:'n07', x:225, y:665, r:32, g:G.gate, tier:4,
    n:'Chaîne d’assemblage', d:"Automatise la transformation minerai vers lingot. Fonctionne hors connexion du joueur." },
  { id:'n08', x:1375, y:665, r:32, g:G.dome, tier:4,
    n:'Bouclier de coque', d:"Absorbe le premier impact de chaque engagement. Recharge après 20 s hors combat." },

  { id:'n09', x:415, y:355, r:34, g:G.pick, tier:5,
    n:'Foreuse à plasma', d:"Perce les astéroïdes de classe A. Débloque les métaux rares du cœur de la ceinture." },
  { id:'n10', x:1185, y:355, r:34, g:G.beam, tier:5,
    n:'Batterie longue portée', d:"Double la portée utile. Verrouillage de cible conservé à travers les débris." },

  { id:'n11', x:610, y:365, r:33, g:G.arrow, tier:4,
    n:'Convoyeur suspendu', d:"Transport aérien entre modules. Supprime les temps morts de la chaîne industrielle." },
  { id:'n12', x:990, y:365, r:33, g:G.wave, tier:4,
    n:'Distorsion de sillage', d:"Le sillage brouille les capteurs ennemis pendant 4 s après un boost." },

  { id:'n13', x:800, y:360, r:35, g:G.ring, tier:4,
    n:'Coeur de fusion', d:"Alimente toute la colonie. Prérequis de tous les paliers de rang supérieur." },

  { id:'n14', x:250, y:205, r:32, g:G.stack, tier:6,
    n:'Raffinerie profonde', d:"Raffinage à trois passes : +60% de pureté, sous-produits récupérés automatiquement." },
  { id:'n15', x:535, y:175, r:32, g:G.gate, tier:6,
    n:'Drones autonomes', d:"Trois drones minent et rapatrient seuls pendant votre absence." },

  { id:'n16', x:1350, y:205, r:32, g:G.shield, tier:6,
    n:'Blindage réactif', d:"Le blindage durcit sous le feu : -35% de dégâts après trois impacts consécutifs." },
  { id:'n17', x:1065, y:175, r:32, g:G.cross, tier:6,
    n:'Verrou de combat', d:"Marque une cible. Tous vos alliés du secteur voient sa trajectoire prédite." },

  { id:'n18', x:665, y:110, r:33, g:G.plus, tier:7,
    n:'Terraformation', d:"Rend un astéroïde habitable. Ouvre la colonisation permanente et les revenus passifs." },
  { id:'n19', x:935, y:110, r:33, g:G.wave, tier:7,
    n:'Saut de ceinture', d:"Saut court entre deux secteurs. Repositionnement offensif ou fuite immédiate." },

  { id:'n20', x:800, y:58, r:40, g:G.star, tier:8,
    n:'Souveraineté du vide', d:"Palier ultime. Le secteur 07 passe sous votre bannière : taxes, chantier orbital et balise de guerre." }
];

/* liaisons (l'ordre n'a pas d'importance : le graphe est non oriente) */
var EDGES = [
  ['core','n01'],
  ['n01','n02'], ['n01','n03'],
  ['n02','n04'], ['n03','n04'],
  ['n02','n05'], ['n03','n06'],
  ['n05','n07'], ['n06','n08'],
  ['n05','n09'], ['n06','n10'],
  ['n02','n11'], ['n04','n11'],
  ['n03','n12'], ['n04','n12'],
  ['n04','n13'],
  ['n09','n14'], ['n10','n16'],
  ['n09','n15'], ['n11','n15'],
  ['n10','n17'], ['n12','n17'],
  ['n13','n18'], ['n15','n18'],
  ['n13','n19'], ['n17','n19'],
  ['n18','n20'], ['n19','n20']
];

/* arcs decoratifs de fond */
var ARCS = [
  ['arc',  'M140 800 A700 700 0 0 1 1460 800'],
  ['arc',  'M220 800 A620 620 0 0 1 1380 800'],
  ['arc2', 'M300 800 A540 540 0 0 1 1300 800'],
  ['arc2', 'M390 800 A450 450 0 0 1 1210 800']
];

/* ---------- index ---------- */
var byId = {}, adj = {};
NODES.forEach(function(n){ byId[n.id] = n; adj[n.id] = []; });
EDGES.forEach(function(e){ adj[e[0]].push(e[1]); adj[e[1]].push(e[0]); });

var ROOT = 'core';
var unlocked = { core:true };
var selected = null;
var els = {};

/* ---------- helpers ---------- */
var NS = 'http://www.w3.org/2000/svg';
function mk(tag, attrs){
  var e = document.createElementNS(NS, tag);
  for (var k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}
function $(id){ return document.getElementById(id); }

function isUnlocked(id){ return !!unlocked[id]; }
function spent(){ var c = 0; for (var k in unlocked) if (k !== ROOT) c++; return c; }
function points(){ return MAX_PTS - spent(); }

/* un palier est atteignable s'il touche un palier deja actif */
function reachable(id){
  if (isUnlocked(id)) return false;
  return adj[id].some(isUnlocked);
}

/* on ne peut rembourser un palier que si tous les autres paliers
   actifs restent relies a la racine sans lui */
function refundable(id){
  if (id === ROOT || !isUnlocked(id)) return false;
  var seen = {}, stack = [ROOT], count = 0;
  seen[ROOT] = true;
  while (stack.length){
    var cur = stack.pop(); count++;
    adj[cur].forEach(function(nb){
      if (!seen[nb] && isUnlocked(nb) && nb !== id){ seen[nb] = true; stack.push(nb); }
    });
  }
  return count === spent(); /* racine + (actifs - id) */
}

/* ---------- construction du SVG ---------- */
function build(){
  var gArcs = $('arcs'), gLinks = $('links'), gNodes = $('nodes');

  ARCS.forEach(function(a){ gArcs.appendChild(mk('path', { 'class':a[0], d:a[1] })); });

  EDGES.forEach(function(e){
    var a = byId[e[0]], b = byId[e[1]];
    var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    /* legere courbure pour l'esthetique "constellation" */
    var bow = (a.x === b.x) ? 0 : (b.y - a.y) * 0.14;
    var p = mk('path', {
      'class':'link',
      d:'M' + a.x + ' ' + a.y + ' Q' + (mx + bow) + ' ' + my + ' ' + b.x + ' ' + b.y
    });
    p.dataset.a = e[0]; p.dataset.b = e[1];
    gLinks.appendChild(p);
  });

  NODES.forEach(function(n){
    var g = mk('g', { 'class':'node' + (n.root ? ' root' : ''), transform:'translate(' + n.x + ' ' + n.y + ')' });
    g.dataset.id = n.id;
    if (!n.root){ g.setAttribute('tabindex', '0'); g.setAttribute('role', 'button'); }
    g.setAttribute('aria-label', n.n);

    var s = n.r, h = s / 2;
    if (n.root){
      g.appendChild(mk('circle', { 'class':'halo', r:s / 2 + 16 }));
      g.appendChild(mk('circle', { 'class':'plate', r:s / 2 + 4 }));
    } else {
      g.appendChild(mk('rect', { 'class':'halo', x:-h - 9, y:-h - 9, width:s + 18, height:s + 18, rx:h / 2 + 9 }));
      g.appendChild(mk('rect', { 'class':'plate', x:-h, y:-h, width:s, height:s, rx:h / 3 }));
    }
    g.appendChild(mk('path', { 'class':'glyph', d:n.g }));
    if (!n.root){
      var c = mk('text', { 'class':'cost', x:0, y:h + 20 });
      c.textContent = '1 NIV.';
      g.appendChild(c);
    }

    g.addEventListener('click', function(){ tryUnlock(n.id); });
    g.addEventListener('contextmenu', function(ev){ ev.preventDefault(); tryRefund(n.id); });
    g.addEventListener('mouseenter', function(){ describe(n.id); });
    g.addEventListener('focus', function(){ describe(n.id); });
    g.addEventListener('keydown', function(ev){
      if (ev.key === 'Enter' || ev.key === ' '){ ev.preventDefault(); tryUnlock(n.id); }
      if (ev.key === 'Backspace' || ev.key === 'Delete'){ ev.preventDefault(); tryRefund(n.id); }
    });

    gNodes.appendChild(g);
    els[n.id] = g;
  });
}

/* ---------- actions ---------- */
function tryUnlock(id){
  if (isUnlocked(id)){ describe(id); return; }
  if (!reachable(id) || points() <= 0){ describe(id); return; }
  unlocked[id] = true;
  els[id].classList.add('just');
  setTimeout(function(){ if (els[id]) els[id].classList.remove('just'); }, 700);
  save(); render(); describe(id);
}

function tryRefund(id){
  if (!refundable(id)) return;
  delete unlocked[id];
  save(); render(); describe(id);
}

function reset(){
  unlocked = {}; unlocked[ROOT] = true;
  save(); render(); describe(ROOT);
}

/* ---------- rendu ---------- */
function render(){
  var pts = points(), sp = spent();

  NODES.forEach(function(n){
    var g = els[n.id], on = isUnlocked(n.id), rch = reachable(n.id);
    g.classList.toggle('on', on);
    g.classList.toggle('reachable', rch);
    g.classList.toggle('broke', rch && pts <= 0);
    g.setAttribute('aria-pressed', on ? 'true' : 'false');
  });

  Array.prototype.forEach.call(document.querySelectorAll('.link'), function(p){
    var a = isUnlocked(p.dataset.a), b = isUnlocked(p.dataset.b);
    p.classList.toggle('on', a && b);
    p.classList.toggle('reachable', (a !== b) && pts > 0);
  });

  $('pts').textContent = pts;
  $('pts-max').textContent = MAX_PTS;
  $('unl').textContent = sp < 10 ? '0' + sp : sp;
  $('f-unl').textContent = sp < 10 ? '0' + sp : sp;
  $('gauge-fill').style.width = (sp / MAX_PTS * 100) + '%';
  $('gauge').setAttribute('aria-valuenow', sp);
}

function describe(id){
  var n = byId[id];
  if (selected && els[selected]) els[selected].classList.remove('sel');
  selected = id; els[id].classList.add('sel');

  var on = isUnlocked(id), rch = reachable(id), pts = points();
  var state, cls, req;

  if (n.root){
    state = 'ANCRAGE'; cls = '';
    req = 'Point de départ · <b>aucun coût</b>';
  } else if (on){
    state = 'ACTIF'; cls = '';
    req = refundable(id)
      ? 'Clic droit pour rembourser <b>1 niveau</b>'
      : 'Verrouillé : d’autres paliers en dépendent';
  } else if (rch && pts > 0){
    state = 'DISPONIBLE'; cls = 'ready';
    req = 'Coût <b>1 niveau</b> · ' + pts + ' restant' + (pts > 1 ? 's' : '');
  } else if (rch){
    state = 'SANS NIVEAU'; cls = 'locked';
    req = 'Plus aucun niveau disponible';
  } else {
    state = 'VERROUILLÉ'; cls = 'locked';
    var names = adj[id].map(function(k){ return byId[k].n; }).join(' · ');
    req = 'Requiert un palier voisin actif : ' + names;
  }

  $('i-tier').textContent = 'PALIER ' + (n.tier < 10 ? '0' + n.tier : n.tier);
  var st = $('i-state'); st.textContent = state; st.className = 'i-state ' + cls;
  $('i-name').textContent = n.n;
  $('i-desc').textContent = n.d;
  $('i-req').innerHTML = req;
}

/* ---------- sauvegarde ---------- */
function save(){
  try { localStorage.setItem(SAVE, JSON.stringify(Object.keys(unlocked))); } catch (e) {}
}
function load(){
  try {
    var raw = localStorage.getItem(SAVE);
    if (!raw) return;
    var list = JSON.parse(raw);
    if (!Array.isArray(list)) return;
    /* on rejoue la sauvegarde en respectant les regles : un palier
       n'est retenu que s'il touche quelque chose de deja actif */
    var pool = list.filter(function(id){ return byId[id] && id !== ROOT; });
    var moved = true;
    while (moved && spent() < MAX_PTS){
      moved = false;
      for (var i = 0; i < pool.length; i++){
        var id = pool[i];
        if (!isUnlocked(id) && reachable(id)){ unlocked[id] = true; moved = true; }
      }
    }
  } catch (e) {}
}

/* ---------- demarrage ---------- */
build();
load();
render();
describe(ROOT);

$('reset').addEventListener('click', reset);

document.addEventListener('keydown', function(ev){
  if (ev.key === 'Escape') describe(ROOT);
});

})();
