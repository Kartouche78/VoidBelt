(function(){
"use strict";

/* bande-son du ring : loading.mp3, en boucle tant que la page est ouverte */
var RingMusic = Track("ringtrack", "voidbelt.ring.volume", 35);

/* ============================================================
   LE RING — un vagabond tient une echoppe de sports de combat.
   Il vend, il mange, il s'entraine, il paie un coach, il visse
   un exosquelette, puis il monte sur le ring. La fatigue le
   limite : apres un combat il faut attendre.
   Vue de cote, lumiere du soleil par le haut, tableau
   d'affichage suspendu comme au basket.
   ============================================================ */

var Ring = (function(){
  var cvs = document.getElementById("boxbg");
  var ctx = cvs ? cvs.getContext("2d") : null;
  var DPR = Math.min(window.devicePixelRatio || 1, 2);
  var W = 0, H = 0, S = 1;

  var active = false, last = 0;

  function el(id){ return document.getElementById(id); }
  function clamp(v, a, b){ return v < a ? a : (v > b ? b : v); }
  function rand(a, b){ return a + Math.random() * (b - a); }
  function pick(a){ return a[Math.floor(Math.random() * a.length)]; }
  function money(n){ return Math.round(n).toLocaleString("fr-FR"); }
  function mmss(s){
    s = Math.max(0, Math.ceil(s));
    return pad(Math.floor(s / 60)) + ":" + pad(s % 60);
  }

  /* ---------------- l'echoppe ---------------- */

  var C_CONSO = "#5FEBF7", C_EQUIP = "#FF4D00", C_FOOD = "#8BE86B", C_EXO = "#FFC66B";

  /* cost : prix d'achat au grossiste. base : ce que le quartier accepte
     de payer. dem : combien de monde en cherche. eat : ce que ca fait
     au corps du patron s'il le consomme lui-meme. */
  var GOODS = [
    { n:"BANDES NANO",        cat:"CONSO", c:C_CONSO, cost:6,   base:12,  dem:1.15 },
    { n:"PROTÈGE-DENTS GEL",  cat:"ÉQUIP", c:C_EQUIP, cost:11,  base:21,  dem:.75 },
    { n:"GANTS NÉON 12OZ",    cat:"ÉQUIP", c:C_EQUIP, cost:44,  base:82,  dem:.55 },
    { n:"CORDE LESTÉE",       cat:"ÉQUIP", c:C_EQUIP, cost:16,  base:30,  dem:.70 },
    { n:"SAC HYDRO-CHOC",     cat:"ÉQUIP", c:C_EQUIP, cost:88,  base:158, dem:.30 },
    { n:"HUILE SYNTH-MUSC",   cat:"CONSO", c:C_CONSO, cost:14,  base:27,  dem:.90 },
    { n:"BARRE PROTÉINE Z",   cat:"VIVRES",c:C_FOOD,  cost:4,   base:9,   dem:1.40, eat:{ fd:16, en:5 } },
    { n:"BOL DE RIZ YAKI",    cat:"VIVRES",c:C_FOOD,  cost:7,   base:14,  dem:1.25, eat:{ fd:34, en:9 } },
    { n:"RAMEN ORBITAL",      cat:"VIVRES",c:C_FOOD,  cost:6,   base:12,  dem:1.30, eat:{ fd:28, en:7, fo:1 } },
    { n:"SÉRUM DE RÉCUP",     cat:"CONSO", c:C_CONSO, cost:34,  base:62,  dem:.50, eat:{ en:34, inj:-16 } },
    { n:"GEL ANTI-HÉMATOME",  cat:"CONSO", c:C_CONSO, cost:18,  base:34,  dem:.60, eat:{ inj:-26 } },
    { n:"CELLULE EXO A-7",    cat:"EXO",   c:C_EXO,   cost:58,  base:106, dem:.45, part:"cell" },
    { n:"PLAQUE SERVO T-2",   cat:"EXO",   c:C_EXO,   cost:124, base:214, dem:.28, part:"plate" },
    { n:"CASQUE SPARRING",    cat:"ÉQUIP", c:C_EQUIP, cost:38,  base:70,  dem:.50 }
  ];

  /* ---------------- le coin ---------------- */

  var COACHES = [
    { n:"KENJI MORI", i:"木", hire:250, pay:38,
      d:"Le vieux du dojo en ruine. Garde haute, patience infinie. Il accepte le sparring.",
      b:{ gard:2 }, spar:true, tags:["+2 GARDE","SPARRING"],
      say:["GARDE HAUTE.","RESPIRE, PETIT.","LE MENTON RENTRÉ.","IL SE DÉCOUVRE À DROITE."] },
    { n:"IVANA VOLKOV", i:"V", hire:600, pay:78,
      d:"Ancienne poids lourd de la Ceinture. Elle ne parle que de puissance et de bourses.",
      b:{ puis:2 }, purse:1.2, tags:["+2 PUISSANCE","BOURSE +20%"],
      say:["CASSE-LE EN DEUX.","PLUS FORT !","AVANCE, N'ATTENDS PAS.","METS-Y LES HANCHES."] },
    { n:"DR. SAITO", i:"再", hire:520, pay:64,
      d:"Médecin de coin, seringue toujours prête. La récupération va bien plus vite.",
      b:{}, rec:1.55, cool:.6, heal:1.8, tags:["RÉCUP +55%","REPOS -40%"],
      say:["ÉCONOMISE-TOI.","TIENS LA DISTANCE.","TON SOUFFLE, SURVEILLE-LE.","ÇA SAIGNE, ÇA VA."] },
    { n:"AZUR-9", i:"9", hire:1100, pay:96,
      d:"Coach synthétique. Il lit l'adversaire et t'affiche ses intentions sur la rétine.",
      b:{ ment:2 }, tell:true, purse:1.05, tags:["+2 MENTAL","TÉLÉGRAPHE"],
      say:["ANALYSE : CROCHET.","OUVERTURE DANS 2 S.","SA GARDE TOMBE.","PROBABILITÉ : 71%."] }
  ];

  /* ---------------- le barda ---------------- */

  /* need : [indice de marchandise, quantite] a prendre dans le stock de
     la boutique. Ce qu'il vend, il peut aussi se le monter dessus. */
  var GEAR = [
    { k:"gants", n:"POINGS", tiers:[
      { n:"MITAINES USÉES",   c:0,    b:{} },
      { n:"GANTS NÉON 12OZ",  c:320,  b:{ puis:1 },        need:[2,2] },
      { n:"GANTS SERVO-CUIR", c:980,  b:{ puis:2, vit:1 }, need:[2,3] },
      { n:"POINGS TITAN-X",   c:2600, b:{ puis:4, vit:1 }, need:[12,2] }
    ]},
    { k:"pieds", n:"APPUIS", tiers:[
      { n:"SANDALES DE ROUTE",c:0,    b:{} },
      { n:"BOTTES GRIP-9",    c:280,  b:{ vit:1 } },
      { n:"APPUIS MAGLEV",    c:900,  b:{ vit:3 },         need:[11,2] },
      { n:"SEMELLES NULL-G",  c:2300, b:{ vit:4, end:1 },  need:[11,4] }
    ]},
    { k:"tete", n:"PROTECTION", tiers:[
      { n:"BANDEAU EN LOQUE", c:0,    b:{} },
      { n:"PROTÈGE-DENTS GEL",c:190,  b:{ gard:1 },        need:[1,2] },
      { n:"CASQUE SPARRING",  c:560,  b:{ gard:2 },        need:[13,2] },
      { n:"VISIÈRE KENDŌ-9",  c:1800, b:{ gard:3, ment:1 } }
    ]},
    { k:"tenue", n:"TENUE", tiers:[
      { n:"HAORI RAPIÉCÉ",    c:0,    b:{} },
      { n:"CEINTURE LESTÉE",  c:240,  b:{ end:1 },         need:[3,2] },
      { n:"COMBI THERMO-SEC", c:780,  b:{ end:2, ment:1 } },
      { n:"SOIE BALISTIQUE",  c:2100, b:{ end:3, gard:1 } }
    ]}
  ];

  var EXO = [
    { n:"AUCUN",         c:0,    cell:0,  plate:0,  b:{} },
    { n:"MK-I ARMATURE", c:450,  cell:2,  plate:0,  b:{ end:2, gard:1 } },
    { n:"MK-II SERVO",   c:1400, cell:4,  plate:2,  b:{ puis:2, end:2, vit:1 } },
    { n:"MK-III NEXUS",  c:3600, cell:8,  plate:5,  b:{ puis:3, vit:3, end:3, ment:1 } },
    { n:"MK-IV RŌNIN",   c:8200, cell:14, plate:10, b:{ puis:5, vit:4, end:4, gard:3, ment:2 } }
  ];

  var TRAIN = [
    { n:"OMBRE",        d:"Shadowboxing devant la vitrine, entre deux clients.", en:8,  fo:3, xp:9,  inj:0 },
    { n:"CORDE LESTÉE", d:"Pieds et souffle. Le plancher grince.",               en:12, fo:6, xp:13, inj:0 },
    { n:"SAC HYDRO",    d:"Le sac rend les coups. C'est le principe.",           en:18, fo:5, xp:17, inj:1 },
    { n:"FRACTIONNÉ",   d:"Tapis en apnée sous la lampe. Ça pique.",             en:24, fo:9, xp:21, inj:1 },
    { n:"SPARRING",     d:"Il faut quelqu'un en face : un coach, donc.",         en:30, fo:8, xp:36, inj:4, coach:true },
    { n:"MÉDITATION",   d:"Assis, immobile, le vide. Les bleus se referment.",   en:4,  fo:2, xp:8,  inj:-5 }
  ];

  var ATTRS = [
    { k:"puis", n:"PUISSANCE" }, { k:"vit", n:"VITESSE" }, { k:"end", n:"ENDURANCE" },
    { k:"gard", n:"GARDE" },     { k:"ment", n:"MENTAL" }
  ];

  /* ---------------- les adversaires ---------------- */

  var BOTS = [
    { n:"TŌJŌ LE FERRAILLEUR", st:"BRUT",       elo:880,  hp:100, pw:.85, sp:.85, gd:.70, ag:.55, purse:180,
      d:"Ramasse de la ferraille le jour, cogne la nuit. Aucune technique, beaucoup de volonté." },
    { n:"MAKO DEUX-TEMPS",     st:"VITESSE",    elo:990,  hp:112, pw:.95, sp:1.08,gd:.80, ag:.72, purse:290,
      d:"Deux coups avant que tu n'aies vu le premier. Se vide vite, cependant." },
    { n:"GRIM DELTA-9",        st:"PRESSION",   elo:1110, hp:128, pw:1.10,sp:.95, gd:.95, ag:.68, purse:430,
      d:"Avance. Avance encore. Ne recule jamais. Exosquelette de chantier reconverti." },
    { n:"SŒUR HANA",           st:"CONTRE",     elo:1240, hp:122, pw:1.02,sp:1.20,gd:1.06,ag:.58, purse:620,
      d:"Elle attend ta faute et la facture au prix fort. Ancienne du temple de l'Anneau." },
    { n:"BARON KURŌ",          st:"PUNCHEUR",   elo:1380, hp:142, pw:1.32,sp:1.00,gd:1.00,ag:.78, purse:880,
      d:"Un seul crochet suffit. Il n'en a jamais eu besoin de deux." },
    { n:"TITAN-07",            st:"EXO MK-III", elo:1520, hp:168, pw:1.46,sp:1.05,gd:1.16,ag:.70, purse:1350,
      d:"Servo-armature militaire, pilote inconnu. La cage vibre quand il frappe." },
    { n:"L'ARCHIVISTE",        st:"CHAMPION",   elo:1700, hp:184, pw:1.52,sp:1.30,gd:1.26,ag:.82, purse:2400,
      d:"Il a mémorisé chacun de tes combats. Ceinture de la Ceinture, dix défenses." }
  ];

  var PSEUDOS = ["KAZE_07","NEONWOLF","HIKARI//X","VAGRANT_9","OBSIDIENNE","SAKURA-KO",
                 "TETSUO_MK2","LAME BLANCHE","ORBITE-BASSE","GHOST DOJO","RŌNIN-42",
                 "MIDORI FIST","ZEN-KAI","AKUMA STATIQUE","BRUME","DERNIER TRAIN",
                 "SEL ET ROUILLE","PLUIE ACIDE","KOHAKU","NULL POINTER"];

  var RANKS = [[0,"D"],[3,"C"],[7,"B"],[13,"A"],[20,"S"],[30,"SS"]];

  /* ---------------- etat ---------------- */

  var G = null;

  function fresh(){
    var st = [], pr = [], i;
    for (i = 0; i < GOODS.length; i++){
      /* la boutique ouvre avec un fond de rayon et les prix conseilles */
      st.push(i < 10 ? Math.round(rand(3, 9)) : 0);
      pr.push(GOODS[i].base);
    }
    return {
      cash: 320, day: 1, clock: 8 * 60,   /* minutes de jeu, la journee va de 08:00 a 24:00 */
      en: 100, fd: 88, fo: 40, inj: 0,
      lvl: 1, xp: 0, pts: 3,
      attr: { puis:4, vit:4, end:4, gard:3, ment:3 },
      gear: { gants:0, pieds:0, tete:0, tenue:0 },
      exo: 0, coach: -1,
      stock: st, price: pr,
      rep: 10, wins: 0, losses: 0, kos: 0, elo: 1000,
      rest: 0, sales: 0, revenue: 0, spent: 0, clients: 0,
      lastDay: { rev:0, cli:0, rent:0, pay:0 },
      log: [], seen: {}, mmOK: false
    };
  }

  var KEY = "voidbelt.ring.v1";

  function save(){
    try { localStorage.setItem(KEY, JSON.stringify(G)); } catch (e){}
  }
  function load(){
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      /* un fichier d'une version plus ancienne : on repart a neuf plutot
         que de trainer des champs manquants. */
      if (!o || !o.attr || !o.stock || o.stock.length !== GOODS.length) return null;
      return o;
    } catch (e){ return null; }
  }

  /* ---------------- valeurs derivees ---------------- */

  function coach(){ return G.coach >= 0 ? COACHES[G.coach] : null; }

  function bonus(){
    var b = { puis:0, vit:0, end:0, gard:0, ment:0 }, i, k, src = [];
    for (i = 0; i < GEAR.length; i++) src.push(GEAR[i].tiers[G.gear[GEAR[i].k]].b);
    src.push(EXO[G.exo].b);
    var co = coach(); if (co) src.push(co.b);
    for (i = 0; i < src.length; i++) for (k in b) if (src[i][k]) b[k] += src[i][k];
    return b;
  }

  /* attributs effectifs : base + barda, ronges par les blessures */
  function eff(){
    var b = bonus(), o = {}, i, k;
    var pen = 1 - G.inj / 260;
    for (i = 0; i < ATTRS.length; i++){
      k = ATTRS[i].k;
      o[k] = Math.max(1, (G.attr[k] + b[k]) * pen);
    }
    return o;
  }

  function rank(){
    var r = "D", i;
    for (i = 0; i < RANKS.length; i++) if (G.wins >= RANKS[i][0]) r = RANKS[i][1];
    return r;
  }

  function xpMax(){ return 40 + G.lvl * 24; }

  /* vitesses de recuperation, par seconde reelle */
  function recEn(){
    var co = coach();
    var f = co && co.rec ? co.rec : 1;
    if (G.fd < 8) f *= .22; else if (G.fd < 30) f *= .6;
    return .52 * f * (1 + G.fo / 400);
  }
  function recInj(){
    var co = coach();
    return .18 * (co && co.heal ? co.heal : 1);
  }

  var EN_MIN = 45, INJ_MAX = 62;

  /* temps restant avant de pouvoir remonter sur le ring */
  function eta(){
    var t = G.rest;
    if (G.en < EN_MIN) t = Math.max(t, (EN_MIN - G.en) / recEn());
    if (G.inj > INJ_MAX) t = Math.max(t, (G.inj - INJ_MAX) / recInj());
    return t;
  }
  function ready(){ return !F.on && eta() <= 0; }

  function parts(kind){
    var n = 0, i;
    for (i = 0; i < GOODS.length; i++) if (GOODS[i].part === kind) n += G.stock[i];
    return n;
  }
  function takeParts(kind, q){
    var i;
    for (i = 0; i < GOODS.length && q > 0; i++){
      if (GOODS[i].part !== kind) continue;
      var t = Math.min(q, G.stock[i]);
      G.stock[i] -= t; q -= t;
    }
  }

  function say(txt, cls){
    G.log.unshift({ t: txt, c: cls || "" });
    if (G.log.length > 26) G.log.length = 26;
    paintLog();
  }

  /* ============================================================
     LA BOUTIQUE — flux de clients, prix, jours
     ============================================================ */

  var walkers = [], spawnAcc = 0, needGoods = false, needHead = false;

  /* clients par seconde reelle : le renom du boxeur remplit l'echoppe */
  function crowd(){
    return .40 + G.rep / 90 + Math.min(1.4, G.wins * .07) + (G.exo > 2 ? .12 : 0);
  }

  function customer(){
    G.clients++;
    var w = [], tot = 0, i, d;
    for (i = 0; i < GOODS.length; i++){
      d = GOODS[i].dem * (G.stock[i] > 0 ? 1 : .16);
      w.push(d); tot += d;
    }
    var r = Math.random() * tot, k = 0;
    for (i = 0; i < GOODS.length; i++){ k += w[i]; if (r <= k) break; }
    if (i >= GOODS.length) i = GOODS.length - 1;

    if (G.stock[i] <= 0){
      G.rep = Math.max(0, G.rep - .14);
      return { i:i, ok:false, why:"vide" };
    }
    /* ce que ce client-la accepte de payer, module par le renom */
    var wtp = GOODS[i].base * rand(.72, 1.34) * (1 + G.rep / 420);
    if (G.price[i] > wtp) return { i:i, ok:false, why:"cher" };

    G.stock[i]--; G.cash += G.price[i]; G.revenue += G.price[i]; G.sales++;
    G.rep = Math.min(100, G.rep + .06);
    return { i:i, ok:true, p:G.price[i] };
  }

  function closeDay(){
    var rent = 110 + G.day * 10;
    var co = coach(), pay = co ? co.pay : 0;
    G.cash -= rent + pay;
    G.lastDay = { rev: Math.round(G.revenue), cli: G.clients, rent: rent, pay: pay };

    say("JOUR " + pad(G.day) + " CLOS — " + money(G.revenue) + " CR encaissés, " +
        G.clients + " passages.", G.revenue > rent + pay ? "win" : "hit");
    if (G.cash < 0) say("DÉCOUVERT. Le propriétaire a glissé un mot sous la porte.", "hit");

    /* la nuit sur le futon de l'arriere-boutique */
    G.en = Math.min(100, G.en + 24);
    G.fd = Math.max(0, G.fd - 6);
    G.fo = Math.max(0, G.fo - 1);
    G.day++; G.clock = 8 * 60; G.clients = 0; G.revenue = 0;
    needHead = true; needGoods = true;
    save();
  }

  /* 1 seconde reelle = 10 minutes de jeu : la journee tient en 96 s */
  function shopTick(dt){
    G.clock += dt * 10;
    if (G.clock >= 24 * 60) closeDay();

    /* le corps, lui, tourne en continu */
    G.en = clamp(G.en + recEn() * dt, 0, 100);
    G.fd = clamp(G.fd - .50 * dt, 0, 100);
    G.fo = clamp(G.fo - .09 * dt, 0, 100);
    G.inj = clamp(G.inj - recInj() * dt, 0, 100);
    if (G.rest > 0) G.rest = Math.max(0, G.rest - dt);
    if (G.fd <= 0) G.fo = clamp(G.fo - .12 * dt, 0, 100);

    /* la boutique n'ouvre pas la nuit et ferme pendant les combats */
    var open = !F.on && G.clock > 8 * 60 && G.clock < 22 * 60;
    if (open){
      spawnAcc += dt * crowd();
      while (spawnAcc >= 1){
        spawnAcc -= 1;
        var s = customer();
        walkers.push({
          x: -.1, v: rand(.055, .1), h: rand(.7, 1),
          ok: s.ok, why: s.why, ph: rand(0, 6.28)
        });
        needGoods = true;
      }
    }
    for (var i = walkers.length - 1; i >= 0; i--){
      walkers[i].x += walkers[i].v * dt;
      if (walkers[i].x > 1.15) walkers.splice(i, 1);
    }
  }

  /* ============================================================
     L'INTERFACE DE GESTION
     ============================================================ */

  function bar(id, pct){
    var i = el(id); if (i) i.style.width = clamp(pct, 0, 100).toFixed(1) + "%";
  }

  function paintHead(){
    el("r-rank").textContent = rank();
    el("r-rec").textContent = G.wins + "V-" + G.losses + "D";
    el("r-elo").textContent = Math.round(G.elo);
    el("r-cash").textContent = money(G.cash);
    el("r-lvl").textContent = "NIV " + pad(G.lvl);
    el("r-rep").textContent = Math.round(G.rep);
    el("r-clock").textContent = "J" + pad(G.day) + " " +
      pad(Math.floor(G.clock / 60)) + ":" + pad(Math.floor(G.clock % 60 / 10) * 10);
    el("r-clients").textContent = G.clients;

    var tot = 0, i;
    for (i = 0; i < GOODS.length; i++) tot += G.stock[i];
    el("r-stock").textContent = tot;

    bar("r-en", G.en);  el("r-env").textContent = Math.round(G.en);
    bar("r-fd", G.fd);  el("r-fdv").textContent = Math.round(G.fd);
    bar("r-fo", G.fo);  el("r-fov").textContent = Math.round(G.fo);
    bar("r-in", G.inj); el("r-inv").textContent = Math.round(G.inj);
    el("r-enb").classList.toggle("low", G.en < EN_MIN);
    el("r-fdb").classList.toggle("low", G.fd < 20);

    el("r-exotag").textContent = "EXO — " + EXO[G.exo].n;

    /* le bouton de combat : gris tant que le corps n'est pas pret */
    var b = el("r-bfight"), s = el("r-bfights"), t = eta();
    if (F.on){
      b.disabled = true; s.textContent = "SUR LE RING";
    } else if (t > 0){
      b.disabled = true;
      s.textContent = (G.inj > INJ_MAX ? "SOINS " : "REPOS ") + mmss(t);
    } else {
      b.disabled = false;
      s.textContent = "PRÊT";
    }

    var u = el("r-bups");
    u.textContent = G.pts > 0 ? G.pts + (G.pts > 1 ? " PTS" : " PT") : "XP " + G.xp + "/" + xpMax();
    var d = el("r-bup").querySelector(".rdot");
    if (G.pts > 0 && !d){ d = document.createElement("i"); d.className = "rdot"; el("r-bup").appendChild(d); }
    else if (G.pts <= 0 && d) d.remove();

    paintAttrs(); paintGear(); paintCoach(); paintLedger();
  }

  function paintAttrs(){
    var e = eff(), h = "", i, k, v, ev, j, cls;
    for (i = 0; i < ATTRS.length; i++){
      k = ATTRS[i].k; v = G.attr[k]; ev = Math.round(e[k]);
      h += '<div class="rattr-l"><span>' + ATTRS[i].n + '</span><div class="rpips">';
      for (j = 1; j <= 20; j++){
        cls = j <= v ? "on" : (j <= ev ? "bon" : "");
        h += '<u class="' + cls + '"></u>';
      }
      h += '</div><b>' + ev + '</b></div>';
    }
    el("r-attrs").innerHTML = h;
  }

  function paintGear(){
    var h = "", i, g, t;
    for (i = 0; i < GEAR.length; i++){
      g = GEAR[i]; t = g.tiers[G.gear[g.k]];
      h += '<div class="rslot' + (G.gear[g.k] === 0 ? " void" : "") + '" style="--c:' +
           (G.gear[g.k] === 0 ? "#6b6b6b" : "#5FEBF7") + '">' +
           '<i></i><span>' + g.n + '</span><b>' + t.n + '</b></div>';
    }
    h += '<div class="rslot' + (G.exo === 0 ? " void" : "") + '" style="--c:' +
         (G.exo === 0 ? "#6b6b6b" : "#FFC66B") + '"><i></i><span>EXO</span><b>' +
         EXO[G.exo].n + '</b></div>';
    el("r-gear").innerHTML = h;
  }

  function paintCoach(){
    var box = el("r-coachbox"), co = coach();
    box.classList.toggle("none", !co);
    el("r-coachf").textContent = co ? co.i : "—";
    el("r-coachn").textContent = co ? co.n : "AUCUN COACH";
    el("r-coachd").textContent = co
      ? co.tags.join(" · ") + " · " + co.pay + " CR/jour"
      : "Personne dans ton coin. Le ring est long, tout seul.";
  }

  function paintLedger(){
    var d = G.lastDay;
    var net = d.rev - d.rent - d.pay;
    el("r-ledger").innerHTML =
      '<div class="rline"><span>CAISSE DU JOUR</span><b class="up">+' + money(G.revenue) + '</b></div>' +
      '<div class="rline"><span>HIER — RECETTES</span><b>' + money(d.rev) + '</b></div>' +
      '<div class="rline"><span>HIER — LOYER</span><b class="dn">-' + money(d.rent) + '</b></div>' +
      '<div class="rline"><span>HIER — COACH</span><b class="dn">-' + money(d.pay) + '</b></div>' +
      '<div class="rline"><span>HIER — NET</span><b class="' + (net >= 0 ? "up" : "dn") + '">' +
        (net >= 0 ? "+" : "") + money(net) + '</b></div>' +
      '<div class="rline"><span>VENTES TOTALES</span><b>' + G.sales + '</b></div>' +
      '<div class="rline"><span>K.-O. INFLIGÉS</span><b>' + G.kos + '</b></div>' +
      '<div class="rline"><span>PALMARÈS</span><b>' + G.wins + "V – " + G.losses + 'D</b></div>' +
      '<div class="rline"><span>RENOM DU QUARTIER</span><b>' + Math.round(G.rep) + ' / 100</b></div>' +
      '<div class="rline"><span>FILE CLASSÉE</span><b class="' + (G.wins >= 3 ? "up" : "dn") + '">' +
        (G.wins >= 3 ? "OUVERTE" : G.wins + " / 3 VICTOIRES") + '</b></div>' +
      '<div class="rline"><span>PROCHAIN CLIENT</span><b>' +
        (crowd() > 0 ? (1 / crowd()).toFixed(1) + " S" : "—") + '</b></div>' +
      '<div class="rline"><span>ADVERSAIRE VISÉ</span><b>' + nextFoe().n + '</b></div>' +
      '<div class="rline"><span>SA BOURSE</span><b>' + money(nextFoe().purse) + ' CR</b></div>' +
      '<div class="rline"><span>SON ELO</span><b>' + nextFoe().elo + '</b></div>';
  }

  /* le bot le plus dur encore a portee : la cible du moment */
  function nextFoe(){
    var best = BOTS[0], i;
    for (i = 0; i < BOTS.length; i++) if (BOTS[i].elo <= G.elo + 190) best = BOTS[i];
    return best;
  }

  function paintLog(){
    var h = "", i;
    for (i = 0; i < G.log.length; i++)
      h += '<p class="' + G.log[i].c + '">' + G.log[i].t + '</p>';
    el("r-log").innerHTML = h;
  }

  /* --- le rayon : construit une fois, puis seules les valeurs bougent --- */

  var refs = null;

  function buildGoods(){
    var box = el("r-goods"), h = "", i, g;
    for (i = 0; i < GOODS.length; i++){
      g = GOODS[i];
      h += '<div class="rgood" data-i="' + i + '">' +
             '<div class="rgood-n" style="--c:' + g.c + '"><i></i>' + g.n + '</div>' +
             '<div class="rgood-cat" style="--c:' + g.c + '">' + g.cat + '</div>' +
             '<div class="rgood-s"><span>STOCK <b class="k">0</b></span>' +
               '<span>GROS ' + g.cost + '</span></div>' +
             '<div class="rgood-s"><span>DEMANDE</span><span>MARGE <b class="m">0</b></span></div>' +
             '<div class="rdem"><i></i></div>' +
             '<div class="rgood-c">' +
               '<button class="rmini" data-a="dn" type="button" title="Baisser le prix">&minus;</button>' +
               '<span class="rprice">0</span>' +
               '<button class="rmini" data-a="up" type="button" title="Monter le prix">+</button>' +
             '</div>' +
             '<div class="rgood-c">' +
               '<button class="rmini buy" data-a="buy" type="button">+5</button>' +
               (g.eat ? '<button class="rmini eat" data-a="eat" type="button">MANGER</button>' : '') +
             '</div>' +
           '</div>';
    }
    box.innerHTML = h;

    refs = [];
    var nodes = box.children;
    for (i = 0; i < nodes.length; i++){
      refs.push({
        root:  nodes[i],
        stock: nodes[i].querySelector(".k"),
        dem:   nodes[i].querySelector(".rdem"),
        bar:   nodes[i].querySelector(".rdem i"),
        price: nodes[i].querySelector(".rprice"),
        marge: nodes[i].querySelector(".m"),
        buy:   nodes[i].querySelector('[data-a="buy"]'),
        eat:   nodes[i].querySelector('[data-a="eat"]')
      });
    }
  }

  function paintGoods(){
    if (!refs) buildGoods();
    var i, g, r, att;
    for (i = 0; i < GOODS.length; i++){
      g = GOODS[i]; r = refs[i];
      r.stock.textContent = G.stock[i];
      r.stock.className = G.stock[i] > 0 ? "k" : "k no";
      r.price.textContent = Math.round(G.price[i]);
      var mg = Math.round(G.price[i] - g.cost);
      r.marge.textContent = (mg >= 0 ? "+" : "") + mg;
      r.marge.className = mg > 0 ? "m" : "m no";
      /* attrait : sous le prix conseille on s'arrache le rayon,
         au-dessus la clientele passe son chemin */
      att = clamp((1.55 - G.price[i] / g.base) / 1.1, 0, 1);
      r.bar.style.width = (att * 100).toFixed(0) + "%";
      r.dem.className = "rdem" + (att > .72 ? " hot" : (att < .3 ? " cold" : ""));
      r.root.classList.toggle("out", G.stock[i] <= 0);
      r.buy.textContent = "+5 · " + (g.cost * 5);
      r.buy.disabled = G.cash < g.cost * 5;
      if (r.eat) r.eat.disabled = G.stock[i] <= 0;
    }
  }

  function order(i, q){
    var c = GOODS[i].cost * q;
    if (G.cash < c){ say("Pas de quoi payer le grossiste.", "hit"); return; }
    G.cash -= c; G.spent += c; G.stock[i] += q;
    say("COMMANDE — " + q + " × " + GOODS[i].n + " (-" + money(c) + " CR)", "buy");
    needGoods = needHead = true; save();
  }

  function reprice(i, dir){
    var g = GOODS[i];
    G.price[i] = clamp(Math.round(G.price[i] + dir * Math.max(1, g.base * .06)),
                       Math.ceil(g.cost * .5), Math.round(g.base * 2.4));
    needGoods = true; save();
  }

  /* le patron se sert dans son propre rayon */
  function consume(i){
    var g = GOODS[i];
    if (!g.eat || G.stock[i] <= 0) return;
    G.stock[i]--;
    if (g.eat.fd)  G.fd  = clamp(G.fd + g.eat.fd, 0, 100);
    if (g.eat.en)  G.en  = clamp(G.en + g.eat.en, 0, 100);
    if (g.eat.fo)  G.fo  = clamp(G.fo + g.eat.fo, 0, 100);
    if (g.eat.inj) G.inj = clamp(G.inj + g.eat.inj, 0, 100);
    say("Il se sert : " + g.n + ". Le stock baisse, le corps remonte.", "buy");
    needGoods = needHead = true; save();
  }

  /* ============================================================
     ATELIER DU CORPS — attributs, entrainement, vivres,
     equipement, exosquelette, coach
     ============================================================ */

  var TABS = ["ATTRIBUTS","ENTRAÎNEMENT","VIVRES","ÉQUIPEMENT","EXOSQUELETTE","COACH"];
  var tab = 0;

  function bstr(b){
    var k, o = [], nm = { puis:"PUI", vit:"VIT", end:"END", gard:"GAR", ment:"MEN" };
    for (k in b) if (b[k]) o.push('<span class="rtag good">+' + b[k] + " " + nm[k] + "</span>");
    return o.join("");
  }

  function openUp(){
    el("r-mup").hidden = false;
    paintTabs(); paintTab();
  }
  function closeUp(){ el("r-mup").hidden = true; save(); }

  function paintTabs(){
    var h = "", i;
    for (i = 0; i < TABS.length; i++)
      h += '<button class="gtab' + (i === tab ? " on" : "") + '" data-t="' + i + '" type="button">' +
           TABS[i] + '</button>';
    el("r-tabs").innerHTML = h;
    el("r-upcash").textContent = money(G.cash);
    el("r-uppts").textContent = G.pts;
  }

  function paintTab(){
    var b = el("r-tabbody"), h = "", i, j, g, t, co, ok;

    if (tab === 0){
      h += '<p class="rhint">Chaque niveau donne un point. Les blessures rongent les ' +
           'valeurs effectives — la barre <b>cyan</b> est ce que le barda et le coach ajoutent.<br>' +
           'XP <b>' + G.xp + " / " + xpMax() + '</b> · POINTS LIBRES <b>' + G.pts + '</b></p>';
      h += '<div class="rcards">';
      for (i = 0; i < ATTRS.length; i++){
        var k = ATTRS[i].k, full = G.attr[k] >= 20;
        ok = G.pts > 0 && !full;
        h += '<button class="rcard' + (ok ? "" : " locked") + '" data-a="attr" data-k="' + k + '" type="button">' +
               '<div class="rcard-h"><b>' + ATTRS[i].n + '</b><em>' + G.attr[k] + ' / 20</em></div>' +
               '<p>' + ATTR_D[k] + '</p>' +
               '<div class="rcard-f"><span class="rtag' + (ok ? " good" : "") + '">' +
                 (full ? "AU MAXIMUM" : "1 POINT") + '</span></div>' +
             '</button>';
      }
      h += '</div>';
    }

    else if (tab === 1){
      h += '<p class="rhint">S\'entraîner coûte de l\'<b>énergie</b> mais monte la <b>forme</b>, ' +
           'qui décide de tes réserves sur le ring. La forme redescend seule : il faut y revenir.</p>';
      h += '<div class="rcards">';
      for (i = 0; i < TRAIN.length; i++){
        t = TRAIN[i];
        ok = G.en >= t.en && (!t.coach || (coach() && coach().spar));
        h += '<button class="rcard' + (ok ? "" : " locked") + '" data-a="train" data-i="' + i + '" type="button">' +
               '<div class="rcard-h"><b>' + t.n + '</b><em>-' + t.en + ' ÉN</em></div>' +
               '<p>' + t.d + '</p><div class="rcard-f">' +
               '<span class="rtag good">+' + t.fo + ' FORME</span>' +
               '<span class="rtag tech">+' + t.xp + ' XP</span>' +
               (t.inj > 0 ? '<span class="rtag bad">+' + t.inj + ' BLESS.</span>' : '') +
               (t.inj < 0 ? '<span class="rtag good">' + t.inj + ' BLESS.</span>' : '') +
               (t.coach && !(coach() && coach().spar) ? '<span class="rtag bad">COACH REQUIS</span>' : '') +
               '</div></button>';
      }
      h += '</div>';
    }

    else if (tab === 2){
      h += '<p class="rhint">Il mange ce qu\'il vend. La <b>satiété</b> tombe toute la journée ; ' +
           'à zéro, la récupération s\'effondre et la forme part avec.</p><div class="rcards">';
      for (i = 0; i < GOODS.length; i++){
        g = GOODS[i]; if (!g.eat) continue;
        ok = G.stock[i] > 0;
        h += '<button class="rcard' + (ok ? "" : " locked") + '" data-a="eat" data-i="' + i + '" type="button">' +
               '<div class="rcard-h"><b>' + g.n + '</b><em>' + G.stock[i] + ' EN STOCK</em></div>' +
               '<p>Valeur au comptoir : ' + Math.round(G.price[i]) + ' CR. Le manger, c\'est ne pas le vendre.</p>' +
               '<div class="rcard-f">' +
               (g.eat.fd ? '<span class="rtag good">+' + g.eat.fd + ' SATIÉTÉ</span>' : '') +
               (g.eat.en ? '<span class="rtag good">+' + g.eat.en + ' ÉNERGIE</span>' : '') +
               (g.eat.fo ? '<span class="rtag tech">+' + g.eat.fo + ' FORME</span>' : '') +
               (g.eat.inj ? '<span class="rtag tech">' + g.eat.inj + ' BLESS.</span>' : '') +
               '</div></button>';
      }
      h += '</div>';
    }

    else if (tab === 3){
      h += '<p class="rhint">Le barda se monte avec ce qui dort dans le rayon : certaines pièces ' +
           'demandent du <b>stock</b> en plus des crédits.</p><div class="rcards">';
      for (i = 0; i < GEAR.length; i++){
        g = GEAR[i];
        var lv = G.gear[g.k], nx = g.tiers[lv + 1];
        if (!nx){
          h += '<div class="rcard locked"><div class="rcard-h"><b>' + g.n + '</b><em>MAX</em></div>' +
               '<p>' + g.tiers[lv].n + ' — rien de mieux sur le marché.</p></div>';
          continue;
        }
        var needTxt = "", haveNeed = true;
        if (nx.need){
          haveNeed = G.stock[nx.need[0]] >= nx.need[1];
          needTxt = '<span class="rtag' + (haveNeed ? " tech" : " bad") + '">' +
                    nx.need[1] + ' × ' + GOODS[nx.need[0]].n + '</span>';
        }
        ok = G.cash >= nx.c && haveNeed;
        h += '<button class="rcard' + (ok ? "" : " locked") + '" data-a="gear" data-k="' + g.k + '" type="button">' +
               '<div class="rcard-h"><b>' + g.n + '</b><em>' + money(nx.c) + ' CR</em></div>' +
               '<p>' + g.tiers[lv].n + ' <s>//</s> <b style="color:#EDE7DA">' + nx.n + '</b></p>' +
               '<div class="rcard-f">' + bstr(nx.b) + needTxt + '</div>' +
             '</button>';
      }
      h += '</div>';
    }

    else if (tab === 4){
      var cur = EXO[G.exo], nx2 = EXO[G.exo + 1];
      h += '<p class="rhint">L\'exosquelette est l\'os d\'acier du siècle : il double la charge ' +
           'utile du corps. Il se nourrit de <b>cellules A-7</b> et de <b>plaques servo T-2</b>, ' +
           'les deux articles les plus chers de ton rayon.<br>' +
           'MONTÉ : <b>' + cur.n + '</b> · CELLULES EN STOCK <b>' + parts("cell") +
           '</b> · PLAQUES <b>' + parts("plate") + '</b></p><div class="rcards">';
      for (i = 1; i < EXO.length; i++){
        t = EXO[i];
        var owned = G.exo >= i, next = (i === G.exo + 1);
        ok = next && G.cash >= t.c && parts("cell") >= t.cell && parts("plate") >= t.plate;
        h += '<button class="rcard' + (owned ? " on" : (ok ? "" : " locked")) + '" data-a="exo" data-i="' + i + '" type="button">' +
               '<div class="rcard-h"><b>' + t.n + '</b><em' + (owned ? ' class="free"' : '') + '>' +
                 (owned ? "MONTÉ" : money(t.c) + " CR") + '</em></div>' +
               '<p>' + EXO_D[i] + '</p><div class="rcard-f">' + bstr(t.b) +
               (owned ? "" :
                 '<span class="rtag' + (parts("cell") >= t.cell ? " tech" : " bad") + '">' + t.cell + ' CELLULES</span>' +
                 (t.plate ? '<span class="rtag' + (parts("plate") >= t.plate ? " tech" : " bad") + '">' + t.plate + ' PLAQUES</span>' : '')) +
               '</div></button>';
      }
      h += '</div>';
    }

    else {
      h += '<p class="rhint">Le coach est le choix le plus lourd de la carrière : il te change ' +
           'sur le ring, dans le coin, et il prend son salaire <b>chaque soir</b>.</p><div class="rcards">';
      for (i = 0; i < COACHES.length; i++){
        co = COACHES[i];
        var hired = G.coach === i;
        ok = hired || G.cash >= co.hire;
        h += '<button class="rcard' + (hired ? " on" : (ok ? "" : " locked")) + '" data-a="coach" data-i="' + i + '" type="button">' +
               '<div class="rcard-h"><b>' + co.i + " " + co.n + '</b><em' + (hired ? ' class="free"' : '') + '>' +
                 (hired ? "DANS TON COIN" : money(co.hire) + " CR") + '</em></div>' +
               '<p>' + co.d + '</p><div class="rcard-f">';
        for (j = 0; j < co.tags.length; j++) h += '<span class="rtag good">' + co.tags[j] + '</span>';
        h += '<span class="rtag">' + co.pay + ' CR / JOUR</span>';
        if (hired) h += '<span class="rtag bad">CLIQUER POUR RENVOYER</span>';
        h += '</div></button>';
      }
      h += '</div>';
    }

    b.innerHTML = h;
    b.scrollTop = 0;
  }

  var ATTR_D = {
    puis: "Ce que le gant laisse derrière lui. Dégâts et probabilité de mise au tapis.",
    vit:  "Vitesse de main et de pied. Coups plus rapides, sortie de garde plus courte.",
    end:  "Réserves : points de vie et souffle sur le ring, plus la récupération.",
    gard: "Ce que la garde absorbe, et la stabilité quand un crochet passe.",
    ment: "Sang-froid : se relever après un compte, lire un adversaire, tenir la décision."
  };

  var EXO_D = [
    "",
    "Armature souple de chantier, sanglée sur le dos et les cuisses. Ça tient debout plus longtemps.",
    "Servomoteurs aux épaules et aux hanches. Le poing part avant que la pensée n'arrive.",
    "Maillage nerveux complet, dorsale en fibre. Le corps devient un outil de précision.",
    "Prototype de la Ceinture. Interdit sur trois planètes, toléré ici. On ne pose pas de questions."
  ];

  function gainXP(n){
    G.xp += n;
    while (G.xp >= xpMax()){
      G.xp -= xpMax(); G.lvl++; G.pts++;
      say("NIVEAU " + pad(G.lvl) + " — un point d'attribut à placer.", "win");
    }
  }

  function nope(){
    var p = el("r-mup").querySelector(".gpanel");
    p.classList.remove("nope"); void p.offsetWidth; p.classList.add("nope");
  }

  function upAction(a, k, i){
    if (a === "attr"){
      if (G.pts <= 0 || G.attr[k] >= 20){ nope(); return; }
      G.pts--; G.attr[k]++;
      say("Attribut monté : " + k.toUpperCase() + " " + G.attr[k] + ".", "buy");
    }
    else if (a === "train"){
      var t = TRAIN[i];
      if (G.en < t.en || (t.coach && !(coach() && coach().spar))){ nope(); return; }
      G.en = clamp(G.en - t.en, 0, 100);
      G.fo = clamp(G.fo + t.fo, 0, 100);
      G.inj = clamp(G.inj + t.inj, 0, 100);
      G.fd = clamp(G.fd - 4, 0, 100);
      gainXP(t.xp);
      say("SÉANCE — " + t.n + " (+" + t.fo + " forme, +" + t.xp + " XP).", "buy");
    }
    else if (a === "eat"){
      if (G.stock[i] <= 0){ nope(); return; }
      consume(i);
    }
    else if (a === "gear"){
      var g = null, j;
      for (j = 0; j < GEAR.length; j++) if (GEAR[j].k === k) g = GEAR[j];
      var nx = g.tiers[G.gear[k] + 1];
      if (!nx || G.cash < nx.c || (nx.need && G.stock[nx.need[0]] < nx.need[1])){ nope(); return; }
      G.cash -= nx.c;
      if (nx.need) G.stock[nx.need[0]] -= nx.need[1];
      G.gear[k]++;
      say("ÉQUIPÉ — " + nx.n + ".", "buy");
    }
    else if (a === "exo"){
      if (i !== G.exo + 1){ nope(); return; }
      var e = EXO[i];
      if (G.cash < e.c || parts("cell") < e.cell || parts("plate") < e.plate){ nope(); return; }
      G.cash -= e.c; takeParts("cell", e.cell); takeParts("plate", e.plate);
      G.exo = i;
      say("EXOSQUELETTE — " + e.n + " monté. Les servos sifflent.", "win");
    }
    else if (a === "coach"){
      if (G.coach === i){
        G.coach = -1;
        say(COACHES[i].n + " ramasse sa serviette et sort sans un mot.", "hit");
      } else {
        if (G.cash < COACHES[i].hire){ nope(); return; }
        G.cash -= COACHES[i].hire; G.coach = i;
        say(COACHES[i].n + " prend ton coin. " + COACHES[i].pay + " CR par soir.", "buy");
      }
    }
    needHead = needGoods = true;
    paintTabs(); paintTab(); paintHead(); paintGoods(); save();
  }

  /* ============================================================
     CARTE DES COMBATS — bots, puis file d'attente en reseau
     ============================================================ */

  var mmT = 0, mmOn = false;

  function openOps(){
    if (!ready()){ return; }
    el("r-mop").hidden = false;
    el("r-opelo").textContent = Math.round(G.elo);
    mmOn = false;
    paintOps();
  }
  function closeOps(){ mmOn = false; el("r-mop").hidden = true; }

  function paintOps(){
    var h = "", i, o, lock;
    h += '<p class="rhint">Ton ELO : <b>' + Math.round(G.elo) + '</b>. Les bourses montent avec ' +
         'le niveau du carton ; la fatigue aussi. Chaque victoire fait du bruit dans le quartier, ' +
         'et le bruit fait entrer du monde dans ta boutique.</p>';
    h += '<div class="rcards">';
    for (i = 0; i < BOTS.length; i++){
      o = BOTS[i];
      lock = o.elo > G.elo + 190;
      var pu = Math.round(o.purse * (coach() && coach().purse ? coach().purse : 1));
      h += '<button class="rcard' + (lock ? " locked" : "") + '" data-a="bot" data-i="' + i + '" type="button">' +
             '<div class="rcard-h"><b>' + o.n + '</b><em>' + money(pu) + ' CR</em></div>' +
             '<p>' + o.d + '</p><div class="rcard-f">' +
             '<span class="rtag tech">ELO ' + o.elo + '</span>' +
             '<span class="rtag">' + o.st + '</span>' +
             '<span class="rtag' + (o.elo > G.elo + 60 ? " bad" : " good") + '">' +
               (o.elo > G.elo + 60 ? "AU-DESSUS DE TOI" : "À TA PORTÉE") + '</span>' +
             (lock ? '<span class="rtag bad">HORS D\'ATTEINTE — MONTE L\'ELO</span>' : '') +
             '</div></button>';
    }
    h += '</div>';

    h += '<p class="rhint" style="margin-top:1.2em">RÉSEAU DE LA CEINTURE — ' +
         (G.wins >= 3
           ? 'file d\'attente ouverte. L\'appariement cherche un adversaire à <b>±90 ELO</b>.'
           : 'verrouillé : il faut <b>3 victoires</b> pour entrer dans la file (' + G.wins + '/3).') +
         '</p>';
    h += '<div class="rcards tight"><button class="rcard' + (G.wins >= 3 ? "" : " locked") +
         '" data-a="mm" type="button">' +
         '<div class="rcard-h"><b>APPARIEMENT CLASSÉ</b><em>±90 ELO</em></div>' +
         '<p>Un vrai adversaire, à ton niveau. La bourse dépend de son ELO, et ta défaite se paie ' +
         'en points de classement.</p><div class="rcard-f">' +
         '<span class="rtag tech">JOUEUR</span><span class="rtag">ELO EN JEU</span>' +
         '</div></button></div>';

    el("r-opbody").innerHTML = h;
  }

  /* un adversaire du reseau : profil derive de l'ELO, appariement serre.
     Le jour ou un serveur repondra, c'est cet objet qu'il renverra. */
  function mkPlayer(){
    var elo = clamp(G.elo + rand(-90, 90), 820, 2200);
    var k = (elo - 860) / 800;
    return {
      n: pick(PSEUDOS), st: pick(["PRESSION","CONTRE","VITESSE","PUNCHEUR","TECHNIQUE"]),
      elo: Math.round(elo), hp: 100 + k * 88, pw: .86 + k * .68, sp: .86 + k * .48,
      gd: .72 + k * .58, ag: rand(.55, .85), purse: Math.round(210 + k * 1500),
      player: true, d: "Adversaire apparié sur le réseau de la Ceinture."
    };
  }

  function searchMM(){
    mmOn = true;
    el("r-opbody").innerHTML =
      '<div class="rsearch"><div class="rspin"></div><b>APPARIEMENT EN COURS</b>' +
      '<span>File classée · ELO ' + Math.round(G.elo) + ' ±90<br>' +
      'On cherche quelqu\'un qui vaut exactement ta peine.</span></div>';
    mmT = rand(1.4, 2.9);
  }

  /* ============================================================
     LE COMBAT — vue de cote, ring sureleve, soleil par le haut
     ============================================================ */

  var ROUND_T = 40, REST_T = 6, REACH = 14, RING_L = 14, RING_R = 86, GAP = 12;

  var PUNCH = {
    jab:   { wind:.08, hit:.07, rec:.15, dmg:5.5,  st:6,  reach:1.00, p:1, n:"JAB" },
    cross: { wind:.14, hit:.08, rec:.26, dmg:10.5, st:11, reach:1.07, p:2, n:"DIRECT" },
    hook:  { wind:.23, hit:.09, rec:.36, dmg:17.5, st:16, reach:.92,  p:3, n:"CROCHET" }
  };

  var F = { on:false };

  function mkFighter(P, x, face, name, tag){
    return {
      n:name, tag:tag, P:P, x:x, face:face,
      hp:P.hpMax, hpMax:P.hpMax, st:P.stMax, stMax:P.stMax,
      act:null, guard:false, guardT:0, slip:0, stun:0,
      down:0, pts:0, land:0, thrown:0, blocked:0,
      bob:rand(0,6.28), lean:0, hurt:0, flash:0, think:0, ag:.6, style:"", rise:0
    };
  }

  function playerParams(){
    var e = eff();
    return {
      hpMax: 92 + e.end * 7 + G.fo * .5,
      stMax: 78 + e.end * 5 + G.fo * .35,
      dmg:   .72 + e.puis * .075,
      spd:   .82 + e.vit * .032,
      blk:   .30 / (1 + e.gard * .055),
      chin:  1 + e.ment * .035,
      rec:   11 + e.end * .85,
      reach: 1 + e.vit * .004
    };
  }

  function botParams(o){
    return {
      hpMax: o.hp, stMax: 80 + o.hp * .3,
      dmg: .92 * o.pw, spd: .9 * o.sp,
      blk: .30 / o.gd, chin: o.gd, rec: 9 + o.gd * 5, reach: 1 + (o.sp - 1) * .05
    };
  }

  function startFight(o){
    var titled = o.elo >= 1650;
    F = {
      on:true, foe:o, round:1, rounds: titled ? 5 : 3,
      t:ROUND_T, phase:"intro", pt:2.2, count:0, cnt:0, downOf:null,
      cards:[], shake:0, sun:0, flash:0, bubble:null, bubT:0, sayT:4,
      a: mkFighter(playerParams(), 32, 1, "RŌNIN", EXO[G.exo].n),
      b: mkFighter(botParams(o), 68, -1, o.n, o.st)
    };
    F.b.ag = o.ag; F.b.style = o.st;

    closeOps();
    el("r-mup").hidden = true;
    el("r-hud").hidden = false;
    /* le bandeau passe en display:none : on ne laisse pas le focus dessus */
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    el("r-p1n").textContent = "RŌNIN";
    el("r-p1t").textContent = EXO[G.exo].n === "AUCUN" ? "SANS EXO" : EXO[G.exo].n;
    el("r-p2n").textContent = o.n;
    el("r-p2t").textContent = (o.player ? "JOUEUR · " : "") + o.st + " · ELO " + o.elo;
    cue(o.player ? "APPARIÉ" : "SUR LE RING", o.n);
    say("COMBAT — " + o.n + " (ELO " + o.elo + ").", "hit");
    needHead = true;
    document.body.classList.add("in-bout");
    hudFight();
  }

  function endBout(){
    F.on = false;
    el("r-hud").hidden = true;
    document.body.classList.remove("in-bout");
  }

  var sparks = [], keys = {};

  function spark(f, txt, col){
    sparks.push({ x:f.x, y:rand(-2,2), t:.75, s:txt, c:col || "#EDE7DA" });
    if (sparks.length > 14) sparks.shift();
  }

  function cue(a, b){
    var c = el("r-cue");
    el("r-cuet").textContent = a;
    el("r-cues").textContent = b || "";
    c.hidden = false;
    var t = el("r-cuet");
    t.style.animation = "none"; void t.offsetWidth; t.style.animation = "";
    F.cueT = 1.5;
  }

  function bubble(txt){ F.bubble = txt; F.bubT = 2.6; }

  function coachSay(force){
    var co = coach(); if (!co) return;
    bubble(force || pick(co.say));
  }

  function punch(f, kind){
    if (f.act || f.stun > 0 || f.slip > 0 || F.phase !== "fight") return;
    var pt = PUNCH[kind];
    var cost = pt.st * (1 - (f.P.rec - 11) * .006);
    var weak = f.st < cost;
    f.st = Math.max(0, f.st - cost * (weak ? .55 : 1));
    var sp = f.P.spd * (weak ? .7 : 1) * (f.st < f.stMax * .25 ? .86 : 1);
    f.act = { k:kind, ph:"wind", tt:pt.wind / sp, weak:weak, sp:sp, pun:false };
    f.thrown++; f.guard = false; f.guardT = 0;
  }

  function resolve(f, o){
    var pt = PUNCH[f.act.k];
    var d = Math.abs(f.x - o.x);
    var facing = (o.x - f.x) * f.face > 0;
    if (!facing || d > REACH * pt.reach * f.P.reach + 4.5) return;

    if (o.slip > 0){ f.act.pun = true; spark(o, "ESQUIVE", "#5FEBF7"); return; }

    var dmg = pt.dmg * f.P.dmg * (f.act.weak ? .55 : 1) * rand(.9, 1.12);

    if (o.guard){
      dmg *= o.P.blk;
      o.st = Math.max(0, o.st - dmg * 1.8);
      o.hp -= dmg; o.flash = .1; o.blocked++;
      spark(o, "GARDE", "#FFC66B");
      if (o.st <= 0){ o.guard = false; o.guardT = 0; o.stun = .3; spark(o, "GARDE BRISÉE", "#FF4D00"); }
    } else {
      o.hp -= dmg;
      o.stun = Math.min(.6, .12 + dmg * .016) / o.P.chin;
      o.hurt = .4; o.flash = .22;
      f.pts += pt.p; f.land++;
      F.shake = Math.min(1, F.shake + dmg * .022);
      F.flash = .12;
      spark(o, pt.n, "#FF4D00");
    }
    if (o.hp <= 0) knock(o);
  }

  function knock(o){
    o.hp = 0; o.down++; o.rise = 0; o.act = null; o.guard = false;
    F.phase = "down"; F.downOf = o; F.count = 0; F.pt = .7;
    cue("AU TAPIS", o === F.a ? "MARTÈLE A POUR TE RELEVER" : o.n + " EST À TERRE");
    coachSay(o === F.a ? "DEBOUT ! DEBOUT !" : "RESTE FROID.");
  }

  function getUp(o){
    o.hp = o.hpMax * .32; o.st = Math.max(o.st, o.stMax * .45);
    o.stun = .35; F.phase = "fight"; F.downOf = null;
    F.a.x = clamp(F.a.x - 4, RING_L, RING_R);
    F.b.x = clamp(F.b.x + 4, RING_L, RING_R);
    cue("BOXEZ", "");
  }

  /* --- l'automate de l'adversaire --- */

  function ai(f, o, dt){
    if (F.phase !== "fight") return;
    f.think -= dt;
    var d = Math.abs(f.x - o.x), rch = REACH * f.P.reach;

    /* il voit venir le coup : garde ou pas de cote, selon sa defense */
    if (o.act && o.act.ph === "wind" && d < rch + 6 && !f.act){
      if (Math.random() < .06 * f.P.chin){ f.slip = .22; f.slipCd = .7; return; }
      if (Math.random() < .12 * f.P.chin){ f.guardT = rand(.25, .6); }
    }
    if (f.act || f.stun > 0 || f.slip > 0) return;

    f.guard = f.guardT > 0;
    if (f.guardT > 0){ f.guardT -= dt; f.x += (d < rch * .7 ? -f.face : 0) * 8 * dt; return; }

    if (f.think > 0){
      /* il gere la distance en attendant sa fenetre */
      var want = rch * (f.style === "CONTRE" ? 1.15 : (f.style === "PRESSION" ? .72 : .95));
      var dir = d > want ? 1 : (d < want * .78 ? -1 : 0);
      f.x += dir * f.face * 15 * f.P.spd * dt;
      return;
    }

    f.think = rand(.22, .8) / f.P.spd * (1.35 - f.ag);
    if (d <= rch + 4){
      if (Math.random() < f.ag + (f.st < f.stMax * .3 ? -.25 : 0)){
        var r = Math.random(), k;
        if (f.style === "PUNCHEUR")      k = r < .4 ? "hook"  : (r < .75 ? "cross" : "jab");
        else if (f.style === "VITESSE")  k = r < .55 ? "jab"  : (r < .9  ? "cross" : "hook");
        else if (f.style === "PRESSION") k = r < .35 ? "jab"  : (r < .8  ? "cross" : "hook");
        else                             k = r < .45 ? "jab"  : (r < .85 ? "cross" : "hook");
        punch(f, k);
        var co = coach();
        if (co && co.tell && k === "hook") bubble("ANALYSE : CROCHET.");
      } else if (Math.random() < .35){ f.guardT = rand(.3, .8); }
      else f.x -= f.face * 12 * dt;
    } else {
      f.x += f.face * 16 * f.P.spd * dt;
    }
  }

  /* --- un tour de combat --- */

  function fightTick(dt){
    var a = F.a, b = F.b, i;

    if (F.cueT > 0){ F.cueT -= dt; if (F.cueT <= 0) el("r-cue").hidden = true; }
    if (F.shake > 0) F.shake = Math.max(0, F.shake - dt * 2.4);
    if (F.flash > 0) F.flash = Math.max(0, F.flash - dt * 4);
    if (F.bubT > 0){ F.bubT -= dt; if (F.bubT <= 0) F.bubble = null; }
    for (i = sparks.length - 1; i >= 0; i--){ sparks[i].t -= dt; if (sparks[i].t <= 0) sparks.splice(i, 1); }

    if (F.phase === "intro"){
      F.pt -= dt;
      if (F.pt <= 0){ F.phase = "fight"; F.t = ROUND_T; cue("ROUND 1", "BOXEZ"); coachSay(); }
      return;
    }

    if (F.phase === "rest"){
      F.pt -= dt;
      a.hp = Math.min(a.hpMax, a.hp + a.hpMax * .06 * dt);
      b.hp = Math.min(b.hpMax, b.hp + b.hpMax * .06 * dt);
      a.st = Math.min(a.stMax, a.st + a.P.rec * 2.2 * dt);
      b.st = Math.min(b.stMax, b.st + b.P.rec * 2.2 * dt);
      if (F.pt <= 0){
        F.round++; F.t = ROUND_T; F.phase = "fight";
        a.x = 32; b.x = 68;
        cue("ROUND " + F.round, "");
      }
      return;
    }

    if (F.phase === "down"){
      var o = F.downOf;
      F.pt -= dt;
      if (F.pt <= 0){
        F.count++; F.pt = .68;
        cue(String(F.count), "COMPTE");
        if (F.count >= 10){ finish(o !== F.a, o !== F.a ? "K.-O." : "K.-O. SUBI"); return; }
      }
      if (o === a){
        if (a.rise >= 7 + a.down * 3 && F.count >= 2) getUp(a);
      } else if (F.count >= 2 && Math.random() < .55 * b.P.chin * dt * 3){
        getUp(b);
      }
      /* trois visites au tapis dans le combat : l'arbitre arrete tout */
      if (o.down >= 3 && F.phase === "down"){ finish(o !== a, "ARRÊT DE L'ARBITRE"); }
      return;
    }

    if (F.phase !== "fight") return;

    F.t -= dt;
    F.sayT -= dt;
    if (F.sayT <= 0){ F.sayT = rand(6, 11); coachSay(); }

    /* --- le joueur --- */
    a.guard = !!(keys.s || keys.arrowdown || keys.shift);
    if (a.slipCd > 0) a.slipCd -= dt;
    if ((keys.z || keys.arrowup || keys[" "]) && a.slip <= 0 && (a.slipCd || 0) <= 0 && a.st > 8){
      a.slip = .24; a.slipCd = .8; a.st -= 8;
    }
    if (!a.act && a.stun <= 0 && a.slip <= 0){
      if (keys.a || keys.j) punch(a, "jab");
      else if (keys.e || keys.k) punch(a, "cross");
      else if (keys.r || keys.l) punch(a, "hook");
    }
    var mv = (keys.d || keys.arrowright ? 1 : 0) - (keys.q || keys.arrowleft ? 1 : 0);
    if (a.stun <= 0){
      var sp = 17 * a.P.spd * (a.guard ? .5 : 1) * (a.act ? .28 : 1) * (a.st < a.stMax * .2 ? .72 : 1);
      a.x += mv * sp * dt;
    }

    ai(b, a, dt);

    /* --- les deux corps --- */
    var fs = [a, b];
    for (i = 0; i < 2; i++){
      var f = fs[i];
      if (f.stun > 0) f.stun -= dt;
      if (f.slip > 0) f.slip -= dt;
      if (f.hurt > 0) f.hurt -= dt * 2;
      if (f.flash > 0) f.flash -= dt * 5;
      f.bob += dt * (2.6 + (f.act ? 2 : 0));
      f.x = clamp(f.x, RING_L, RING_R);

      if (f.guard) f.st = Math.max(0, f.st - 4 * dt);
      else if (!f.act) f.st = Math.min(f.stMax, f.st + f.P.rec * dt);
      else f.st = Math.min(f.stMax, f.st + f.P.rec * .2 * dt);

      if (f.act){
        f.act.tt -= dt;
        if (f.act.tt <= 0){
          var pt = PUNCH[f.act.k];
          if (f.act.ph === "wind"){
            f.act.ph = "hit"; f.act.tt = pt.hit / f.act.sp;
            resolve(f, f === a ? b : a);
          } else if (f.act.ph === "hit"){
            f.act.ph = "rec"; f.act.tt = pt.rec / f.act.sp * (f.act.pun ? 1.7 : 1);
          } else f.act = null;
        }
      }
    }

    /* on ne se traverse pas */
    var gap = b.x - a.x;
    if (gap < GAP){ var push = (GAP - gap) / 2; a.x -= push; b.x += push; }
    a.face = 1; b.face = -1;

    if (F.t <= 0){
      F.cards.push([a.pts, b.pts]);
      if (F.round >= F.rounds){ finish(null, "DÉCISION"); return; }
      F.phase = "rest"; F.pt = REST_T;
      cue("FIN DU ROUND " + F.round, "REPOS " + REST_T + " S");
      coachSay();
    }
  }

  function finish(win, how){
    var a = F.a, b = F.b, o = F.foe, co = coach();
    F.phase = "end";

    /* la carte des juges : les points marques, les visites au tapis pesent lourd */
    var sa = a.pts + b.down * 8, sb = b.pts + a.down * 8;
    if (win === null) win = sa > sb;
    var draw = (win === null || sa === sb) && how === "DÉCISION" && sa === sb;

    var purse = o.purse * (co && co.purse ? co.purse : 1);
    var pay = Math.round(win ? purse : purse * .34);
    var xp = Math.round(win ? 42 + o.elo * .05 : 18 + o.elo * .022);
    var expct = 1 / (1 + Math.pow(10, (o.elo - G.elo) / 400));
    var dElo = Math.round(26 * ((draw ? .5 : (win ? 1 : 0)) - expct));

    G.cash += pay;
    G.elo = clamp(G.elo + dElo, 700, 2600);
    if (!draw){ if (win) G.wins++; else G.losses++; }
    if (win && how.indexOf("K.-O.") === 0) G.kos++;
    G.rep = clamp(G.rep + (win ? 6.5 : 1.8), 0, 100);
    gainXP(xp);

    /* le prix du corps */
    var taken = clamp((a.hpMax - Math.max(0, a.hp)) / a.hpMax, 0, 1);
    G.en = clamp(G.en - (32 + F.round * 6 + (win ? 0 : 8)), 0, 100);
    G.inj = clamp(G.inj + taken * 44 + a.down * 8, 0, 100);
    G.fd = clamp(G.fd - 14, 0, 100);
    G.rest = (100 + F.round * 10 + G.inj * .7) * (co && co.cool ? co.cool : 1);
    if (G.wins >= 3) G.mmOK = true;

    say((win ? "VICTOIRE" : (draw ? "NUL" : "DÉFAITE")) + " contre " + o.n +
        " — " + how + " (+" + money(pay) + " CR).", win ? "win" : "hit");

    el("r-endcard").textContent = how;
    el("r-endb").innerHTML =
      '<div class="rend-v ' + (draw ? "" : (win ? "w" : "l")) + '">' +
        (draw ? "MATCH NUL" : (win ? "VICTOIRE" : "DÉFAITE")) + '</div>' +
      '<div class="rend-s">' + o.n + ' <s>//</s> ' + how + ' <s>//</s> ROUND ' + F.round + '</div>' +
      '<div class="rend-l"><span>CARTE DES JUGES</span><b>' + Math.round(sa) + " – " + Math.round(sb) + '</b></div>' +
      '<div class="rend-l"><span>COUPS PLACÉS / LANCÉS</span><b>' + a.land + " / " + a.thrown + '</b></div>' +
      '<div class="rend-l"><span>VISITES AU TAPIS</span><b>' + a.down + " – " + b.down + '</b></div>' +
      '<div class="rend-l"><span>BOURSE</span><b>+' + money(pay) + ' CR</b></div>' +
      '<div class="rend-l"><span>EXPÉRIENCE</span><b>+' + xp + ' XP</b></div>' +
      '<div class="rend-l"><span>CLASSEMENT</span><b>' + (dElo >= 0 ? "+" : "") + dElo +
        ' → ' + Math.round(G.elo) + '</b></div>' +
      '<div class="rend-l"><span>ÉTAT DU CORPS</span><b>ÉNERGIE ' + Math.round(G.en) +
        ' · BLESSURES ' + Math.round(G.inj) + '</b></div>' +
      '<div class="rend-l"><span>REPOS IMPOSÉ</span><b>' + mmss(G.rest) + '</b></div>';
    el("r-mend").hidden = false;
    needHead = needGoods = true;
    save();
  }

  function quit(){
    if (!F.on) return;
    if (F.phase === "end"){ el("r-mend").hidden = true; endBout(); paintHead(); return; }
    finish(false, "ABANDON DU COIN");
  }

  /* --- l'etat affiche pendant le combat --- */

  function hudFight(){
    var a = F.a, b = F.b, i, h;
    bar("r-p1hp", a.hp / a.hpMax * 100);
    bar("r-p2hp", b.hp / b.hpMax * 100);
    bar("r-p1st", a.st / a.stMax * 100);
    bar("r-p2st", b.st / b.stMax * 100);
    h = ""; for (i = 0; i < 3; i++) h += '<u class="' + (i < a.down ? "on" : "") + '"></u>';
    el("r-p1dn").innerHTML = h;
    h = ""; for (i = 0; i < 3; i++) h += '<u class="' + (i < b.down ? "on" : "") + '"></u>';
    el("r-p2dn").innerHTML = h;
  }

  /* ============================================================
     PEINTURE — deux decors sur le meme fond :
     l'echoppe quand on gere, le ring quand on boxe.
     ============================================================ */

  var RX0 = 0, RX1 = 0, RY = 0, FY = 0, FS = 0, dust = [], crowd2 = [];

  function resize(){
    if (!cvs) return;
    W = cvs.clientWidth; H = cvs.clientHeight;
    cvs.width = Math.round(W * DPR); cvs.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    S = Math.max(.6, Math.min(1.4, Math.min(W / 1500, H / 860)));

    var cw = Math.min(W * .74, H * 1.5);
    RX0 = W * .5 - cw / 2; RX1 = W * .5 + cw / 2;
    RY = H * .70; FY = H * .86; FS = cw * .27;

    dust.length = 0;
    for (var i = 0; i < 70; i++)
      dust.push({ x:Math.random(), y:Math.random(), s:rand(.6, 2.1), v:rand(.004, .02), ph:rand(0, 6.3) });
    crowd2.length = 0;
    for (i = 0; i < 90; i++)
      crowd2.push({ x:Math.random(), r:rand(.55, 1), ph:rand(0, 6.3), fl:0 });
  }

  function ux(u){ return RX0 + (u / 100) * (RX1 - RX0); }

  /* 0 a l'aube, 1 en plein midi, retour a 0 la nuit */
  function daylight(){
    var h = G.clock / 60;
    if (h < 8) return 0;
    if (h > 21) return 0;
    return clamp(Math.sin((h - 7) / 15 * Math.PI), 0, 1);
  }

  /* --- l'echoppe : fond d'atmosphere derriere les panneaux --- */

  function drawShop(t){
    var d = daylight();
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "rgba(26,20,17," + (.9 - d * .25).toFixed(3) + ")");
    g.addColorStop(.55, "rgba(12,11,12,.96)");
    g.addColorStop(1, "rgba(6,6,8,1)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    /* la baie vitree, a droite : c'est par la que le soleil entre */
    var wx = W * .70, ww = W * .34, wy = H * .06, wh = H * .58;
    ctx.save();
    ctx.beginPath(); ctx.rect(wx, wy, ww, wh); ctx.clip();
    var sg = ctx.createLinearGradient(wx, wy, wx, wy + wh);
    sg.addColorStop(0, "rgba(255,198,107," + (.05 + d * .30).toFixed(3) + ")");
    sg.addColorStop(1, "rgba(255,77,0," + (.02 + d * .06).toFixed(3) + ")");
    ctx.fillStyle = sg; ctx.fillRect(wx, wy, ww, wh);
    /* silhouettes de la rue */
    ctx.fillStyle = "rgba(8,8,10,.72)";
    for (var i = 0; i < 7; i++){
      var bx = wx + (i / 7) * ww, bw = ww / 7 * rand(.7, .95);
      ctx.fillRect(bx, wy + wh * rand(.28, .62), bw, wh);
    }
    ctx.restore();
    ctx.strokeStyle = "rgba(237,231,218,.14)"; ctx.lineWidth = 2;
    ctx.strokeRect(wx, wy, ww, wh);
    ctx.beginPath();
    ctx.moveTo(wx + ww / 2, wy); ctx.lineTo(wx + ww / 2, wy + wh);
    ctx.moveTo(wx, wy + wh * .5); ctx.lineTo(wx + ww, wy + wh * .5);
    ctx.stroke();

    /* rai de lumiere jete sur le sol */
    if (d > .05){
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      var lg = ctx.createLinearGradient(wx, wy, wx - W * .3, H);
      lg.addColorStop(0, "rgba(255,198,107," + (d * .13).toFixed(3) + ")");
      lg.addColorStop(1, "rgba(255,198,107,0)");
      ctx.fillStyle = lg;
      ctx.beginPath();
      ctx.moveTo(wx, wy); ctx.lineTo(wx + ww, wy + wh * .2);
      ctx.lineTo(wx + ww * .3, H); ctx.lineTo(wx - W * .28, H);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }

    /* sacs de frappe suspendus, a gauche */
    for (i = 0; i < 3; i++){
      var bx2 = W * (.07 + i * .085), sw = W * .022, sh = H * (.20 + i * .03);
      var sway = Math.sin(t * .0007 + i * 2) * W * .004;
      ctx.strokeStyle = "rgba(237,231,218,.16)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(bx2, 0); ctx.lineTo(bx2 + sway, H * .16); ctx.stroke();
      ctx.fillStyle = "rgba(18,16,17,.86)";
      ctx.fillRect(bx2 + sway - sw / 2, H * .16, sw, sh);
      ctx.strokeStyle = "rgba(255,77,0,.20)";
      ctx.strokeRect(bx2 + sway - sw / 2, H * .16, sw, sh);
    }

    /* poussiere dans la lumiere */
    for (i = 0; i < dust.length; i++){
      var p = dust[i];
      p.y -= p.v * .004; if (p.y < 0) p.y = 1;
      ctx.fillStyle = "rgba(255,220,170," + (.05 + .09 * Math.sin(t * .002 + p.ph)).toFixed(3) + ")";
      ctx.fillRect(p.x * W, p.y * H, p.s, p.s);
    }
  }

  /* --- le ring : vue de cote, plateau sureleve, soleil par le haut --- */

  function drawRing(t){
    var pad = (RX1 - RX0) * .05;
    var postH = FS * .95;
    var apron = FY - RY;

    /* le hall */
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "rgba(30,26,22,1)");
    g.addColorStop(.42, "rgba(14,12,13,1)");
    g.addColorStop(1, "rgba(5,5,7,1)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    /* la lumiere du jour tombe de la verriere, droit sur le tapis */
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    var cxm = (RX0 + RX1) / 2;
    var sg = ctx.createLinearGradient(0, 0, 0, RY);
    sg.addColorStop(0, "rgba(255,232,190,.22)");
    sg.addColorStop(.6, "rgba(255,205,140,.10)");
    sg.addColorStop(1, "rgba(255,180,110,.02)");
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.moveTo(cxm - (RX1 - RX0) * .16, 0);
    ctx.lineTo(cxm + (RX1 - RX0) * .16, 0);
    ctx.lineTo(RX1 + pad * 1.6, RY);
    ctx.lineTo(RX0 - pad * 1.6, RY);
    ctx.closePath(); ctx.fill();
    /* deux rais plus francs */
    for (var i = -1; i <= 1; i += 2){
      ctx.fillStyle = "rgba(255,240,210,.05)";
      ctx.beginPath();
      ctx.moveTo(cxm + i * (RX1 - RX0) * .06, 0);
      ctx.lineTo(cxm + i * (RX1 - RX0) * .10, 0);
      ctx.lineTo(cxm + i * (RX1 - RX0) * .34, RY);
      ctx.lineTo(cxm + i * (RX1 - RX0) * .22, RY);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();

    /* la verriere, tout en haut */
    ctx.strokeStyle = "rgba(255,232,190,.16)"; ctx.lineWidth = 2;
    for (i = 0; i < 6; i++){
      var gx = cxm - (RX1 - RX0) * .16 + i * ((RX1 - RX0) * .32 / 5);
      ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H * .045); ctx.stroke();
    }
    ctx.fillStyle = "rgba(255,240,215,.10)";
    ctx.fillRect(cxm - (RX1 - RX0) * .17, 0, (RX1 - RX0) * .34, H * .012);

    /* la foule du fond : vue de cote et a hauteur de ring, on ne voit
       d'elle que les tetes qui depassent au-dessus du tapis. */
    for (i = 0; i < crowd2.length; i++){
      var c = crowd2[i];
      var row = i % 4;
      var cy = RY - FS * .07 - row * FS * .085;
      var cx = c.x * W + Math.sin(t * .0012 + c.ph) * 2;
      var r = FS * .035 * c.r * (1 - row * .12);
      ctx.fillStyle = "rgba(8,8,10,.9)";
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, 6.2832); ctx.fill();
      ctx.fillRect(cx - r, cy, r * 2, r * 2.4);
      /* un flash d'appareil de temps en temps */
      if (c.fl > 0){
        c.fl -= .16;
        ctx.save(); ctx.globalCompositeOperation = "lighter";
        ctx.fillStyle = "rgba(255,250,225," + Math.max(0, c.fl).toFixed(2) + ")";
        ctx.beginPath(); ctx.arc(cx, cy - r * .6, r * .7, 0, 6.2832); ctx.fill();
        ctx.restore();
      } else if (Math.random() < .0012) c.fl = 1;
    }

    /* le plateau : jupe et tapis */
    ctx.fillStyle = "rgba(12,11,12,.98)";
    ctx.fillRect(RX0 - pad * 1.7, RY, (RX1 - RX0) + pad * 3.4, apron);
    ctx.save();
    ctx.beginPath(); ctx.rect(RX0 - pad * 1.7, RY + apron * .18, (RX1 - RX0) + pad * 3.4, apron * .46);
    ctx.clip();
    ctx.strokeStyle = "rgba(255,77,0,.55)"; ctx.lineWidth = apron * .1;
    for (i = -2; i < 40; i++){
      var sx = RX0 - pad * 2 + i * apron * .34;
      ctx.beginPath(); ctx.moveTo(sx, RY + apron); ctx.lineTo(sx + apron * .6, RY); ctx.stroke();
    }
    ctx.restore();
    ctx.strokeStyle = "rgba(237,231,218,.5)"; ctx.lineWidth = 2;
    ctx.strokeRect(RX0 - pad * 1.7, RY, (RX1 - RX0) + pad * 3.4, apron);

    /* le tapis vu de cote : une bande claire eclairee par le haut */
    var mg = ctx.createLinearGradient(0, RY - FS * .04, 0, RY + 4);
    mg.addColorStop(0, "rgba(240,232,214,.30)");
    mg.addColorStop(1, "rgba(150,140,126,.16)");
    ctx.fillStyle = mg;
    ctx.fillRect(RX0 - pad * 1.7, RY - FS * .035, (RX1 - RX0) + pad * 3.4, FS * .035 + 3);
    ctx.fillStyle = "rgba(237,231,218,.85)";
    ctx.fillRect(RX0 - pad * 1.7, RY - 2, (RX1 - RX0) + pad * 3.4, 3);

    drawRopes(t, pad, postH, false);
    drawCoach(t, pad, apron);
    drawCorner(t, pad, apron);

    /* les deux boxeurs */
    if (F.downOf === F.b) drawDown(F.b, BOT_COL); else drawFighter(F.b, BOT_COL, t);
    if (F.downOf === F.a) drawDown(F.a, PL_COL);  else drawFighter(F.a, PL_COL, t);

    /* impacts */
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (i = 0; i < sparks.length; i++){
      var sp = sparks[i], a = clamp(sp.t / .75, 0, 1);
      var sxx = ux(sp.x), syy = RY - FS * .98 + sp.y * FS * .04 - (1 - a) * FS * .26;
      ctx.globalAlpha = a;
      ctx.fillStyle = sp.c;
      ctx.font = "700 " + Math.round(FS * .085) + "px 'Space Mono', monospace";
      ctx.fillText(sp.s, sxx, syy);
      ctx.globalAlpha = 1;
    }

    drawRopes(t, pad, postH, true);
    drawBoard(t);

    if (F.flash > 0){
      ctx.fillStyle = "rgba(255,240,220," + (F.flash * .5).toFixed(3) + ")";
      ctx.fillRect(0, 0, W, H);
    }
  }

  function drawRopes(t, pad, postH, front){
    var PX0 = RX0 - pad * .6, PX1 = RX1 + pad * .6, i, y, sag;

    if (!front){
      /* les cordes du fond, plus sourdes */
      for (i = 0; i < 4; i++){
        y = RY - FS * .06 - i * postH * .22 - FS * .02;
        ctx.strokeStyle = "rgba(237,231,218,.16)"; ctx.lineWidth = Math.max(1, FS * .012);
        ctx.beginPath(); ctx.moveTo(PX0, y); ctx.lineTo(PX1, y); ctx.stroke();
      }
      /* les poteaux */
      for (i = 0; i < 2; i++){
        var px = i ? PX1 : PX0;
        ctx.fillStyle = "rgba(20,20,22,.98)";
        ctx.fillRect(px - FS * .022, RY - postH, FS * .044, postH);
        ctx.strokeStyle = "rgba(237,231,218,.55)"; ctx.lineWidth = 2;
        ctx.strokeRect(px - FS * .022, RY - postH, FS * .044, postH);
        /* le boudin de coin */
        ctx.fillStyle = "rgba(255,77,0,.9)";
        ctx.fillRect(px - FS * .034, RY - postH * .96, FS * .068, postH * .82);
        ctx.fillStyle = "rgba(10,10,11,.35)";
        for (var j = 0; j < 4; j++)
          ctx.fillRect(px - FS * .034, RY - postH * .96 + j * postH * .21, FS * .068, postH * .03);
        /* embout */
        ctx.fillStyle = "rgba(95,235,247,.55)";
        ctx.fillRect(px - FS * .03, RY - postH - FS * .03, FS * .06, FS * .034);
      }
      return;
    }

    /* les cordes de devant : elles passent sur les corps */
    for (i = 0; i < 4; i++){
      y = RY - FS * .06 - i * postH * .22;
      sag = FS * .012 + Math.sin(t * .0016 + i) * FS * .004;
      ctx.strokeStyle = i === 1 || i === 2 ? "rgba(255,77,0,.55)" : "rgba(237,231,218,.52)";
      ctx.lineWidth = Math.max(1.4, FS * .016);
      ctx.beginPath();
      ctx.moveTo(PX0, y);
      ctx.quadraticCurveTo((PX0 + PX1) / 2, y + sag * 2, PX1, y);
      ctx.stroke();
      /* reflet du soleil sur la corde */
      ctx.strokeStyle = "rgba(255,240,210,.22)"; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(PX0, y - FS * .006);
      ctx.quadraticCurveTo((PX0 + PX1) / 2, y + sag * 2 - FS * .006, PX1, y - FS * .006);
      ctx.stroke();
    }
  }

  /* le coach, dehors, en bas a gauche */
  function drawCoach(t, pad, apron){
    var co = coach();
    var x = RX0 - pad * 1.9, y = FY + apron * .1, s = FS * .74;

    /* tabouret et seau */
    ctx.fillStyle = "rgba(18,18,20,.95)";
    ctx.fillRect(x - s * .30, y - s * .17, s * .16, s * .17);
    ctx.fillRect(x + s * .18, y - s * .12, s * .12, s * .12);
    ctx.strokeStyle = "rgba(237,231,218,.22)"; ctx.lineWidth = 1;
    ctx.strokeRect(x - s * .30, y - s * .17, s * .16, s * .17);

    if (!co){
      /* personne : la serviette est restee sur le tabouret */
      ctx.fillStyle = "rgba(237,231,218,.22)";
      ctx.fillRect(x - s * .32, y - s * .20, s * .2, s * .05);
      return;
    }

    var up = F.phase === "rest" || F.bubT > 0;
    var arm = up ? -s * .42 : -s * .22 + Math.sin(t * .006) * s * .04;

    ctx.save();
    ctx.translate(x, y);
    /* jambes */
    ctx.strokeStyle = "rgba(16,16,18,1)"; ctx.lineWidth = s * .075;
    ctx.beginPath(); ctx.moveTo(-s * .03, -s * .34); ctx.lineTo(-s * .09, 0);
    ctx.moveTo(s * .03, -s * .34); ctx.lineTo(s * .09, 0); ctx.stroke();
    /* torse */
    ctx.fillStyle = "rgba(24,24,26,1)";
    ctx.beginPath();
    ctx.moveTo(-s * .09, -s * .34); ctx.lineTo(s * .09, -s * .34);
    ctx.lineTo(s * .07, -s * .62); ctx.lineTo(-s * .08, -s * .62);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "rgba(95,235,247,.45)"; ctx.lineWidth = 1.5; ctx.stroke();
    /* bras leves */
    ctx.strokeStyle = "rgba(24,24,26,1)"; ctx.lineWidth = s * .05;
    ctx.beginPath();
    ctx.moveTo(0, -s * .58); ctx.lineTo(s * .14, -s * .5); ctx.lineTo(s * .18, -s * .5 + arm);
    ctx.stroke();
    /* tete */
    ctx.fillStyle = "rgba(30,26,24,1)";
    ctx.beginPath(); ctx.arc(0, -s * .70, s * .075, 0, 6.2832); ctx.fill();
    ctx.strokeStyle = "rgba(95,235,247,.5)"; ctx.lineWidth = 1.4; ctx.stroke();
    ctx.restore();

    /* la bulle */
    if (F.bubble && F.bubT > 0){
      var a = clamp(F.bubT / 2.6 * 2, 0, 1);
      ctx.font = "700 " + Math.round(FS * .085) + "px 'Space Mono', monospace";
      var tw = ctx.measureText(F.bubble).width, bw = tw + FS * .12, bh = FS * .16;
      var bx = x - bw * .1, by = y - s * 1.05;
      ctx.globalAlpha = a;
      ctx.fillStyle = "rgba(10,10,11,.92)";
      ctx.fillRect(bx, by - bh, bw, bh);
      ctx.strokeStyle = "rgba(95,235,247,.8)"; ctx.lineWidth = 2;
      ctx.strokeRect(bx, by - bh, bw, bh);
      ctx.beginPath();
      ctx.moveTo(bx + bw * .16, by); ctx.lineTo(bx + bw * .26, by);
      ctx.lineTo(bx + bw * .17, by + FS * .05); ctx.closePath();
      ctx.fillStyle = "rgba(10,10,11,.92)"; ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#5FEBF7"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
      ctx.fillText(F.bubble, bx + FS * .06, by - bh * .5);
      ctx.globalAlpha = 1;
    }
  }

  /* le soigneur d'en face */
  function drawCorner(t, pad, apron){
    var x = RX1 + pad * 1.9, y = FY + apron * .1, s = FS * .7;
    ctx.save(); ctx.translate(x, y);
    ctx.strokeStyle = "rgba(14,14,16,1)"; ctx.lineWidth = s * .07;
    ctx.beginPath(); ctx.moveTo(0, -s * .32); ctx.lineTo(-s * .08, 0);
    ctx.moveTo(0, -s * .32); ctx.lineTo(s * .08, 0); ctx.stroke();
    ctx.fillStyle = "rgba(20,20,22,1)";
    ctx.fillRect(-s * .09, -s * .60, s * .18, s * .28);
    ctx.beginPath(); ctx.arc(0, -s * .68, s * .07, 0, 6.2832); ctx.fill();
    ctx.strokeStyle = "rgba(255,45,85,.4)"; ctx.lineWidth = 1.4;
    ctx.strokeRect(-s * .09, -s * .60, s * .18, s * .28); ctx.stroke();
    ctx.restore();
  }

  /* le tableau d'affichage suspendu, comme au basket */
  function drawBoard(t){
    var cx = (RX0 + RX1) / 2;
    var bw = (RX1 - RX0) * .34, bh = FS * .38, ty = H * .030;
    var x0 = cx - bw / 2, i;

    /* les deux cables */
    ctx.strokeStyle = "rgba(237,231,218,.3)"; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - bw * .32, 0); ctx.lineTo(cx - bw * .32, ty);
    ctx.moveTo(cx + bw * .32, 0); ctx.lineTo(cx + bw * .32, ty);
    ctx.stroke();

    /* le caisson */
    ctx.fillStyle = "rgba(8,8,10,.96)";
    ctx.fillRect(x0, ty, bw, bh);
    ctx.strokeStyle = "rgba(237,231,218,.75)"; ctx.lineWidth = 2.5;
    ctx.strokeRect(x0, ty, bw, bh);
    ctx.strokeStyle = "rgba(255,77,0,.5)"; ctx.lineWidth = 1;
    ctx.strokeRect(x0 + 4, ty + 4, bw - 8, bh - 8);

    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    var F1 = Math.round(bh * .17), F2 = Math.round(bh * .38), F3 = Math.round(bh * .13);

    /* ligne du haut : le round */
    ctx.font = "700 " + F1 + "px 'Space Mono', monospace";
    ctx.fillStyle = "#5FEBF7";
    ctx.fillText("ROUND " + F.round + " / " + F.rounds, cx, ty + bh * .18);

    /* le chrono */
    var lab = "", val;
    if (F.phase === "intro")      { val = mmss(ROUND_T); lab = "PRÉSENTATIONS"; }
    else if (F.phase === "rest")  { val = mmss(F.pt);    lab = "REPOS"; }
    else if (F.phase === "down")  { val = pad(F.count);  lab = "COMPTE"; }
    else if (F.phase === "end")   { val = "--:--";       lab = "TERMINÉ"; }
    else                          { val = mmss(F.t);     lab = ""; }

    ctx.font = "700 " + F2 + "px 'Space Mono', monospace";
    ctx.fillStyle = (F.phase === "down") ? "#FF2D55"
                  : (F.phase === "fight" && F.t < 10 ? "#FFC66B" : "#FF4D00");
    ctx.fillText(val, cx, ty + bh * .50);
    if (lab){
      ctx.font = "700 " + F3 + "px 'Space Mono', monospace";
      ctx.fillStyle = "rgba(237,231,218,.55)";
      ctx.fillText(lab, cx, ty + bh * .74);
    }

    /* les deux colonnes de points */
    var cells = [
      { x: x0 + bw * .16, n: "RŌNIN",              p: F.a.pts, d: F.a.down, c: "#FF4D00" },
      { x: x0 + bw * .84, n: F.foe.n.split(" ")[0], p: F.b.pts, d: F.b.down, c: "#FF2D55" }
    ];
    for (i = 0; i < 2; i++){
      var c = cells[i];
      ctx.font = "700 " + F3 + "px 'Space Mono', monospace";
      ctx.fillStyle = "rgba(237,231,218,.6)";
      ctx.fillText(c.n.length > 9 ? c.n.slice(0, 9) : c.n, c.x, ty + bh * .20);
      ctx.font = "700 " + Math.round(bh * .30) + "px 'Space Mono', monospace";
      ctx.fillStyle = c.c;
      ctx.fillText(pad(c.p), c.x, ty + bh * .46);
      /* lampes de mise au tapis */
      for (var j = 0; j < 3; j++){
        var lx = c.x - bh * .10 + j * bh * .10, ly = ty + bh * .72;
        ctx.fillStyle = j < c.d ? "#FF2D55" : "rgba(237,231,218,.16)";
        ctx.fillRect(lx - bh * .03, ly - bh * .03, bh * .06, bh * .06);
      }
    }

    /* le halo du caisson dans la poussiere */
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    var hg = ctx.createRadialGradient(cx, ty + bh, 0, cx, ty + bh, bw * .8);
    hg.addColorStop(0, "rgba(255,120,40,.09)");
    hg.addColorStop(1, "rgba(255,120,40,0)");
    ctx.fillStyle = hg; ctx.fillRect(x0 - bw, ty, bw * 3, bh * 4);
    ctx.restore();
  }

  /* ============================================================
     LE CORPS — silhouette de cote, trait epais, allure manga
     ============================================================ */

  var PL_COL = { skin:"#E5C4A1", cloth:"#3E352D", trim:"#FF4D00", hair:"#141216",
                 glove:"#FF4D00", exo:"#5FEBF7", scarf:"#EDE7DA" };
  var BOT_COL = { skin:"#C7A48A", cloth:"#382A38", trim:"#FF2D55", hair:"#1B1420",
                  glove:"#FF2D55", exo:"#FF7A95", scarf:null };

  /* position du gant et du coude, en fraction de la taille */
  function armPose(kind, ext, lead){
    var g, e;
    /* la garde reste sous la pommette : le visage doit rester lisible */
    if (!kind || ext <= 0){
      g = lead ? [.155, -.735] : [.065, -.775];
    } else if (kind === "jab"){
      g = lead ? [.155 + .24 * ext, -.735 - .04 * ext] : [.065, -.775];
    } else if (kind === "cross"){
      g = lead ? [.155, -.735] : [.065 + .33 * ext, -.775 - .02 * ext];
    } else {
      /* le crochet part de l'exterieur et revient */
      var s2 = Math.sin(ext * 3.1416);
      g = lead ? [.155, -.735] : [.065 + .27 * ext, -.775 - .09 * s2];
    }
    e = [(0 + g[0]) * .55 + .035, (-.74 + g[1]) * .5 + .055 * (1 - ext)];
    return { g:g, e:e };
  }

  function drawFighter(f, col, t){
    var x = ux(f.x), y = RY, s = FS;
    var exo = (f === F.a) ? G.exo : (f.style === "EXO MK-III" ? 3 : (f.P.dmg > 1.3 ? 1 : 0));

    /* l'ombre portee par la lumiere du haut */
    ctx.fillStyle = "rgba(0,0,0,.5)";
    ctx.beginPath(); ctx.ellipse(x, y, s * .17, s * .028, 0, 0, 6.2832); ctx.fill();

    var kind = f.act ? f.act.k : null, ext = 0;
    if (f.act){
      var pt = PUNCH[kind];
      if (f.act.ph === "wind") ext = -.22 * (1 - clamp(f.act.tt / (pt.wind / f.act.sp), 0, 1));
      else if (f.act.ph === "hit") ext = 1;
      else ext = clamp(f.act.tt / (pt.rec / f.act.sp), 0, 1);
    }
    var lead = kind === "jab";
    var pose = armPose(kind, Math.max(0, ext), true);
    var back = armPose(kind, Math.max(0, ext), false);

    var bob = Math.sin(f.bob) * s * .012;
    var wob = f.stun > 0 ? Math.sin(t * .05) * s * .022 : 0;
    var duck = f.slip > 0 ? s * .075 : 0;
    var push = (kind && ext > 0 ? ext * s * .035 : 0) + (ext < 0 ? ext * s * .04 : 0);

    ctx.save();
    ctx.translate(x + wob, y + bob + duck);
    ctx.scale(f.face, 1);
    if (f.slip > 0) ctx.rotate(-.12);
    else if (f.stun > 0) ctx.rotate(Math.sin(t * .04) * .06);

    var LW = s * .055;
    ctx.lineCap = "round"; ctx.lineJoin = "round";

    /* --- jambes --- */
    ctx.strokeStyle = col.cloth; ctx.lineWidth = LW * 1.15;
    ctx.beginPath();
    ctx.moveTo(-.01 * s, -.45 * s); ctx.lineTo(.07 * s, -.24 * s); ctx.lineTo(.155 * s + push, 0);
    ctx.moveTo(-.02 * s, -.45 * s); ctx.lineTo(-.10 * s, -.23 * s); ctx.lineTo(-.16 * s + push * .4, 0);
    ctx.stroke();
    /* chaussures */
    ctx.strokeStyle = col.trim; ctx.lineWidth = LW * .7;
    ctx.beginPath();
    ctx.moveTo(.11 * s + push, -.02 * s); ctx.lineTo(.20 * s + push, -.005 * s);
    ctx.moveTo(-.20 * s + push * .4, -.02 * s); ctx.lineTo(-.11 * s + push * .4, -.005 * s);
    ctx.stroke();

    /* --- torse --- */
    ctx.beginPath();
    ctx.moveTo(-.075 * s, -.44 * s);
    ctx.lineTo(.06 * s, -.45 * s);
    ctx.lineTo(.085 * s + push * .5, -.72 * s);
    ctx.lineTo(-.075 * s + push * .5, -.75 * s);
    ctx.closePath();
    ctx.fillStyle = col.cloth; ctx.fill();
    /* le soleil vient du haut : l'arete superieure prend la lumiere */
    ctx.strokeStyle = "rgba(255,238,210,.48)"; ctx.lineWidth = 1.8; ctx.stroke();
    ctx.strokeStyle = "rgba(255,240,215,.55)"; ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(-.072 * s + push * .5, -.745 * s); ctx.lineTo(.083 * s + push * .5, -.718 * s);
    ctx.stroke();
    /* le haori / la ceinture */
    ctx.fillStyle = col.trim;
    ctx.fillRect(-.08 * s, -.50 * s, .155 * s, s * .035);

    /* --- l'exosquelette --- */
    if (exo > 0){
      var a = .35 + exo * .14;
      ctx.strokeStyle = "rgba(95,235,247," + a.toFixed(2) + ")";
      if (col.exo !== "#5FEBF7") ctx.strokeStyle = "rgba(255,122,149," + a.toFixed(2) + ")";
      ctx.lineWidth = Math.max(1.4, s * .012);
      /* dorsale */
      ctx.beginPath();
      ctx.moveTo(-.065 * s, -.46 * s); ctx.lineTo(-.055 * s, -.73 * s); ctx.stroke();
      /* epauliere */
      ctx.beginPath();
      ctx.moveTo(-.04 * s, -.735 * s); ctx.lineTo(.075 * s, -.715 * s);
      ctx.lineTo(.06 * s, -.665 * s); ctx.stroke();
      /* attelles de cuisse */
      ctx.beginPath();
      ctx.moveTo(.005 * s, -.44 * s); ctx.lineTo(.065 * s, -.25 * s);
      ctx.moveTo(-.03 * s, -.44 * s); ctx.lineTo(-.095 * s, -.24 * s); ctx.stroke();
      if (exo >= 3){
        ctx.beginPath();
        ctx.moveTo(.07 * s, -.24 * s); ctx.lineTo(.145 * s + push, -.02 * s); ctx.stroke();
      }
      /* diodes aux articulations */
      var joints = [[.075, -.715], [.005, -.44], [.07, -.24]];
      ctx.fillStyle = ctx.strokeStyle;
      for (var q = 0; q < Math.min(joints.length, 1 + exo); q++)
        ctx.fillRect(joints[q][0] * s - s * .009, joints[q][1] * s - s * .009, s * .018, s * .018);
    }

    /* --- bras arriere (derriere le torse) --- */
    ctx.strokeStyle = col.skin; ctx.lineWidth = LW * .8;
    ctx.beginPath();
    ctx.moveTo(-.045 * s, -.715 * s);
    ctx.lineTo(back.e[0] * s - .03 * s, back.e[1] * s);
    ctx.lineTo(back.g[0] * s, back.g[1] * s);
    ctx.stroke();
    ctx.fillStyle = "rgba(10,10,11,.55)";
    ctx.beginPath(); ctx.arc(back.g[0] * s, back.g[1] * s, s * .052, 0, 6.2832); ctx.fill();
    ctx.fillStyle = col.glove; ctx.globalAlpha = .78;
    ctx.beginPath(); ctx.arc(back.g[0] * s, back.g[1] * s, s * .050, 0, 6.2832); ctx.fill();
    ctx.globalAlpha = 1;

    /* --- tete --- */
    var hx = .02 * s + push * .55, hy = -.855 * s;
    ctx.fillStyle = col.skin;
    ctx.beginPath(); ctx.arc(hx, hy, s * .076, 0, 6.2832); ctx.fill();
    /* menton et nuque */
    ctx.fillStyle = col.skin;
    ctx.fillRect(hx - s * .02, hy + s * .05, s * .045, s * .045);
    /* cheveux en piques, vers l'arriere */
    ctx.fillStyle = col.hair;
    ctx.beginPath();
    ctx.moveTo(hx + s * .055, hy - s * .05);
    ctx.lineTo(hx - s * .085, hy - s * .075);
    ctx.lineTo(hx - s * .13, hy - s * .01);
    ctx.lineTo(hx - s * .10, hy - s * .02);
    ctx.lineTo(hx - s * .135, hy + s * .045);
    ctx.lineTo(hx - s * .07, hy + s * .02);
    ctx.lineTo(hx - s * .085, hy + s * .06);
    ctx.lineTo(hx - s * .03, hy - s * .03);
    ctx.closePath(); ctx.fill();
    /* bandeau */
    ctx.fillStyle = col.trim;
    ctx.fillRect(hx - s * .075, hy - s * .045, s * .15, s * .022);
    /* l'oeil */
    ctx.fillStyle = "rgba(12,12,14,.9)";
    ctx.fillRect(hx + s * .028, hy - s * .008, s * .022, s * .012);
    /* le nez, un cran */
    ctx.fillStyle = col.skin;
    ctx.beginPath();
    ctx.moveTo(hx + s * .072, hy + s * .005);
    ctx.lineTo(hx + s * .096, hy + s * .022);
    ctx.lineTo(hx + s * .07, hy + s * .028);
    ctx.closePath(); ctx.fill();

    /* rubans du bandeau, cote vagabond */
    if (col.scarf){
      ctx.strokeStyle = col.scarf; ctx.lineWidth = Math.max(1.6, s * .014);
      ctx.globalAlpha = .8;
      for (var r = 0; r < 2; r++){
        ctx.beginPath();
        ctx.moveTo(hx - s * .07, hy - s * .03 + r * s * .02);
        ctx.quadraticCurveTo(
          hx - s * .14 + Math.sin(t * .004 + r) * s * .02, hy + s * .01 + r * s * .04,
          hx - s * .19 + Math.cos(t * .003 + r) * s * .025, hy + s * .09 + r * s * .05);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    /* --- bras avant (devant tout le reste) --- */
    ctx.strokeStyle = col.skin; ctx.lineWidth = LW * .85;
    ctx.beginPath();
    ctx.moveTo(.055 * s, -.72 * s);
    ctx.lineTo(pose.e[0] * s, pose.e[1] * s);
    ctx.lineTo(pose.g[0] * s, pose.g[1] * s);
    ctx.stroke();
    /* bande du poignet */
    ctx.strokeStyle = "rgba(237,231,218,.6)"; ctx.lineWidth = LW * .5;
    ctx.beginPath();
    ctx.moveTo(pose.g[0] * s - s * .03, pose.g[1] * s + s * .02);
    ctx.lineTo(pose.g[0] * s - s * .055, pose.g[1] * s + s * .035);
    ctx.stroke();
    /* le gant */
    ctx.fillStyle = col.glove;
    ctx.beginPath(); ctx.arc(pose.g[0] * s, pose.g[1] * s, s * .058, 0, 6.2832); ctx.fill();
    ctx.strokeStyle = "rgba(10,10,11,.5)"; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(pose.g[0] * s, pose.g[1] * s, s * .058, 0, 6.2832); ctx.stroke();
    /* le reflet du soleil sur le cuir */
    ctx.fillStyle = "rgba(255,240,210,.35)";
    ctx.beginPath(); ctx.arc(pose.g[0] * s - s * .012, pose.g[1] * s - s * .022, s * .018, 0, 6.2832); ctx.fill();

    /* garde levee : le gant arriere protege la joue */
    if (f.guard){
      ctx.strokeStyle = "rgba(95,235,247,.5)"; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(hx + s * .01, hy + s * .01, s * .13, -1.1, 1.1);
      ctx.stroke();
    }

    /* le coup au but : eclat blanc sur le corps */
    if (f.flash > 0){
      ctx.fillStyle = "rgba(255,255,255," + (f.flash * 1.6).toFixed(3) + ")";
      ctx.beginPath(); ctx.arc(hx, hy, s * .13, 0, 6.2832); ctx.fill();
    }
    if (f.hurt > 0){
      ctx.strokeStyle = "rgba(255,45,85," + (f.hurt * .8).toFixed(2) + ")";
      ctx.lineWidth = 2.5;
      for (var w = 0; w < 3; w++){
        ctx.beginPath();
        ctx.moveTo(hx + s * (.08 + w * .04), hy - s * .07);
        ctx.lineTo(hx + s * (.13 + w * .05), hy - s * .13);
        ctx.stroke();
      }
    }

    ctx.restore();

    /* jauge de souffle au pied du boxeur, discrete */
    if (f.st < f.stMax * .3){
      ctx.fillStyle = "rgba(255,77,0,.5)";
      ctx.fillRect(x - s * .07, y + s * .04, s * .14 * (f.st / (f.stMax * .3)), 2.5);
    }
  }

  /* au tapis */
  function drawDown(f, col){
    var x = ux(f.x), y = RY, s = FS;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(f.face, 1);
    ctx.lineCap = "round";
    ctx.strokeStyle = col.cloth; ctx.lineWidth = s * .095;
    ctx.beginPath();
    ctx.moveTo(-.22 * s, -.055 * s); ctx.lineTo(.06 * s, -.07 * s);
    ctx.stroke();
    ctx.lineWidth = s * .06;
    ctx.beginPath();
    ctx.moveTo(-.02 * s, -.06 * s); ctx.lineTo(.17 * s, -.125 * s);
    ctx.moveTo(-.02 * s, -.06 * s); ctx.lineTo(.19 * s, -.03 * s);
    ctx.stroke();
    /* le bras qui cherche la corde */
    ctx.strokeStyle = col.skin; ctx.lineWidth = s * .045;
    ctx.beginPath();
    ctx.moveTo(-.14 * s, -.085 * s); ctx.lineTo(.02 * s, -.16 * s); ctx.stroke();
    ctx.fillStyle = col.glove;
    ctx.beginPath(); ctx.arc(.04 * s, -.17 * s, s * .05, 0, 6.2832); ctx.fill();
    ctx.fillStyle = col.skin;
    ctx.beginPath(); ctx.arc(-.27 * s, -.075 * s, s * .075, 0, 6.2832); ctx.fill();
    ctx.fillStyle = col.hair;
    ctx.beginPath();
    ctx.moveTo(-.24 * s, -.13 * s); ctx.lineTo(-.38 * s, -.12 * s);
    ctx.lineTo(-.31 * s, -.02 * s); ctx.closePath(); ctx.fill();
    ctx.fillStyle = col.trim;
    ctx.fillRect(-.31 * s, -.11 * s, s * .10, s * .022);
    ctx.fillStyle = col.glove;
    ctx.beginPath(); ctx.arc(.21 * s, -.025 * s, s * .05, 0, 6.2832); ctx.fill();
    ctx.restore();
  }

  /* ============================================================
     LES PETITS CADRES — portrait, silhouette, rue
     ============================================================ */

  var mini = {};

  function setMini(id){
    var c = el(id); if (!c) return null;
    var r = c.parentNode.getBoundingClientRect();
    var w = Math.max(20, r.width), h = Math.max(20, r.height);
    c.width = Math.round(w * DPR); c.height = Math.round(h * DPR);
    var g = c.getContext("2d");
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
    mini[id] = { c:c, g:g, w:w, h:h };
    return mini[id];
  }

  function sizeMinis(){ setMini("r-face"); setMini("r-body"); setMini("r-street"); }

  /* le portrait : trois quarts, un oeil, un bandeau */
  function drawFace(t){
    var m = mini["r-face"]; if (!m) return;
    var g = m.g, w = m.w, h = m.h, s = Math.min(w, h);
    g.clearRect(0, 0, w, h);
    g.fillStyle = "#17151A"; g.fillRect(0, 0, w, h);
    var lg = g.createLinearGradient(0, 0, 0, h);
    lg.addColorStop(0, "rgba(255,210,150,.22)");
    lg.addColorStop(1, "rgba(255,77,0,.05)");
    g.fillStyle = lg; g.fillRect(0, 0, w, h);

    var cx = w * .52, cy = h * .58, r = s * .30;
    g.fillStyle = PL_COL.skin;
    g.beginPath(); g.arc(cx, cy, r, 0, 6.2832); g.fill();
    g.fillStyle = PL_COL.hair;
    g.beginPath();
    g.moveTo(cx + r * .8, cy - r * .5);
    g.lineTo(cx - r * 1.3, cy - r * .9);
    g.lineTo(cx - r * 1.5, cy + r * .1);
    g.lineTo(cx - r * .9, cy - r * .2);
    g.lineTo(cx - r * 1.2, cy + r * .7);
    g.lineTo(cx - r * .3, cy - r * .45);
    g.closePath(); g.fill();
    g.fillStyle = PL_COL.trim;
    g.fillRect(cx - r, cy - r * .62, r * 1.9, r * .28);
    g.fillStyle = "rgba(12,12,14,.92)";
    g.fillRect(cx + r * .15, cy - r * .1, r * .3, r * .16);
    /* les marques du dernier combat */
    if (G.inj > 8){
      g.strokeStyle = "rgba(255,45,85," + Math.min(.85, G.inj / 90).toFixed(2) + ")";
      g.lineWidth = Math.max(1, s * .022);
      g.beginPath();
      g.moveTo(cx + r * .1, cy + r * .25); g.lineTo(cx + r * .55, cy + r * .18);
      g.stroke();
      if (G.inj > 45){
        g.beginPath();
        g.moveTo(cx - r * .1, cy - r * .75); g.lineTo(cx + r * .35, cy - r * .68);
        g.stroke();
      }
    }
  }

  /* la silhouette debout dans son cadre, avec l'exo monte */
  function drawBody(t){
    var m = mini["r-body"]; if (!m) return;
    var g = m.g, w = m.w, h = m.h;
    g.clearRect(0, 0, w, h);
    var bg = g.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, "rgba(255,214,160,.13)");
    bg.addColorStop(.7, "rgba(12,11,12,.2)");
    bg.addColorStop(1, "rgba(8,8,10,.5)");
    g.fillStyle = bg; g.fillRect(0, 0, w, h);

    /* le rai de lumiere */
    g.save(); g.globalCompositeOperation = "lighter";
    g.fillStyle = "rgba(255,225,180,.06)";
    g.beginPath();
    g.moveTo(w * .36, 0); g.lineTo(w * .62, 0); g.lineTo(w * .80, h); g.lineTo(w * .20, h);
    g.closePath(); g.fill(); g.restore();

    var s = Math.min(h * .80, w * 1.95), x = w * .5, y = Math.min(h * .97, h * .52 + s * .52);
    var bob = Math.sin(t * .0016) * s * .008;
    g.save(); g.translate(x, y + bob);
    g.lineCap = "round"; g.lineJoin = "round";
    var LW = s * .05;
    /* jambes */
    g.strokeStyle = "#332C27"; g.lineWidth = LW * 1.1;
    g.beginPath();
    g.moveTo(-.01 * s, -.45 * s); g.lineTo(.05 * s, -.23 * s); g.lineTo(.09 * s, 0);
    g.moveTo(-.02 * s, -.45 * s); g.lineTo(-.07 * s, -.23 * s); g.lineTo(-.10 * s, 0);
    g.stroke();
    /* torse */
    g.beginPath();
    g.moveTo(-.07 * s, -.44 * s); g.lineTo(.06 * s, -.44 * s);
    g.lineTo(.085 * s, -.73 * s); g.lineTo(-.085 * s, -.73 * s);
    g.closePath(); g.fillStyle = "#332C27"; g.fill();
    g.strokeStyle = "rgba(237,231,218,.42)"; g.lineWidth = 1.6; g.stroke();
    g.fillStyle = PL_COL.trim; g.fillRect(-.075 * s, -.50 * s, .15 * s, s * .035);
    /* exo */
    if (G.exo > 0){
      g.strokeStyle = "rgba(95,235,247," + (.35 + G.exo * .13).toFixed(2) + ")";
      g.lineWidth = Math.max(1.2, s * .012);
      g.beginPath();
      g.moveTo(-.06 * s, -.46 * s); g.lineTo(-.05 * s, -.72 * s);
      g.moveTo(-.05 * s, -.73 * s); g.lineTo(.08 * s, -.71 * s);
      g.moveTo(.0 * s, -.44 * s);  g.lineTo(.05 * s, -.24 * s);
      g.moveTo(-.03 * s, -.44 * s); g.lineTo(-.07 * s, -.24 * s);
      g.stroke();
      g.fillStyle = g.strokeStyle;
      g.fillRect(.075 * s, -.72 * s, s * .02, s * .02);
    }
    /* l'ombre au sol, sous la lumiere du haut */
    g.fillStyle = "rgba(0,0,0,.5)";
    g.beginPath(); g.ellipse(0, 0, s * .17, s * .022, 0, 0, 6.2832); g.fill();
    /* bras et gants */
    g.strokeStyle = PL_COL.skin; g.lineWidth = LW * .85;
    g.beginPath();
    g.moveTo(.055 * s, -.71 * s); g.lineTo(.125 * s, -.63 * s); g.lineTo(.135 * s, -.745 * s);
    g.moveTo(-.06 * s, -.71 * s); g.lineTo(-.125 * s, -.63 * s); g.lineTo(-.135 * s, -.745 * s);
    g.stroke();
    g.fillStyle = PL_COL.glove;
    g.beginPath(); g.arc(.138 * s, -.755 * s, s * .052, 0, 6.2832); g.fill();
    g.beginPath(); g.arc(-.138 * s, -.755 * s, s * .052, 0, 6.2832); g.fill();
    /* tete */
    var hy = -.85 * s;
    g.fillStyle = PL_COL.skin;
    g.beginPath(); g.arc(0, hy, s * .075, 0, 6.2832); g.fill();
    g.fillStyle = PL_COL.hair;
    g.beginPath();
    g.moveTo(.06 * s, hy - .05 * s); g.lineTo(-.10 * s, hy - .09 * s);
    g.lineTo(-.13 * s, hy - .01 * s); g.lineTo(-.07 * s, hy - .03 * s);
    g.lineTo(-.11 * s, hy + .05 * s); g.lineTo(-.02 * s, hy - .04 * s);
    g.closePath(); g.fill();
    g.fillStyle = PL_COL.trim; g.fillRect(-.075 * s, hy - .045 * s, .15 * s, s * .022);
    /* les rubans */
    g.strokeStyle = "rgba(237,231,218,.75)"; g.lineWidth = Math.max(1.2, s * .013);
    g.beginPath();
    g.moveTo(-.07 * s, hy - .02 * s);
    g.quadraticCurveTo(-.18 * s + Math.sin(t * .003) * s * .02, hy + .08 * s,
                       -.24 * s, hy + .20 * s);
    g.stroke();
    g.restore();
  }

  /* la rue devant la vitrine : chaque client qui passe est un client reel */
  function drawStreet(t){
    var m = mini["r-street"]; if (!m) return;
    var g = m.g, w = m.w, h = m.h, i;
    g.clearRect(0, 0, w, h);
    var d = daylight();
    var bg = g.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, "rgba(255,198,107," + (.03 + d * .07).toFixed(3) + ")");
    bg.addColorStop(1, "rgba(8,8,10,.5)");
    g.fillStyle = bg; g.fillRect(0, 0, w, h);

    /* trottoir */
    g.strokeStyle = "rgba(237,231,218,.2)"; g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, h * .82); g.lineTo(w, h * .82); g.stroke();
    g.fillStyle = "rgba(237,231,218,.06)";
    for (i = 0; i < 18; i++) g.fillRect(i * (w / 18), h * .84, w / 36, 2);

    for (i = 0; i < walkers.length; i++){
      var p = walkers[i], x = p.x * w, s = h * .42 * p.h, y = h * .82;
      g.save(); g.translate(x, y);
      g.strokeStyle = "rgba(10,10,12,.92)"; g.lineWidth = Math.max(1.6, s * .16);
      g.lineCap = "round";
      var sw = Math.sin(t * .012 + p.ph) * s * .16;
      g.beginPath();
      g.moveTo(0, -s * .42); g.lineTo(sw, 0);
      g.moveTo(0, -s * .42); g.lineTo(-sw, 0);
      g.stroke();
      g.fillStyle = "rgba(14,14,16,.95)";
      g.fillRect(-s * .13, -s * .78, s * .26, s * .38);
      g.beginPath(); g.arc(0, -s * .86, s * .11, 0, 6.2832); g.fill();
      /* ce qu'il ressort de la boutique */
      g.fillStyle = p.ok ? "#8BE86B" : (p.why === "vide" ? "#FF4D00" : "#FFC66B");
      g.fillRect(-s * .05, -s * 1.1, s * .1, s * .1);
      g.restore();
    }

    if (F.on || G.clock >= 22 * 60 || G.clock < 8 * 60){
      g.fillStyle = "rgba(6,6,8,.66)"; g.fillRect(0, 0, w, h);
      g.fillStyle = "rgba(237,231,218,.5)";
      g.font = "700 " + Math.round(h * .18) + "px 'Space Mono', monospace";
      g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(F.on ? "RIDEAU BAISSÉ — COMBAT EN COURS" : "FERMÉ", w / 2, h / 2);
    }
  }

  /* ============================================================
     BOUCLE ET COMMANDES
     ============================================================ */

  var uiT = 0, raf = 0;

  function loop(now){
    if (!active){ raf = 0; return; }
    raf = requestAnimationFrame(loop);
    var dt = Math.min(.05, (now - last) / 1000);
    last = now;
    if (dt <= 0) return;

    if (F.on) fightTick(dt);
    else {
      shopTick(dt);
      if (mmOn){ mmT -= dt; if (mmT <= 0){ mmOn = false; startFight(mkPlayer()); } }
    }

    if (F.on) hudFight();
    uiT -= dt;
    if (uiT <= 0){
      uiT = .2;
      if (!F.on){ paintHead(); paintGoods(); }
      needGoods = needHead = false;
    } else if (!F.on){
      if (needGoods){ needGoods = false; paintGoods(); }
      if (needHead){ needHead = false; paintHead(); }
    }

    if (!ctx) return;
    ctx.save();
    if (F.on && F.shake > 0){
      ctx.translate(rand(-1, 1) * F.shake * 9 * S, rand(-1, 1) * F.shake * 6 * S);
    }
    if (F.on) drawRing(now); else drawShop(now);
    ctx.restore();

    if (!F.on){ drawFace(now); drawBody(now); drawStreet(now); }
  }

  /* --- clavier --- */

  var GK = { q:1, d:1, a:1, e:1, r:1, s:1, z:1, j:1, k:1, l:1, " ":1,
             arrowleft:1, arrowright:1, arrowup:1, arrowdown:1, shift:1 };

  function onKey(e, down){
    if (!active) return;
    var k = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();
    if (k === "escape"){
      if (!down) return;
      if (!el("r-mup").hidden){ closeUp(); return; }
      if (!el("r-mop").hidden){ closeOps(); return; }
      if (F.on){ quit(); return; }
      return;
    }
    /* quand le curseur de volume a le focus, les fleches lui reviennent */
    if (e.target && e.target.classList && e.target.classList.contains("rvol-r")) return;
    if (!F.on) return;
    if (!GK[k]) return;
    e.preventDefault();
    keys[k] = down;
    /* au tapis, il faut marteler pour se relever */
    if (down && F.phase === "down" && F.downOf === F.a && (k === "a" || k === "e" || k === "r" || k === "j"))
      F.a.rise++;
  }

  /* la piste du ring et ses deux commandes : le bandeau de la boutique
     disparait pendant le combat, celle du ring prend le relais. */
  var ringVol = VolumeUI(RingMusic);

  /* --- souris --- */

  function wire(){
    ringVol.add("r-mute",  "r-volr",  "r-volv");
    ringVol.add("r-mute2", "r-volr2", "r-volv2");

    el("r-bfight").addEventListener("click", function(){
      if (!ready()) return;
      openOps();
    });
    el("r-bup").addEventListener("click", openUp);
    el("r-mupx").addEventListener("click", closeUp);
    el("r-mopx").addEventListener("click", closeOps);
    el("r-quit").addEventListener("click", quit);
    el("r-endok").addEventListener("click", function(){
      el("r-mend").hidden = true; endBout(); paintHead(); paintGoods();
    });

    /* fermer en cliquant le voile */
    el("r-mup").addEventListener("mousedown", function(e){ if (e.target === this) closeUp(); });
    el("r-mop").addEventListener("mousedown", function(e){ if (e.target === this) closeOps(); });

    el("r-tabs").addEventListener("click", function(e){
      var b = e.target.closest("[data-t]"); if (!b) return;
      tab = +b.getAttribute("data-t");
      paintTabs(); paintTab();
    });

    el("r-tabbody").addEventListener("click", function(e){
      var b = e.target.closest("[data-a]"); if (!b) return;
      upAction(b.getAttribute("data-a"), b.getAttribute("data-k"), +b.getAttribute("data-i"));
    });

    el("r-opbody").addEventListener("click", function(e){
      var b = e.target.closest("[data-a]"); if (!b || b.classList.contains("locked")) return;
      var a = b.getAttribute("data-a");
      if (a === "bot") startFight(BOTS[+b.getAttribute("data-i")]);
      else if (a === "mm") searchMM();
    });

    el("r-goods").addEventListener("click", function(e){
      var b = e.target.closest("[data-a]"); if (!b || b.disabled) return;
      var row = b.closest("[data-i]"); if (!row) return;
      var i = +row.getAttribute("data-i"), a = b.getAttribute("data-a");
      if (a === "buy") order(i, 5);
      else if (a === "up") reprice(i, 1);
      else if (a === "dn") reprice(i, -1);
      else if (a === "eat") consume(i);
    });

    window.addEventListener("keydown", function(e){ onKey(e, true); });
    window.addEventListener("keyup",   function(e){ onKey(e, false); });
    window.addEventListener("blur", function(){ keys = {}; });
  }

  /* ---------------- entree / sortie ---------------- */

  function init(){
    if (!cvs) return;
    G = load();
    var neuf = !G;
    if (neuf) G = fresh();
    /* garde-fous : un enregistrement ancien peut manquer un champ */
    if (G.mmOK === undefined) G.mmOK = false;
    if (!G.lastDay) G.lastDay = { rev:0, cli:0, rent:0, pay:0 };
    if (!G.log) G.log = [];

    resize();
    sizeMinis();
    window.addEventListener("resize", function(){ resize(); sizeMinis(); });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(sizeMinis);

    wire();
    buildGoods();
    paintHead(); paintGoods(); paintLog();

    if (neuf){
      say("Trois victoires et le réseau de la Ceinture t'ouvre sa file classée.", "");
      say("Le rayon est à moitié vide. Le grossiste livre au clic.", "buy");
      say("L'échoppe ouvre. Le loyer tombe chaque soir, sans exception.", "hit");
    }
  }

  function setActive(v){
    if (v === active) return;
    active = v;
    keys = {};
    RingMusic.set(v);
    if (v){
      last = performance.now();
      ringVol.sync();
      sizeMinis();
      paintHead(); paintGoods();
      if (!raf) raf = requestAnimationFrame(loop);
    } else {
      save();
      /* on ne laisse pas un combat tourner dans le dos du joueur */
      if (F.on && F.phase !== "end"){ finish(false, "FORFAIT — QUITTÉ LE RING"); }
      if (F.on) { el("r-mend").hidden = true; endBout(); }
      mmOn = false;
      if (raf){ cancelAnimationFrame(raf); raf = 0; }
    }
  }

  /* la molette appartient a la boutique quand le pointeur est sur un
     panneau qui defile, et au combat quand il y en a un */
  function grab(e){
    if (!active) return false;
    if (F.on) return true;
    if (!el("r-mup").hidden || !el("r-mop").hidden || !el("r-mend").hidden) return true;
    var t = e && e.target;
    return !!(t && t.closest && t.closest(".rcol-b, .rtabbody, .rgoods"));
  }

  function busy(){ return active && (F.on || !el("r-mup").hidden || !el("r-mop").hidden || !el("r-mend").hidden); }

  return { init:init, setActive:setActive, grab:grab, busy:busy };
})();

Ring.init();
Ring.setActive(true);

var RingVol = VolumeUI(RingMusic);
RingVol.add("f-mute", "f-volr", "f-volv");

})();
