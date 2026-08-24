(function(){
"use strict";

/* bande-son de l'arene : KO.mp3, en boucle tant que la page est ouverte */
var Music = Track("ko", "voidbelt.volume", 30);

/* ============================================================
   L'ARENE — un vaisseau a inertie (ZQSD ou fleches, tir a
   l'espace ou souris capturee), des asteroides qui tombent de
   plus en plus vite, des ressources a ramasser, un choix de
   carte a chaque niveau, un atelier (clic droit) et un boss
   tous les cinq niveaux.
   ============================================================ */

var Arena = (function(){
  var cvs = document.getElementById("gamebg");
  var ctx = cvs.getContext("2d");
  var DPR = Math.min(window.devicePixelRatio || 1, 2);
  var W = 0, H = 0, S = 1, FLOOR = 0;

  var active = false, drawn = false, last = 0, paused = false, over = false;
  var stars = [], rocks = [], bolts = [], bits = [], drops = [], foes = [], boss = null;
  var keys = {}, shake = 0, flash = 0;
  /* pilotage souris : le pointeur est capture par la page, ses deplacements
     poussent une cible virtuelle que le vaisseau suit. kbd repasse au
     clavier pour qui prefere, et leve alors l'attente du verrou. */
  var locked = false, kbd = false, aim = { x: 0, y: 0 };
  /* le tactile et les navigateurs anciens ignorent le verrou : la partie
     ne doit alors pas rester en attente derriere l'invite de clic. */
  var CAN_LOCK = !!(window.Element && Element.prototype.requestPointerLock);

  var ship, hull = 0, shield = 0, shieldT = 0, stats = null;
  var shipModel = 0, owned = { 0: true };
  var cards = {}, shopLv = {};
  var res = [0, 0, 0, 0];
  var level = 1, xp = 0, xpMax = 7, spawnT = 0, fireT = 0, bossAt = 5;

  var RES = ["255,77,0", "95,235,247", "237,231,218", "255,198,107"];

  function rand(a, b){ return a + Math.random() * (b - a); }
  function clamp(v, a, b){ return v < a ? a : (v > b ? b : v); }
  function el(id){ return document.getElementById(id); }

  /* ---------------- definitions ---------------- */

  var SHIPS = [
    { n: "CHASSEUR",     hull: 0,  spd: 0,   dmg: 0, delay: 1,   shots: 0, c: null },
    { n: "INTERCEPTEUR", hull: 25, spd: 70,  dmg: 3, delay: .88, shots: 0, c: [[0, 45], [1, 30]] },
    { n: "CUIRASSE",     hull: 80, spd: -15, dmg: 9, delay: .96, shots: 1, c: [[0, 95], [3, 35]] }
  ];

  var CARDS = [
    { k: "dmg",    n: "CANON LOURD",     d: "+25% de dégâts",           i: "warhead" },
    { k: "rate",   n: "SURALIMENTATION", d: "-15% de délai de tir",       i: "cadence" },
    { k: "spd",    n: "PROPULSEURS",     d: "+12% de vitesse",                 i: "thruster" },
    { k: "hull",   n: "BLINDAGE",        d: "+20 de coque",                    i: "hull" },
    { k: "salvo",  n: "SALVE",           d: "+1 projectile",                   i: "triple" },
    { k: "bspd",   n: "ACCÉLÉRATEUR",  d: "+18% de vitesse de tir",  i: "pierce" },
    { k: "magnet", n: "AIMANT",          d: "+40% de rayon de collecte",       i: "magnet" },
    { k: "fix",    n: "RÉPARATION",  d: "coque au maximum",               i: "repair" }
  ];

  var TABS = [
    { id: "coque",    n: "COQUE" },
    { id: "missiles", n: "MISSILES" },
    { id: "moteur",   n: "MOTEUR" },
    { id: "flotte",   n: "FLOTTE" }
  ];

  var ITEMS = {
    coque: [
      { id: "hull",   n: "RENFORT",     d: "+30 de coque maximum",      i: "hull",   max: 5,  c: [[2, 12], [0, 14]] },
      { id: "plate",  n: "PLAQUAGE",    d: "-12% de dégâts subis", i: "plate", max: 4, c: [[0, 20], [3, 6]] },
      { id: "shield", n: "BOUCLIER",    d: "+1 charge qui se recharge", i: "shield", max: 3,  c: [[1, 24], [3, 10]] },
      { id: "repair", n: "RÉPARATION", d: "coque au maximum",      i: "repair", max: 99, c: [[2, 9]] }
    ],
    missiles: [
      { id: "warhead", n: "OGIVE",       n2: "+30% de dégâts",   d: "+30% de dégâts",        i: "warhead", max: 5, c: [[0, 16], [3, 4]] },
      { id: "cadence", n: "CADENCE",     d: "-12% de délai de tir",   i: "cadence", max: 5, c: [[1, 15], [2, 8]] },
      { id: "triple",  n: "SALVE",       d: "+1 projectile",               i: "triple",  max: 3, c: [[0, 34], [1, 22]] },
      { id: "pierce",  n: "PERFORANT",   d: "traverse un astéroïde de plus", i: "pierce", max: 3, c: [[3, 14], [0, 26]] }
    ],
    moteur: [
      { id: "thruster", n: "POUSSÉE", d: "+10% de vitesse",          i: "thruster", max: 5, c: [[1, 12], [2, 10]] },
      { id: "boost",    n: "INJECTION",   d: "+18% d'accélération", i: "boost",  max: 4, c: [[1, 18], [0, 12]] },
      { id: "brake",    n: "STABILISEUR", d: "freine plus vite",          i: "brake",    max: 3, c: [[2, 16]] },
      { id: "magnet",   n: "COLLECTEUR",  d: "+50% de rayon de collecte", i: "magnet",   max: 4, c: [[2, 14], [1, 10]] }
    ],
    flotte: []
  };

  /* ---------------- icones ---------------- */

  var ICON = {
    hull:     '<path d="M12 3l7 4v10l-7 4-7-4V7z"/>',
    plate:    '<path d="M12 3l7 4v10l-7 4-7-4V7z"/><path d="M12 7l3.5 2v6l-3.5 2-3.5-2V9z"/>',
    shield:   '<path d="M12 3l7 3v6c0 4-3 6.5-7 9-4-2.5-7-5-7-9V6z"/>',
    repair:   '<path d="M12 5v14M5 12h14"/>',
    warhead:  '<path d="M12 3l4 7v8H8v-8z"/><path d="M8 18l-2 3M16 18l2 3"/>',
    cadence:  '<path d="M6 20V9M12 20V5M18 20v-8"/>',
    triple:   '<path d="M12 4l3 6h-6z"/><path d="M6 10l2.5 5h-5z"/><path d="M18 10l2.5 5h-5z"/>',
    pierce:   '<path d="M12 21V5"/><path d="M8 9l4-5 4 5"/><path d="M5 14h14"/>',
    thruster: '<path d="M12 4l4 8h-8z"/><path d="M9 15l3 5 3-5"/>',
    boost:    '<path d="M5 13l7-8 7 8"/><path d="M5 19l7-8 7 8"/>',
    brake:    '<circle cx="12" cy="12" r="7"/><path d="M12 5v14"/>',
    magnet:   '<path d="M7 4v9a5 5 0 0 0 10 0V4"/><path d="M4 4h6M14 4h6"/>',
    ship0:    '<path d="M12 3l5 12-5 3-5-3z"/><path d="M7 15l-3 4M17 15l3 4"/>',
    ship1:    '<path d="M12 3l4 10-4 4-4-4z"/><path d="M8 8L3 17l5-2M16 8l5 9-5-2"/>',
    ship2:    '<path d="M12 3l6 8v7H6v-7z"/><path d="M6 11H2v5h4M18 11h4v5h-4"/>'
  };

  function svg(kind){
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
           'stroke-linecap="square" stroke-linejoin="miter">' + (ICON[kind] || ICON.hull) + '</svg>';
  }

  /* ---------------- statistiques ---------------- */

  function lv(id){ return shopLv[id] || 0; }
  function cd(k){ return cards[k] || 0; }

  function recompute(){
    var m = SHIPS[shipModel];
    var s = {
      hullMax: 110 + m.hull + 20 * cd("hull") + 30 * lv("hull"),
      spd:  (340 + m.spd) * (1 + .12 * cd("spd")) * (1 + .10 * lv("thruster")),
      acc:  1750 * (1 + .18 * lv("boost")),
      damp: 1.9 + .55 * lv("brake"),
      dmg:  (10 + m.dmg) * (1 + .25 * cd("dmg")) * (1 + .30 * lv("warhead")),
      delay: .30 * m.delay * Math.pow(.85, cd("rate")) * Math.pow(.88, lv("cadence")),
      bspd: 660 * (1 + .18 * cd("bspd")),
      shots: 1 + m.shots + cd("salvo") + lv("triple"),
      pierce: lv("pierce"),
      armor: Math.min(.6, .12 * lv("plate")),
      magnet: 195 * (1 + .4 * cd("magnet")) * (1 + .5 * lv("magnet")),
      shieldMax: lv("shield")
    };
    stats = s;
    if (hull > s.hullMax) hull = s.hullMax;
    if (shield > s.shieldMax) shield = s.shieldMax;
  }

  /* ---------------- cycle de partie ---------------- */

  function reset(){
    shipModel = 0; owned = { 0: true };
    cards = {}; shopLv = {};
    res = [0, 0, 0, 0];
    level = 1; xp = 0; xpMax = 7; bossAt = 5;
    rocks = []; bolts = []; bits = []; drops = []; foes = []; boss = null;
    recompute();
    hull = stats.hullMax; shield = stats.shieldMax; shieldT = 0;
    ship = { x: W * .5, y: FLOOR - 90 * S, vx: 0, vy: 0, tilt: 0, inv: 0 };
    over = false; paused = false; spawnT = .6; fireT = 0; shake = 0; flash = 0;
    aim.x = ship.x; aim.y = ship.y;
    closeAll();
    hud();
    if (active) requestLock();
    lockCue();
  }

  function starfield(){
    stars = [];
    var n = Math.round((W * H) / 5200);
    for (var i = 0; i < n; i++){
      stars.push({ x: rand(0, W), y: rand(0, H), z: rand(.25, 1), s: rand(.6, 2.1) });
    }
  }

  function resize(){
    W = cvs.clientWidth; H = cvs.clientHeight;
    cvs.width = Math.round(W * DPR); cvs.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    S = Math.max(.65, Math.min(1.35, Math.min(W / 1500, H / 860)));
    var f = document.querySelector(".footer"), st = document.querySelector(".stripes");
    FLOOR = H - ((f ? f.offsetHeight : 40) + (st ? st.offsetHeight : 16)) - 10;
    starfield();
    if (!ship) reset(); else {
      ship.x = clamp(ship.x, 30 * S, W - 30 * S);
      ship.y = clamp(ship.y, 90 * S, FLOOR - 20 * S);
      aim.x = clamp(aim.x, 26 * S, W - 26 * S);
      aim.y = clamp(aim.y, 92 * S, FLOOR - 18 * S);
    }
    drawn = false;
  }

  /* ---------------- entites ---------------- */

  function rockShape(r){
    var pts = [], n = Math.floor(rand(7, 11)), i, a;
    for (i = 0; i < n; i++){
      a = (i / n) * Math.PI * 2;
      pts.push([Math.cos(a) * r * rand(.66, 1.16), Math.sin(a) * r * rand(.66, 1.16)]);
    }
    return pts;
  }

  function diff(){ return 1 + (level - 1) * .15; }

  function spawnRock(tier){
    var r = [15, 24, 36][tier] * S;
    rocks.push({
      x: rand(r, W - r), y: -r - 10,
      vx: rand(-40, 40) * S, vy: (52 + rand(0, 46)) * diff() * S,
      r: r, tier: tier, hp: [12, 30, 62][tier] * (1 + (level - 1) * .16),
      rot: rand(0, 6.28), spin: rand(-1.4, 1.4), hit: 0,
      pts: rockShape(r)
    });
  }

  function splitRock(rk){
    if (rk.tier === 0) return;
    for (var i = 0; i < 2; i++){
      var r = [15, 24, 36][rk.tier - 1] * S;
      rocks.push({
        x: rk.x + rand(-10, 10), y: rk.y + rand(-8, 8),
        vx: rand(-90, 90) * S, vy: (rk.vy * .85) + rand(0, 30) * S,
        r: r, tier: rk.tier - 1, hp: [12, 30, 62][rk.tier - 1] * (1 + (level - 1) * .16),
        rot: rand(0, 6.28), spin: rand(-2, 2), hit: 0,
        pts: rockShape(r)
      });
    }
  }

  function burst(x, y, n, rgb, sp){
    for (var i = 0; i < n; i++){
      var a = rand(0, 6.28), v = rand(.3, 1) * sp;
      bits.push({ x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
                  r: rand(1.4, 3.4) * S, life: 1, fade: rand(.9, 1.7), c: rgb });
    }
  }

  function dropRes(x, y, k, n){
    for (var i = 0; i < n; i++){
      drops.push({ x: x + rand(-12, 12), y: y + rand(-12, 12),
                   vx: rand(-30, 30) * S, vy: rand(20, 70) * S, k: k, r: 7 * S, life: 20 });
    }
  }

  function killRock(rk, i){
    rocks.splice(i, 1);
    burst(rk.x, rk.y, 8 + rk.tier * 5, "237,231,218", 190 * S);
    splitRock(rk);
    addXp(3 + rk.tier * 4);
    /* une part des asteroides livre de la matiere */
    var luck = .52 + .05 * lv("magnet");
    if (Math.random() < luck){
      var k = Math.random() < .12 ? 3 : Math.floor(rand(0, 3));
      dropRes(rk.x, rk.y, k, 1 + Math.floor(rand(0, 1 + rk.tier)));
    }
  }

  /* ---------------- niveaux, cartes, atelier ---------------- */

  function addXp(n){
    xp += n;
    while (xp >= xpMax){
      xp -= xpMax; level++;
      xpMax = Math.round(xpMax * 1.28 + 5);
      if (level >= bossAt && !boss){ bossAt += 5; spawnBoss(); }
      openCards();
    }
    hud();
  }

  function hud(){
    var e;
    if ((e = el("a-lvl"))) e.textContent = level < 10 ? "0" + level : "" + level;
    if ((e = el("a-xp")))  e.style.width = Math.round((xp / xpMax) * 100) + "%";
    if ((e = el("a-hull"))) e.style.width = Math.round(clamp(hull / stats.hullMax, 0, 1) * 100) + "%";
    if ((e = el("a-shield"))) e.textContent = shield > 0 ? shield : "";
    for (var i = 0; i < 4; i++){ if ((e = el("r" + i))) e.textContent = res[i]; }
    var m = el("a-resmini");
    if (m){
      var h = "";
      for (i = 0; i < 4; i++) h += '<span style="--c:rgb(' + RES[i] + ')"><i></i>' + res[i] + '</span>';
      m.innerHTML = h;
    }
  }

  function closeAll(){
    var a = el("a-cards"), b = el("a-shop"), c = el("a-over");
    if (a) a.hidden = true;
    if (b) b.hidden = true;
    if (c) c.hidden = true;
  }

  function openCards(){
    var pool = CARDS.slice(), pick = [], i;
    for (i = 0; i < 4 && pool.length; i++) pick.push(pool.splice(Math.floor(rand(0, pool.length)), 1)[0]);
    var row = el("a-cardrow");
    if (!row) return;
    var h = "";
    for (i = 0; i < pick.length; i++){
      h += '<button class="gcard" data-k="' + pick[i].k + '">' +
             '<span class="gcard-i">' + svg(pick[i].i) + '</span>' +
             '<b>' + pick[i].n + '</b>' +
             '<span class="gcard-d">' + pick[i].d + '</span>' +
             '<span class="gcard-key">' + (i + 1) + '</span>' +
           '</button>';
    }
    row.innerHTML = h;
    el("a-lvlnum").textContent = level < 10 ? "0" + level : "" + level;
    el("a-cards").hidden = false;
    paused = true;
    /* une fenetre s'ouvre : la souris redevient un curseur ordinaire */
    releaseLock(); lockCue();
  }

  function takeCard(k){
    if (k === "fix"){ recompute(); hull = stats.hullMax; }
    else { cards[k] = cd(k) + 1; recompute(); if (k === "hull") hull += 20; }
    el("a-cards").hidden = true;
    paused = !!(el("a-shop") && !el("a-shop").hidden);
    hud();
    /* on reprend le verrou dans la foulee du clic : le geste est encore
       valide aux yeux du navigateur. */
    if (!modalOpen()) requestLock();
    lockCue();
  }

  function cost(it){
    var n = lv(it.id), out = [], i;
    for (i = 0; i < it.c.length; i++) out.push([it.c[i][0], Math.round(it.c[i][1] * Math.pow(1.65, n))]);
    return out;
  }

  function affordable(c){
    for (var i = 0; i < c.length; i++) if (res[c[i][0]] < c[i][1]) return false;
    return true;
  }

  function fleet(){
    var out = [], i;
    for (i = 1; i < SHIPS.length; i++){
      out.push({ id: "ship" + i, n: SHIPS[i].n, d: "+" + SHIPS[i].hull + " coque, +" + SHIPS[i].dmg + " dégâts",
                 i: "ship" + i, max: 1, c: SHIPS[i].c, sh: i });
    }
    return out;
  }

  var tab = "coque", hoverId = null;

  function shopList(){ return tab === "flotte" ? fleet() : ITEMS[tab]; }

  function paintShop(){
    var list = shopList(), h = "", i, it, n, c;
    for (i = 0; i < list.length; i++){
      it = list[i];
      n = it.sh ? (owned[it.sh] ? 1 : 0) : lv(it.id);
      c = it.sh && owned[it.sh] ? [] : cost(it);
      var full = n >= it.max, ok = full || affordable(c);
      h += '<button class="gitem' + (full ? " full" : "") + (ok ? "" : " poor") +
              (it.sh && shipModel === it.sh ? " on" : "") + '" data-i="' + i + '">' +
             '<span class="gitem-i">' + svg(it.i) + '</span>' +
             '<span class="gitem-n">' + it.n + '</span>' +
             '<span class="gitem-lv">' + (it.max > 9 ? "" : n + "/" + it.max) + '</span>' +
           '</button>';
    }
    el("a-items").innerHTML = h;
    var t = "";
    for (i = 0; i < TABS.length; i++)
      t += '<button class="gtab' + (TABS[i].id === tab ? " on" : "") + '" data-t="' + TABS[i].id + '">' + TABS[i].n + '</button>';
    el("a-tabs").innerHTML = t;
    detail(null);
    hud();
  }

  function detail(it){
    var d = el("a-detail");
    if (!d) return;
    if (!it){ d.innerHTML = '<span class="gnone"></span>'; return; }
    var n = it.sh ? (owned[it.sh] ? 1 : 0) : lv(it.id);
    var full = n >= it.max;
    var c = (it.sh && owned[it.sh]) ? [] : cost(it), i, h;
    h = '<span class="gdet-i">' + svg(it.i) + '</span>' +
        '<b>' + it.n + '</b>' +
        '<span class="gdet-d">' + it.d + '</span>';
    if (it.max <= 9) h += '<span class="gdet-lv">PALIER ' + n + " / " + it.max + '</span>';
    h += '<span class="gdet-c">';
    if (it.sh && owned[it.sh]) h += '<em>' + (shipModel === it.sh ? "EN SERVICE" : "CLIC : ÉQUIPER") + '</em>';
    else if (full) h += '<em>AU MAXIMUM</em>';
    else {
      for (i = 0; i < c.length; i++)
        h += '<span class="chip' + (res[c[i][0]] >= c[i][1] ? "" : " no") + '" style="--c:rgb(' + RES[c[i][0]] + ')"><i></i>' + c[i][1] + '</span>';
    }
    h += '</span>';
    d.innerHTML = h;
  }

  function buy(i){
    var list = shopList(), it = list[i];
    if (!it) return;
    if (it.sh){
      if (owned[it.sh]){ shipModel = it.sh; recompute(); paintShop(); return; }
      var c1 = cost(it);
      if (!affordable(c1)) { flashShop(); return; }
      pay(c1); owned[it.sh] = true; shipModel = it.sh; recompute(); paintShop(); return;
    }
    if (lv(it.id) >= it.max){ flashShop(); return; }
    var c = cost(it);
    if (!affordable(c)){ flashShop(); return; }
    pay(c);
    if (it.id === "repair"){ hull = stats.hullMax; }
    else { shopLv[it.id] = lv(it.id) + 1; recompute(); if (it.id === "hull") hull += 30; if (it.id === "shield") shield = stats.shieldMax; }
    paintShop();
    detail(shopList()[i]);
  }

  function pay(c){ for (var i = 0; i < c.length; i++) res[c[i][0]] -= c[i][1]; }

  function flashShop(){
    var p = el("a-shop");
    if (!p) return;
    p.classList.remove("nope"); void p.offsetWidth; p.classList.add("nope");
  }

  function toggleShop(){
    var p = el("a-shop");
    if (!p || over) return;
    if (p.hidden){
      p.hidden = false; paintShop(); paused = true;
      releaseLock();
    } else {
      p.hidden = true;
      var c = el("a-cards");
      paused = !!(c && !c.hidden);       /* on ne reste en pause que pour les cartes */
      if (!modalOpen()) requestLock();
    }
    lockCue();
  }

  /* ---------------- boss ---------------- */

  function spawnBoss(){
    var t = Math.floor(level / 5);
    boss = { x: W * .5, y: -140 * S, w: 150 * S, h: 74 * S,
             hp: 520 + t * 420, max: 520 + t * 420, dir: Math.random() < .5 ? -1 : 1,
             t: 0, fire: 1.4, hit: 0, tier: t };
    rocks.length = Math.min(rocks.length, 3);
  }

  function bossShoot(){
    var n = 3 + Math.min(4, boss.tier);
    for (var i = 0; i < n; i++){
      var a = Math.PI / 2 + (i - (n - 1) / 2) * .26 + rand(-.05, .05);
      var v = (230 + boss.tier * 26) * S;
      foes.push({ x: boss.x, y: boss.y + boss.h * .5, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: 6 * S });
    }
  }

  function killBoss(){
    burst(boss.x, boss.y, 90, "255,77,0", 420 * S);
    for (var i = 0; i < 4; i++) dropRes(boss.x + rand(-60, 60), boss.y + rand(-30, 30), i, 3 + boss.tier);
    shake = 1; flash = .7;
    addXp(xpMax * .8);
    boss = null;
  }

  /* ---------------- degats ---------------- */

  function hurt(n){
    if (ship.inv > 0 || over) return;
    if (shield > 0){ shield--; shieldT = 9; ship.inv = 1; hud(); burst(ship.x, ship.y, 16, "95,235,247", 250 * S); return; }
    hull -= n * (1 - stats.armor);
    ship.inv = 1.1; shake = Math.min(1, shake + .5); flash = .35;
    burst(ship.x, ship.y, 14, "255,77,0", 230 * S);
    if (hull <= 0){
      hull = 0; over = true; paused = true;
      burst(ship.x, ship.y, 70, "255,77,0", 380 * S);
      var o = el("a-over");
      if (o){ o.hidden = false; el("a-score").textContent = (level < 10 ? "0" : "") + level; }
      releaseLock(); lockCue();
    }
    hud();
  }

  /* ---------------- simulation ---------------- */

  function step(dt){
    var i, k, r, b, d, dx, dy;

    /* --- vaisseau : souris sous verrou, clavier a inertie sinon --- */
    var lim = stats.spd * S;
    if (locked){
      /* le vaisseau rattrape la cible poussee par le pointeur. La vitesse
         reste plafonnee : les modules de propulsion gardent leur interet. */
      var cap = lim * 4.5;
      ship.vx = clamp((aim.x - ship.x) * 22, -cap, cap);
      ship.vy = clamp((aim.y - ship.y) * 22, -cap, cap);
    } else {
      var ax = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
      var ay = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
      ship.vx += ax * stats.acc * S * dt;
      ship.vy += ay * stats.acc * .82 * S * dt;
      var damp = Math.exp(-stats.damp * dt);
      if (!ax) ship.vx *= damp;
      if (!ay) ship.vy *= damp;
      ship.vx = clamp(ship.vx, -lim, lim); ship.vy = clamp(ship.vy, -lim, lim);
    }
    ship.x += ship.vx * dt; ship.y += ship.vy * dt;
    /* sous verrou la cible est deja bornee : pas de rebond sur les bords */
    if (ship.x < 26 * S){ ship.x = 26 * S; if (!locked) ship.vx *= -.3; }
    if (ship.x > W - 26 * S){ ship.x = W - 26 * S; if (!locked) ship.vx *= -.3; }
    ship.y = clamp(ship.y, 92 * S, FLOOR - 18 * S);
    if (!locked && (ship.y <= 92 * S || ship.y >= FLOOR - 18 * S)) ship.vy *= .5;
    /* l'inclinaison suit la vitesse laterale, bornee pour rester lisible */
    ship.tilt += (clamp(ship.vx / lim, -1, 1) * .42 - ship.tilt) * Math.min(1, dt * 9);
    if (ship.inv > 0) ship.inv -= dt;

    /* --- tir automatique : il n'y a plus rien a maintenir --- */
    fireT -= dt;
    if (fireT <= 0){
      fireT = stats.delay;
      var n = stats.shots, drift = clamp(ship.vx, -lim, lim) * .25;
      for (i = 0; i < n; i++){
        var off = (i - (n - 1) / 2) * 11 * S;
        bolts.push({ x: ship.x + off, y: ship.y - 20 * S,
                     vx: drift + off * 1.1, vy: -stats.bspd * S,
                     r: 3.4 * S, dmg: stats.dmg, pierce: stats.pierce });
      }
    }

    /* --- asteroides --- */
    spawnT -= dt;
    if (spawnT <= 0 && !over){
      spawnT = Math.max(.22, (.95 - level * .035)) * (boss ? 2.2 : 1) * rand(.7, 1.3);
      spawnRock(Math.random() < .3 ? 2 : (Math.random() < .55 ? 1 : 0));
    }
    for (i = rocks.length - 1; i >= 0; i--){
      r = rocks[i];
      r.x += r.vx * dt; r.y += r.vy * dt; r.rot += r.spin * dt;
      if (r.hit > 0) r.hit -= dt * 4;
      if (r.x < r.r || r.x > W - r.r) r.vx *= -1;
      if (r.y > H + r.r * 2){ rocks.splice(i, 1); continue; }
      dx = r.x - ship.x; dy = r.y - ship.y;
      if (dx * dx + dy * dy < (r.r + 15 * S) * (r.r + 15 * S)){
        hurt(9 + r.tier * 9);
        killRock(r, i);
      }
    }

    /* --- projectiles --- */
    for (i = bolts.length - 1; i >= 0; i--){
      b = bolts[i];
      b.x += b.vx * dt; b.y += b.vy * dt;
      if (b.y < -20){ bolts.splice(i, 1); continue; }
      var gone = false;
      for (k = rocks.length - 1; k >= 0; k--){
        r = rocks[k];
        dx = r.x - b.x; dy = r.y - b.y;
        if (dx * dx + dy * dy < (r.r + b.r) * (r.r + b.r)){
          r.hp -= b.dmg; r.hit = 1;
          burst(b.x, b.y, 4, "255,198,107", 120 * S);
          if (r.hp <= 0) killRock(r, k);
          if (b.pierce > 0) b.pierce--; else { bolts.splice(i, 1); gone = true; }
          break;
        }
      }
      if (gone) continue;
      if (boss && Math.abs(b.x - boss.x) < boss.w * .5 && Math.abs(b.y - boss.y) < boss.h * .5){
        boss.hp -= b.dmg; boss.hit = 1;
        burst(b.x, b.y, 5, "255,77,0", 150 * S);
        bolts.splice(i, 1);
        if (boss.hp <= 0) killBoss();
      }
    }

    /* --- boss --- */
    if (boss){
      boss.t += dt;
      if (boss.y < 118 * S) boss.y += 70 * S * dt;
      else {
        boss.x += boss.dir * (58 + boss.tier * 16) * S * dt;
        if (boss.x < boss.w * .55){ boss.x = boss.w * .55; boss.dir = 1; }
        if (boss.x > W - boss.w * .55){ boss.x = W - boss.w * .55; boss.dir = -1; }
        boss.fire -= dt;
        if (boss.fire <= 0){ boss.fire = Math.max(.5, 1.5 - boss.tier * .16); bossShoot(); }
      }
      if (boss.hit > 0) boss.hit -= dt * 4;
    }

    for (i = foes.length - 1; i >= 0; i--){
      var f = foes[i];
      f.x += f.vx * dt; f.y += f.vy * dt;
      if (f.y > H + 20 || f.x < -20 || f.x > W + 20){ foes.splice(i, 1); continue; }
      dx = f.x - ship.x; dy = f.y - ship.y;
      if (dx * dx + dy * dy < (f.r + 13 * S) * (f.r + 13 * S)){
        foes.splice(i, 1); hurt(11 + (boss ? boss.tier * 3 : 0));
      }
    }

    /* --- ressources ---
       Dans le rayon, le minerai ne derive plus : il file droit sur la coque
       et la rejoint en une fraction de seconde. Hors rayon, il retombe. */
    for (i = drops.length - 1; i >= 0; i--){
      d = drops[i];
      d.life -= dt;
      dx = ship.x - d.x; dy = ship.y - d.y;
      var dd = Math.sqrt(dx * dx + dy * dy) || 1;
      if (dd < stats.magnet * S){
        var grab = 1 - Math.exp(-13 * dt);
        d.x += dx * grab; d.y += dy * grab;
        d.vx *= .35; d.vy *= .35;
      } else {
        d.vy += 40 * S * dt;
        d.vx *= Math.exp(-1.4 * dt); d.vy *= Math.exp(-1.4 * dt);
        d.x += d.vx * dt; d.y += d.vy * dt;
      }
      if (dd < 34 * S){
        res[d.k]++; drops.splice(i, 1); hud();
        burst(d.x, d.y, 5, RES[d.k], 130 * S);
        continue;
      }
      if (d.life <= 0 || d.y > H + 30) drops.splice(i, 1);
    }

    /* --- debris --- */
    for (i = bits.length - 1; i >= 0; i--){
      var t = bits[i];
      t.x += t.vx * dt; t.y += t.vy * dt;
      t.vx *= Math.exp(-1.6 * dt); t.vy *= Math.exp(-1.6 * dt);
      t.life -= t.fade * dt;
      if (t.life <= 0) bits.splice(i, 1);
    }

    for (i = 0; i < stars.length; i++){
      var st = stars[i];
      st.y += (26 + st.z * 90) * S * dt;
      if (st.y > H){ st.y = -4; st.x = rand(0, W); }
    }

    if (shake > 0) shake = Math.max(0, shake - dt * 2.2);
    if (flash > 0) flash = Math.max(0, flash - dt * 2.4);
    if (shieldT > 0){
      shieldT -= dt;
      if (shieldT <= 0 && shield < stats.shieldMax){ shield++; shieldT = shield < stats.shieldMax ? 9 : 0; hud(); }
    }
  }

  /* ---------------- rendu ---------------- */

  function shapePath(pts){
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
  }

  function drawShip(){
    var blink = ship.inv > 0 && Math.floor(ship.inv * 14) % 2 === 0;
    ctx.save();
    ctx.translate(ship.x, ship.y);
    ctx.rotate(ship.tilt);
    ctx.scale(S, S);
    ctx.globalAlpha = blink ? .35 : 1;

    /* reacteur */
    var fl = 12 + Math.random() * 10;
    var g = ctx.createLinearGradient(0, 14, 0, 14 + fl);
    g.addColorStop(0, "rgba(255,150,40,.9)");
    g.addColorStop(1, "rgba(255,77,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(-6, 14); ctx.lineTo(6, 14); ctx.lineTo(0, 14 + fl); ctx.closePath(); ctx.fill();

    ctx.lineWidth = 2; ctx.lineJoin = "miter";
    ctx.fillStyle = "#15151A"; ctx.strokeStyle = "rgba(237,231,218,.92)";

    if (shipModel === 0){
      ctx.beginPath();
      ctx.moveTo(0, -22); ctx.lineTo(11, 8); ctx.lineTo(5, 15); ctx.lineTo(-5, 15); ctx.lineTo(-11, 8);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-11, 4); ctx.lineTo(-20, 16); ctx.lineTo(-7, 13);
      ctx.moveTo(11, 4); ctx.lineTo(20, 16); ctx.lineTo(7, 13); ctx.stroke();
    } else if (shipModel === 1){
      ctx.beginPath();
      ctx.moveTo(0, -26); ctx.lineTo(9, 2); ctx.lineTo(6, 16); ctx.lineTo(-6, 16); ctx.lineTo(-9, 2);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-9, -2); ctx.lineTo(-24, 12); ctx.lineTo(-20, 18); ctx.lineTo(-7, 12); ctx.closePath();
      ctx.moveTo(9, -2); ctx.lineTo(24, 12); ctx.lineTo(20, 18); ctx.lineTo(7, 12); ctx.closePath();
      ctx.fill(); ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(0, -24); ctx.lineTo(14, -4); ctx.lineTo(14, 14); ctx.lineTo(-14, 14); ctx.lineTo(-14, -4);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.beginPath();
      ctx.rect(-22, 0, 8, 14); ctx.rect(14, 0, 8, 14); ctx.fill(); ctx.stroke();
    }

    /* verriere */
    ctx.fillStyle = "rgba(95,235,247,.55)";
    ctx.beginPath(); ctx.ellipse(0, -6, 4, 7, 0, 0, 6.28); ctx.fill();

    if (shield > 0){
      ctx.strokeStyle = "rgba(95,235,247," + (.35 + .25 * Math.sin(performance.now() * .006)).toFixed(2) + ")";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, -2, 30, 0, 6.28); ctx.stroke();
    }
    ctx.restore();
  }

  function drawBoss(){
    ctx.save();
    ctx.translate(boss.x, boss.y);
    ctx.lineWidth = 2.4;
    ctx.fillStyle = boss.hit > 0 ? "rgba(255,77,0,.35)" : "#17171D";
    ctx.strokeStyle = "rgba(237,231,218,.9)";
    var w = boss.w * .5, h = boss.h * .5;
    ctx.beginPath();
    ctx.moveTo(-w, -h * .3); ctx.lineTo(-w * .55, -h); ctx.lineTo(w * .55, -h); ctx.lineTo(w, -h * .3);
    ctx.lineTo(w * .6, h); ctx.lineTo(-w * .6, h); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.strokeStyle = "rgba(255,77,0,.85)";
    ctx.beginPath();
    ctx.moveTo(-w * .5, h * .2); ctx.lineTo(w * .5, h * .2);
    ctx.moveTo(-w * .3, -h * .5); ctx.lineTo(w * .3, -h * .5); ctx.stroke();
    ctx.fillStyle = "rgba(255,77,0,.9)";
    for (var i = -1; i <= 1; i++){ ctx.beginPath(); ctx.arc(i * w * .42, h * .55, 4 * S, 0, 6.28); ctx.fill(); }
    ctx.restore();

    var bw = Math.min(W * .5, 420 * S), bx = (W - bw) / 2, by = 34 * S;
    ctx.fillStyle = "rgba(10,10,11,.8)"; ctx.fillRect(bx, by, bw, 9 * S);
    ctx.fillStyle = "rgba(255,77,0,.95)";
    ctx.fillRect(bx, by, bw * clamp(boss.hp / boss.max, 0, 1), 9 * S);
    ctx.strokeStyle = "rgba(237,231,218,.75)"; ctx.lineWidth = 1.5;
    ctx.strokeRect(bx, by, bw, 9 * S);
  }

  function draw(){
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    if (shake > 0){
      ctx.translate(rand(-1, 1) * shake * 9 * S, rand(-1, 1) * shake * 9 * S);
    }

    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#05060B"); g.addColorStop(.55, "#08080E"); g.addColorStop(1, "#0B0708");
    ctx.fillStyle = g; ctx.fillRect(-20, -20, W + 40, H + 40);

    var i, r;
    for (i = 0; i < stars.length; i++){
      var st = stars[i];
      ctx.fillStyle = "rgba(237,231,218," + (.12 + st.z * .5).toFixed(3) + ")";
      ctx.fillRect(st.x, st.y, st.s, st.s * (1 + st.z * 1.6));
    }

    var rg = ctx.createRadialGradient(W * .5, H * .2, 0, W * .5, H * .2, H * .8);
    rg.addColorStop(0, "rgba(255,77,0,.07)"); rg.addColorStop(1, "rgba(255,77,0,0)");
    ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);

    for (i = 0; i < drops.length; i++){
      var d = drops[i];
      ctx.save(); ctx.translate(d.x, d.y); ctx.rotate(performance.now() * .002 + i);
      ctx.fillStyle = "rgba(" + RES[d.k] + ",.28)";
      ctx.strokeStyle = "rgba(" + RES[d.k] + ",.95)"; ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(0, -d.r); ctx.lineTo(d.r, 0); ctx.lineTo(0, d.r); ctx.lineTo(-d.r, 0); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.restore();
    }

    for (i = 0; i < rocks.length; i++){
      r = rocks[i];
      ctx.save(); ctx.translate(r.x, r.y); ctx.rotate(r.rot);
      shapePath(r.pts);
      ctx.fillStyle = r.hit > 0 ? "rgba(255,77,0,.30)" : "rgba(22,22,26,.92)";
      ctx.fill();
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = r.hit > 0 ? "rgba(255,150,60,.95)" : "rgba(237,231,218," + (.32 + r.tier * .12).toFixed(2) + ")";
      ctx.stroke();
      ctx.restore();
    }

    for (i = 0; i < bits.length; i++){
      var t = bits[i];
      ctx.fillStyle = "rgba(" + t.c + "," + Math.max(0, t.life).toFixed(3) + ")";
      ctx.fillRect(t.x, t.y, t.r, t.r);
    }

    ctx.lineCap = "round";
    for (i = 0; i < bolts.length; i++){
      var b = bolts[i];
      ctx.strokeStyle = "rgba(255,198,107,.95)"; ctx.lineWidth = b.r;
      ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - b.vx * .012, b.y - b.vy * .012); ctx.stroke();
    }
    for (i = 0; i < foes.length; i++){
      var f = foes[i];
      ctx.fillStyle = "rgba(255,77,0,.95)";
      ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, 6.28); ctx.fill();
    }

    if (boss) drawBoss();
    if (!over) drawShip();

    if (flash > 0){
      ctx.fillStyle = "rgba(255,77,0," + (flash * .22).toFixed(3) + ")";
      ctx.fillRect(-20, -20, W + 40, H + 40);
    }
  }

  function frame(now){
    var dt = (now - last) / 1000;
    last = now;
    if (!(dt > 0) || dt > .05) dt = .0166;

    if (!active){
      if (drawn){ ctx.setTransform(DPR,0,0,DPR,0,0); ctx.clearRect(0, 0, W, H); drawn = false; }
      requestAnimationFrame(frame);
      return;
    }
    if (!paused && !over && !held()) step(dt);
    else if (over) { for (var i = bits.length - 1; i >= 0; i--){ var t = bits[i]; t.x += t.vx*dt; t.y += t.vy*dt; t.life -= t.fade*dt; if (t.life<=0) bits.splice(i,1);} }
    draw();
    drawn = true;
    requestAnimationFrame(frame);
  }

  /* ---------------- entrees ---------------- */

  var MAP = {
    arrowleft: "left", q: "left", a: "left",
    arrowright: "right", d: "right",
    arrowup: "up", z: "up", w: "up",
    arrowdown: "down", s: "down",
    " ": "fire"
  };

  function onKey(e, down){
    if (!active) return;
    /* le curseur de volume garde ses propres fleches */
    var t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA")) return;
    var k = (e.key || "").toLowerCase();
    if (down && k === "escape"){
      var sp = el("a-shop");
      if (sp && !sp.hidden){ e.preventDefault(); toggleShop(); return; }
      /* sinon ECHAP rend la souris et ouvre les reglages. Sous verrou, le
         navigateur avale la touche : c'est pointerlockchange qui prend le
         relais, et le voile s'affiche de la meme facon. */
      if (!over && !modalOpen()){ e.preventDefault(); kbd = false; releaseLock(); lockCue(); }
      return;
    }
    if (down && over && (k === "r" || k === "enter")){ e.preventDefault(); reset(); return; }
    if (down && k >= "1" && k <= "4"){
      var cw = el("a-cards");
      if (cw && !cw.hidden){
        var btn = cw.querySelectorAll(".gcard")[parseInt(k, 10) - 1];
        if (btn){ e.preventDefault(); takeCard(btn.getAttribute("data-k")); }
        return;
      }
    }
    var m = MAP[k];
    if (!m) return;
    e.preventDefault();                 /* pas de defilement, pas de saut de page */
    /* une touche de pilotage leve l'attente du verrou : le clavier reste
       jouable pour qui ne veut pas de la souris. */
    if (down && !locked && !kbd){ kbd = true; lockCue(); }
    keys[m] = down;
  }

  /* ---------------- verrou du pointeur ---------------- */

  function modalOpen(){
    var a = el("a-cards"), b = el("a-shop"), c = el("a-over");
    return !!((a && !a.hidden) || (b && !b.hidden) || (c && !c.hidden));
  }

  /* la partie attend tant que la souris n'est pas capturee. Sans verrou
     disponible, il n'y a rien a attendre. */
  function held(){ return active && CAN_LOCK && !locked && !kbd && !modalOpen(); }

  function lockCue(){
    var c = el("a-lock");
    if (c) c.hidden = !held();
  }

  function requestLock(){
    var p = el("p3");
    if (!p || !active || locked || modalOpen() || !CAN_LOCK) return;
    /* le mouvement brut evite l'acceleration du systeme : la visee reste
       previsible d'un poste a l'autre. */
    try {
      var r = p.requestPointerLock({ unadjustedMovement: true });
      if (r && r["catch"]) r["catch"](function(){ try { p.requestPointerLock(); } catch (e2) {} });
    } catch (e){ try { p.requestPointerLock(); } catch (e2) {} }
  }

  function releaseLock(){
    if (document.pointerLockElement && document.exitPointerLock) document.exitPointerLock();
  }

  function setActive(v){
    if (v === active) return;
    active = v;
    last = performance.now();
    keys = {}; kbd = false;
    if (!v){ closeAll(); releaseLock(); }
    if (v && !ship) reset();
    if (v) hud();
    Music.set(v);
    lockCue();
  }

  function init(){
    if (!cvs) return;
    resize();
    window.addEventListener("resize", resize);

    window.addEventListener("keydown", function(e){ onKey(e, true); });
    window.addEventListener("keyup",   function(e){ onKey(e, false); });
    window.addEventListener("blur", function(){ keys = {}; });

    /* --- souris : capture, puis pilotage aux deplacements bruts --- */

    var pg = el("p3");
    if (pg) pg.addEventListener("mousedown", function(e){
      if (!active) return;

      /* clic droit : atelier. On l'ecoute ici et pas sur contextmenu, qui
         n'est pas garanti sous verrou de pointeur. */
      if (e.button === 2){
        e.preventDefault();
        if (over) return;
        var c = el("a-cards");
        if (c && !c.hidden) return;     /* un module attend d'etre choisi */
        toggleShop();
        return;
      }

      /* clic gauche : capture du pointeur */
      if (e.button !== 0 || locked || modalOpen()) return;
      if (e.target.closest && e.target.closest(".gmodal, .lockvol")) return;
      e.preventDefault();
      kbd = false;
      requestLock();
    });

    /* le menu du navigateur n'a rien a faire dans l'arene */
    if (pg) pg.addEventListener("contextmenu", function(e){
      if (active) e.preventDefault();
    });

    document.addEventListener("pointerlockchange", function(){
      locked = (document.pointerLockElement === el("p3"));
      if (locked){
        kbd = false;
        keys = {};
        /* si le curseur de volume avait le focus, il garderait les fleches */
        if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
        aim.x = ship ? ship.x : W * .5;
        aim.y = ship ? ship.y : FLOOR - 90 * S;
        last = performance.now();       /* pas de bond de simulation a la reprise */
      }
      lockCue();
    });

    document.addEventListener("pointerlockerror", function(){ locked = false; lockCue(); });

    document.addEventListener("mousemove", function(e){
      if (!locked || !active) return;
      aim.x = clamp(aim.x + (e.movementX || 0), 26 * S, W - 26 * S);
      aim.y = clamp(aim.y + (e.movementY || 0), 92 * S, FLOOR - 18 * S);
    });


    var vr = el("a-volr"), vo = el("a-volv");
    if (vr){
      vr.value = Music.level();
      if (vo) vo.value = Music.level();
      vr.addEventListener("input", function(){
        var lvl = Music.setLevel(parseInt(vr.value, 10) || 0);
        if (vo) vo.value = lvl;
      });
    }

    var row = el("a-cardrow");
    if (row) row.addEventListener("click", function(e){
      var b = e.target.closest(".gcard");
      if (b) takeCard(b.getAttribute("data-k"));
    });

    var tabs = el("a-tabs");
    if (tabs) tabs.addEventListener("click", function(e){
      var b = e.target.closest(".gtab");
      if (b){ tab = b.getAttribute("data-t"); paintShop(); }
    });

    var items = el("a-items");
    if (items){
      items.addEventListener("click", function(e){
        var b = e.target.closest(".gitem");
        if (b) buy(parseInt(b.getAttribute("data-i"), 10));
      });
      items.addEventListener("mouseover", function(e){
        var b = e.target.closest(".gitem");
        if (b) detail(shopList()[parseInt(b.getAttribute("data-i"), 10)]);
      });
      items.addEventListener("mouseleave", function(){ detail(null); });
    }

    var cl = el("a-shopclose");
    if (cl) cl.addEventListener("click", toggleShop);
    var rs = el("a-restart");
    if (rs) rs.addEventListener("click", reset);

    requestAnimationFrame(frame);
  }

  return { init: init, setActive: setActive,
           playing: function(){ return active; },
           locked:  function(){ return locked; } };
})();

Arena.init();
Arena.setActive(true);

var ArenaVol = VolumeUI(Music);
ArenaVol.add("f-mute", "f-volr", "f-volv");

})();
