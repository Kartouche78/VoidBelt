/* ==========================================================
   JUMP'N BUMP — moteur
   ----------------------------------------------------------
   Tout se joue en pixels de la carte : le canvas fait exactement
   1448x1086, la taille de map.png, et le CSS le met a l'echelle.
   Aucune conversion de coordonnees nulle part.

   Le masque de collision est deduit de map.png au chargement :
   tout ce qui n'est pas bleu est solide. Quelques rectangles
   ecrits a la main rattrapent ce que la couleur ne dit pas —
   les glacons (transparents donc bleus), les filets d'eau
   (blancs donc solides) et la ligne d'horizon du bassin.
   ========================================================== */

(function () {
  "use strict";

  /* ---------- le monde ---------- */

  var MAP_W = 1448, MAP_H = 1086;
  var PLAY_W = 1287;                 // a droite commence le panneau de score

  // Glacons : solides ET glissants. Mesures sur map.png.
  var ICE = [
    { x: 608, y: 709, w: 63, h: 64 },
    { x: 670, y: 646, w: 59, h: 61 },
    { x: 731, y: 586, w: 49, h: 60 },
    { x: 981, y: 897, w: 140, h: 62 }
  ];

  // Filets d'eau : peints en blanc, donc pris pour du solide par la
  // couleur seule. On les efface du masque, sinon ce sont des murs
  // invisibles de trois pixels en plein ciel.
  var STREAMS = [
    { x: 174, y: 520, w: 18, h: 182 },
    { x: 278, y: 730, w: 28, h: 176 },
    { x: 108, y: 896, w: 362, h: 18 }
  ];

  // La nappe dessinee doit rejoindre la berge : s'arreter douze pixels
  // avant laissait un cran visible au bord de l'eau.
  var POOL = { x0: 0, x1: 490, y: 903 };

  // La caisse en bois, en bas au milieu : le trampoline. Le rectangle
  // s'arrete avant la colonne voisine, dont le sommet est 5 px plus
  // haut et declencherait le rebond par erreur.
  var BUMPER = { x: 558, y: 899, w: 56 };

  // L'arbre tordu du bas : c'est un decor de premier plan. On l'efface
  // du masque et on le redessine par-dessus les lapins, qui passent
  // donc derriere lui.
  var TREE = { x: 636, y: 818, w: 114, h: 129 };

  // Panneau de score : quatre emplacements, mesures au pixel.
  var SLOTS = [
    { face: [1319, 63, 93, 65], name: [1302, 129, 122, 38], score: [1304, 168, 109, 93] },
    { face: [1316, 309, 94, 61], name: [1302, 372, 122, 42], score: [1304, 415, 109, 93] },
    { face: [1322, 558, 81, 70], name: [1302, 630, 122, 39], score: [1304, 670, 109, 93] },
    { face: [1321, 813, 84, 72], name: [1302, 886, 122, 38], score: [1304, 925, 109, 95] }
  ];

  // splash_sang.png : 7 x 3 cases, dix-sept images utiles. Le point
  // d'accroche est le centre du contenu de la premiere image — c'est
  // lui qu'on pose sur le corps du lapin pour que la giclee parte de
  // la bonne place et reste calee d'une image a l'autre.
  var GIB_COLS = 7, GIB_ROWS = 3, GIB_COUNT = 17;
  var GIB_ANCHOR = [116.5, 167.5];
  var GIB_SCALE = 0.46, GIB_FPS = 24;

  // Trois grumeaux — sang et esquille d'os — decoupes dans une image
  // tardive de la planche : ce sont eux qui volent puis restent au sol.
  var GIB_CHUNKS = [[641, 300, 94, 77], [726, 422, 73, 64], [638, 443, 60, 73]];
  var CHUNK_SCALE = 0.26;

  // splash_eau.png : 4 x 2 cases, huit images, calees sur la ligne d'eau.
  var EAU_COLS = 4, EAU_ROWS = 2, EAU_SCALE = 0.21, EAU_FPS = 20;

  var BLOOD_DARK = "#7A0C0C", BLOOD_MID = "#A81212", BLOOD_HOT = "#D81C1C";

  // ---------- le lobby ----------
  // Une clairiere plate coupee en deux par un tronc couche. A gauche on
  // regle sa partie, a droite on se met en position : le decompte part
  // quand tout le monde a franchi le tronc.
  var LOBBY = {
    w: 1774, h: 887,
    // Le lobby se parcourt comme un plan vu de trois quarts : on va a
    // gauche et a droite, mais aussi vers le fond et vers l'avant. La
    // bande d'herbe ou l'on peut marcher va du pied des arbres au bord
    // du champ.
    top: 560, ground: 748,
    spawnY: 660,
    // On n'est « a droite » qu'une fois le tronc entierement franchi.
    side: 1110,
    bar: [763, 887],        // la bande noire du bas, ou vit la barre de reglages
    // Le dessus du tronc, releve sur l'image. Sa collision ne commence
    // qu'a `logY` : il reste toujours un passage au fond de la
    // clairiere, derriere le tronc, pour aller d'un cote a l'autre.
    log: [[700, 578], [762, 545], [830, 530], [900, 556], [980, 588], [1050, 620], [1104, 652]],
    logY: 636,
    sky: [268, 545]         // ou volent les papillons, sous le bandeau du titre
  };

  var COLORS = [
    { key: 0, label: "Argente", tint: "#C3C8CE" },
    { key: 1, label: "Fauve", tint: "#D09257" },
    { key: 2, label: "Neige", tint: "#F1F3F6" },
    { key: 3, label: "Chataigne", tint: "#9C5326" },
    { key: 4, label: "Creme", tint: "#EBD2A2" },
    { key: 5, label: "Roux", tint: "#DC6A1C" },
    { key: 6, label: "Ardoise", tint: "#7A8087" },
    { key: 7, label: "Pie", tint: "#B07C5E" }
  ];

  /* ---------- physique ---------- */

  var GRAVITY = 2700;
  var WALK_ACC = 5400, WALK_MAX = 345, AIR_ACC = 2700;
  var GROUND_DAMP = 0.000004, AIR_DAMP = 0.35;   // facteurs par seconde
  var ICE_ACC = 900, ICE_DAMP = 0.55;
  var JUMP_V = 1020, JUMP_CUT = 0.42;
  var COYOTE = 0.10, BUFFER = 0.13;
  var DIVE = 2.1;                                 // gravite x2 quand on plonge
  var BUMP_V = 1550;
  var STEP_UP = 22;
  // En nageant on se hisse plus haut qu'en marchant : sans ca, le
  // moindre ressaut d'herbe au bord du bassin bloque net.
  var WATER_STEP = 34;
  var BODY_W = 31, BODY_H = 39;
  var SPRITE_H = 58;
  var STOMP_VY = 40, STOMP_HEAD = 19;
  // On reapparait dans la foulee : la giclee de sang reste sur place et
  // raconte la mort, le joueur, lui, repart tout de suite. Le court
  // repit qui suit n'est pas signale a l'ecran — le clignotement etait
  // plus genant qu'utile.
  var DEAD_TIME = 0, SPAWN_SHIELD = 0.8;

  // Sous l'eau, tout se joue au ralenti : la pesanteur tombe a un
  // septieme, la poussee suit dans les memes proportions pour garder la
  // meme ligne de flottaison, et le freinage est assez faible pour
  // qu'un elan se prolonge en glissade. C'est ce qui donne la sensation
  // d'apesanteur plutot que celle de nager dans du beton.
  var SWIM_G = 0.14, SWIM_MAX = 0.46, SWIM_ACC = 0.30;
  var SWIM_DAMP = 1.5, BUOY = 620, SWIM_JUMP = 0.65, STROKE_CD = 0.30;
  // Poussee et freinage se reglent ensemble. A 1250 contre un poids de
  // 810, le lapin remonte sans se faire ejecter et se stabilise enfonce
  // aux deux tiers : il nage, il ne flotte pas comme un bouchon.
  var SWIM_VDAMP = 0.11;                          // freinage vertical dans l'eau

  /* ---------- etat global ---------- */

  var cvs, ctx, mapCanvas, treeCanvas, clean;
  var scene = "arena", arenaWorld = null, lobbyWorld = null, countdown = null;
  var solid, ice;                                  // Uint8Array MAP_W*MAP_H
  var bunny = [], digits = [], flies = [];
  var gibFrames = [], gibChunks = [], eauFrames = [];
  var decals, decalsCtx;
  var spawns = [];
  var players = {}, order = [];
  var me = null, running = false, paused = false, locked = false;
  var phase = "lobby", banner = null;
  var lastT = 0, acc = 0, netAcc = 0, clock = 0;
  var fps = 0, fpsAcc = 0, fpsN = 0, netMs = null, waterGrad = null;
  var lastSent = null, lastSentAt = 0;
  var api = {};

  /* ==========================================================
     CHARGEMENT
     ========================================================== */

  function loadImage(src) {
    return new Promise(function (ok, ko) {
      var i = new Image();
      i.onload = function () { ok(i); };
      i.onerror = function () { ko(new Error("image absente : " + src)); };
      i.src = src;
    });
  }

  // Les bruitages sont juste rapatries ici ; ils seront decodes a la
  // premiere interaction, quand le contexte audio existera.
  function loadSounds(base) {
    return Promise.all(Object.keys(SFX_FILES).map(function (k) {
      return fetch(base + SFX_FILES[k])
        .then(function (r) { return r.ok ? r.arrayBuffer() : null; })
        .then(function (ab) { if (ab) Sfx.raw[k] = ab; })
        .catch(function () { /* fichier absent : synthese */ });
    }));
  }

  function scratch(w, h) {
    var c = document.createElement("canvas");
    c.width = w; c.height = h;
    return c;
  }

  // Reduction par moities successives : un drawImage qui divise par
  // cinq d'un coup crenele, quatre qui divisent par deux non.
  function shrink(src, sx, sy, sw, sh, dw, dh) {
    var cur = scratch(sw, sh), g = cur.getContext("2d");
    g.drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh);
    var w = sw, h = sh;
    while (w > dw * 2 && h > dh * 2) {
      var nw = Math.max(dw, Math.round(w / 2)), nh = Math.max(dh, Math.round(h / 2));
      var nx = scratch(nw, nh), ng = nx.getContext("2d");
      ng.imageSmoothingQuality = "high";
      ng.drawImage(cur, 0, 0, w, h, 0, 0, nw, nh);
      cur = nx; w = nw; h = nh;
    }
    var out = scratch(Math.round(dw), Math.round(dh)), og = out.getContext("2d");
    og.imageSmoothingQuality = "high";
    og.drawImage(cur, 0, 0, w, h, 0, 0, out.width, out.height);
    return out;
  }

  // Boite englobante du contenu opaque d'une case de planche. Les
  // bornes arrivent parfois fractionnaires (1448 / 5 chiffres) : sans
  // arrondi, l'index dans le tableau tombe entre deux pixels et la
  // boite ressort vide.
  function tightBox(data, W, x0, y0, x1, y1, test) {
    x0 = Math.floor(x0); y0 = Math.floor(y0);
    x1 = Math.floor(x1); y1 = Math.floor(y1);
    var mnx = 1e9, mny = 1e9, mxx = -1, mxy = -1;
    for (var y = y0; y < y1; y++) {
      for (var x = x0; x < x1; x++) {
        var i = (y * W + x) * 4;
        if (test(data[i], data[i + 1], data[i + 2], data[i + 3])) {
          if (x < mnx) mnx = x;
          if (x > mxx) mxx = x;
          if (y < mny) mny = y;
          if (y > mxy) mxy = y;
        }
      }
    }
    if (mxx < 0) return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    return { x: mnx, y: mny, w: mxx - mnx + 1, h: mxy - mny + 1 };
  }

  function sheetData(image) {
    var c = scratch(image.width, image.height);
    var g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(image, 0, 0);
    return g.getImageData(0, 0, image.width, image.height);
  }

  /* --- masque de collision --- */

  function buildMask(px) {
    var d = px.data, n = MAP_W * MAP_H;
    solid = new Uint8Array(n);
    ice = new Uint8Array(n);

    for (var i = 0; i < n; i++) {
      var r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
      // Le fond penche vers le bleu a toutes les luminosites : le ciel
      // clair, les montagnes, l'eau, et jusqu'aux ombres tres sombres
      // des troncs sous les plateformes. Le decor sur lequel on marche,
      // lui, ne penche jamais vers le bleu.
      solid[i] = (b > r + 40 && b > g + 22 && b > 58) ? 0 : 1;
    }

    var k, x, y;
    for (k = 0; k < STREAMS.length; k++) {
      var s = STREAMS[k];
      for (y = s.y; y < s.y + s.h; y++) {
        for (x = s.x; x < s.x + s.w; x++) {
          var j = (y * MAP_W + x) * 4;
          if (d[j + 1] > 190 && d[j + 2] > 205 && d[j + 2] >= d[j + 1] - 8) {
            solid[y * MAP_W + x] = 0;
          }
        }
      }
    }
    for (y = TREE.y; y < TREE.y + TREE.h; y++) {
      for (x = TREE.x; x < TREE.x + TREE.w; x++) solid[y * MAP_W + x] = 0;
    }

    // Ouverture morphologique : erosion puis dilatation. Elle emporte
    // tout ce qui est plus fin que onze pixels — brins d'herbe, lianes,
    // brindilles, champignons — et laisse la masse des rochers intacte.
    openMask(5);

    // Puis on rabote les dix premiers pixels du haut de chaque colonne.
    // La surface de marche descend dans l'herbe au lieu de se poser sur
    // la pointe des brins : le lapin ne decolle plus en passant sur une
    // touffe. Les plafonds, eux, ne bougent pas — on n'enleve que le
    // haut des blocs, jamais leur dessous.
    shaveTop(10);

    // Restent les miettes de couleur : liseres sombres pris pour des
    // murs en plein ciel, taches d'eau claires prises pour des trous
    // dans la roche. Les unes s'effacent, les autres se bouchent.
    prune(1, 600);
    prune(0, 600);

    for (k = 0; k < ICE.length; k++) {
      var c = ICE[k];
      for (y = c.y; y < c.y + c.h; y++) {
        for (x = c.x; x < c.x + c.w; x++) {
          solid[y * MAP_W + x] = 1;
          ice[y * MAP_W + x] = 1;
        }
      }
    }
  }

  // Erosion et dilatation separables, en fenetre glissante : on ne
  // compte que le pixel qui entre et celui qui sort. Hors cadre compte
  // comme solide, pour ne pas ronger les bords de la carte.
  function sweep(src, dst, r, grow) {
    var k = 2 * r + 1, x, y, cnt, base, out, inn;
    for (y = 0; y < MAP_H; y++) {
      base = y * MAP_W;
      cnt = 0;
      for (x = -r; x <= r; x++) cnt += (x < 0 || x >= MAP_W) ? 1 : src[base + x];
      for (x = 0; x < MAP_W; x++) {
        dst[base + x] = grow ? (cnt > 0 ? 1 : 0) : (cnt === k ? 1 : 0);
        out = x - r; inn = x + r + 1;
        cnt -= (out < 0 || out >= MAP_W) ? 1 : src[base + out];
        cnt += (inn < 0 || inn >= MAP_W) ? 1 : src[base + inn];
      }
    }
  }

  function sweepV(src, dst, r, grow) {
    var k = 2 * r + 1, x, y, cnt, out, inn;
    for (x = 0; x < MAP_W; x++) {
      cnt = 0;
      for (y = -r; y <= r; y++) cnt += (y < 0 || y >= MAP_H) ? 1 : src[y * MAP_W + x];
      for (y = 0; y < MAP_H; y++) {
        dst[y * MAP_W + x] = grow ? (cnt > 0 ? 1 : 0) : (cnt === k ? 1 : 0);
        out = y - r; inn = y + r + 1;
        cnt -= (out < 0 || out >= MAP_H) ? 1 : src[out * MAP_W + x];
        cnt += (inn < 0 || inn >= MAP_H) ? 1 : src[inn * MAP_W + x];
      }
    }
  }

  function openMask(r) {
    var n = MAP_W * MAP_H;
    var a = new Uint8Array(n), b = new Uint8Array(n);
    sweep(solid, a, r, false);
    sweepV(a, b, r, false);
    sweep(b, a, r, true);
    sweepV(a, solid, r, true);
  }

  function shaveTop(k) {
    var col = new Uint8Array(MAP_H), x, y, run, i;
    for (x = 0; x < MAP_W; x++) {
      run = 0;
      for (y = 0; y < MAP_H; y++) {
        i = y * MAP_W + x;
        if (solid[i]) { run++; col[y] = run > k ? 1 : 0; }
        else { run = 0; col[y] = 0; }
      }
      for (y = 0; y < MAP_H; y++) solid[y * MAP_W + x] = col[y];
    }
  }

  // Retourne toute region de `value` plus petite que `minSize` pixels.
  function prune(value, minSize) {
    var n = MAP_W * MAP_H;
    var label = new Int32Array(n), stack = new Int32Array(n), sizes = [0];
    var next = 1, i;

    for (i = 0; i < n; i++) {
      if (label[i] || solid[i] !== value) continue;
      var id = next++, sp = 0, count = 0;
      stack[sp++] = i;
      label[i] = id;
      while (sp > 0) {
        var c = stack[--sp], cx = c % MAP_W;
        count++;
        if (cx > 0 && !label[c - 1] && solid[c - 1] === value) {
          label[c - 1] = id; stack[sp++] = c - 1;
        }
        if (cx < MAP_W - 1 && !label[c + 1] && solid[c + 1] === value) {
          label[c + 1] = id; stack[sp++] = c + 1;
        }
        if (c >= MAP_W && !label[c - MAP_W] && solid[c - MAP_W] === value) {
          label[c - MAP_W] = id; stack[sp++] = c - MAP_W;
        }
        if (c < n - MAP_W && !label[c + MAP_W] && solid[c + MAP_W] === value) {
          label[c + MAP_W] = id; stack[sp++] = c + MAP_W;
        }
      }
      sizes[id] = count;
    }

    var flip = value ? 0 : 1;
    for (i = 0; i < n; i++) {
      if (label[i] && sizes[label[i]] < minSize) solid[i] = flip;
    }
  }

  // La ligne d'ecume peinte sur map.png reste fixe : on l'efface pour
  // que la vraie surface, animee, soit la seule visible.
  function patchWaterline(px) {
    var d = px.data;
    for (var x = 100; x < 500; x++) {
      var above = (894 * MAP_W + x) * 4, below = (918 * MAP_W + x) * 4;
      for (var y = 890; y < 916; y++) {
        var i = (y * MAP_W + x) * 4;
        if (d[i + 1] > 190 && d[i + 2] > 205) {
          var src = y < POOL.y ? above : below;
          d[i] = d[src]; d[i + 1] = d[src + 1]; d[i + 2] = d[src + 2];
        }
      }
    }
    mapCanvas = scratch(MAP_W, MAP_H);
    mapCanvas.getContext("2d").putImageData(px, 0, 0);
    clean = mapCanvas;
  }

  // L'arbre decoupe sur le ciel : l'alpha suit l'ecart au bleu, pour
  // garder les bords adoucis du dessin d'origine. Les dernieres lignes
  // s'effacent en fondu, la ou le tronc plonge dans l'herbe — sinon le
  // calque masquerait les pattes d'un lapin qui passe au pied.
  function cutTree(px) {
    var c = scratch(TREE.w, TREE.h);
    var g = c.getContext("2d");
    var id = g.createImageData(TREE.w, TREE.h), d = id.data, s = px.data;
    for (var y = 0; y < TREE.h; y++) {
      var fade = y > TREE.h - 12 ? (TREE.h - y) / 12 : 1;
      for (var x = 0; x < TREE.w; x++) {
        var i = ((TREE.y + y) * MAP_W + TREE.x + x) * 4, o = (y * TREE.w + x) * 4;
        var r = s[i], gg = s[i + 1], b = s[i + 2];
        var blue = b - Math.max(r, gg);
        d[o] = r; d[o + 1] = gg; d[o + 2] = b;
        d[o + 3] = Math.max(0, Math.min(255, (45 - blue) * 10)) * fade;
      }
    }
    g.putImageData(id, 0, 0);
    treeCanvas = c;
  }

  /* --- decoupe des planches --- */

  function cutBunnies(image) {
    var px = sheetData(image), cw = image.width / 4, ch = image.height / 2;
    for (var i = 0; i < 8; i++) {
      var cx = Math.floor((i % 4) * cw), cy = Math.floor(Math.floor(i / 4) * ch);
      var b = tightBox(px.data, image.width, cx, cy, cx + cw, cy + ch,
        function (r, g, bl, a) { return a > 40; });
      // Rendu a deux fois la taille utile : le lapin s'etire au saut
      // sans devenir flou.
      var h = SPRITE_H * 2, w = Math.round(h * b.w / b.h);
      var c = shrink(image, b.x, b.y, b.w, b.h, w, h);

      // Les pattes sont decoupees a part pour qu'elles puissent bouger
      // seules. On cherche ou elles commencent vraiment plutot que de
      // couper a l'aveugle : le bas du lapin, c'est la ou le trace se
      // resserre en deux petits blocs blancs.
      var g2 = c.getContext("2d", { willReadFrequently: true });
      var cd = g2.getImageData(0, 0, w, h).data;
      var footTop = Math.round(h * 0.86);
      var mn = w, mx = 0;
      for (var y = footTop; y < h; y++) {
        for (var x = 0; x < w; x++) {
          if (cd[(y * w + x) * 4 + 3] > 60) { if (x < mn) mn = x; if (x > mx) mx = x; }
        }
      }
      bunny.push({
        c: c, ratio: b.w / b.h,
        footTop: footTop,
        footSplit: mx > mn ? (mn + mx) / 2 : w / 2
      });
    }
  }

  // La giclee de sang : une case entiere par image, sans recadrage, pour
  // que les eclaboussures restent calees entre elles.
  function cutGibs(image) {
    var cw = image.width / GIB_COLS, ch = image.height / GIB_ROWS;
    var dw = Math.round(cw * GIB_SCALE), dh = Math.round(ch * GIB_SCALE);
    for (var i = 0; i < GIB_COUNT; i++) {
      var cx = Math.floor((i % GIB_COLS) * cw), cy = Math.floor(Math.floor(i / GIB_COLS) * ch);
      gibFrames.push(shrink(image, cx, cy, Math.floor(cw), Math.floor(ch), dw, dh));
    }
    for (var k = 0; k < GIB_CHUNKS.length; k++) {
      var q = GIB_CHUNKS[k];
      gibChunks.push(shrink(image, q[0], q[1], q[2], q[3],
        Math.round(q[2] * CHUNK_SCALE), Math.round(q[3] * CHUNK_SCALE)));
    }
  }

  // La gerbe d'eau : recadree au plus juste, et calee non pas sur son
  // centre mais sur le bas de la flaque — c'est la ligne d'eau.
  function cutEau(image) {
    var px = sheetData(image), cw = image.width / EAU_COLS, ch = image.height / EAU_ROWS;
    for (var i = 0; i < EAU_COLS * EAU_ROWS; i++) {
      var cx = Math.floor((i % EAU_COLS) * cw), cy = Math.floor(Math.floor(i / EAU_COLS) * ch);
      var b = tightBox(px.data, image.width, cx, cy, cx + cw, cy + ch,
        function (r, g, bl, a) { return a > 30; });
      var dw = Math.max(1, Math.round(b.w * EAU_SCALE)), dh = Math.max(1, Math.round(b.h * EAU_SCALE));
      eauFrames.push({ c: shrink(image, b.x, b.y, b.w, b.h, dw, dh), w: dw, h: dh });
    }
  }

  function cutDigits(image) {
    var px = sheetData(image), cw = image.width / 5, ch = image.height / 2;
    for (var i = 0; i < 10; i++) {
      var cx = Math.floor((i % 5) * cw), cy = Math.floor(Math.floor(i / 5) * ch);
      var b = tightBox(px.data, image.width, cx, cy, cx + cw, cy + ch,
        function (r, g, bl) { return r + g + bl > 110; });
      // Les chiffres sont graves en clair sur un fond noir pur : la
      // luminance fait un canal alpha tout trouve, et le creux sombre
      // du chiffre laisse voir la plaque du panneau.
      var tmp = scratch(b.w, b.h), tg = tmp.getContext("2d", { willReadFrequently: true });
      tg.drawImage(image, b.x, b.y, b.w, b.h, 0, 0, b.w, b.h);
      var id = tg.getImageData(0, 0, b.w, b.h), dd = id.data;
      for (var p = 0; p < dd.length; p += 4) {
        var lum = (dd[p] + dd[p + 1] + dd[p + 2]) / 3;
        dd[p + 3] = Math.max(0, Math.min(255, (lum - 5) * 7));
      }
      tg.putImageData(id, 0, 0);
      var dh = 150, dw = Math.round(dh * b.w / b.h);
      digits.push({ c: shrink(tmp, 0, 0, b.w, b.h, dw, dh), ratio: b.w / b.h });
    }
  }

  function cutFlies(image) {
    var px = sheetData(image), cw = image.width / 3, ch = image.height / 3;
    for (var i = 0; i < 9; i++) {
      var cx = Math.floor((i % 3) * cw), cy = Math.floor(Math.floor(i / 3) * ch);
      var b = tightBox(px.data, image.width, cx, cy, cx + cw, cy + ch,
        function (r, g, bl, a) { return a > 40; });
      var h = 46, w = Math.round(h * b.w / b.h);
      flies.push(shrink(image, b.x, b.y, b.w, b.h, w, h));
    }
  }

  /* --- points d'apparition --- */

  // Toute surface plate assez large et assez degagee fait l'affaire ;
  // on les recolte une fois pour toutes plutot que de les ecrire.
  function findSpawns() {
    for (var x = 56; x < PLAY_W - 56; x += 16) {
      for (var y = 90; y < MAP_H - 24; y++) {
        // Un rebord : du solide sous les pattes, du vide juste au-dessus.
        if (!solid[y * MAP_W + x] || solid[(y - 1) * MAP_W + x]) continue;

        var deep = true;
        for (var d = 1; d < 7; d++) {
          if (!solid[(y + d) * MAP_W + x]) { deep = false; break; }
        }
        if (!deep) continue;

        var head = true;
        for (var h = 3; h < BODY_H + 44; h += 4) {
          if (solid[(y - h) * MAP_W + x]) { head = false; break; }
        }
        if (!head) continue;

        var flat = true;
        for (var o = -18; o <= 18; o += 6) {
          var xx = Math.max(1, Math.min(PLAY_W - 2, x + o));
          if (!solid[(y + 4) * MAP_W + xx]) { flat = false; break; }
        }
        if (!flat) continue;

        // Le bassin ne fait pas un point d'apparition.
        if (!(x < POOL.x1 + 30 && y > POOL.y - 24)) spawns.push({ x: x, y: y - 1 });
        y += 70;
      }
    }
  }

  api.load = function () {
    var base = "/jumpnbump/assets/";
    return Promise.all([
      loadImage(base + "map.png"),
      loadImage(base + "lapin.png"),
      loadImage(base + "score.png"),
      loadImage(base + "papillon.png"),
      loadImage(base + "splash_sang.png"),
      loadImage(base + "splash_eau.png"),
      loadImage(base + "carte_lobby.png"),
      loadSounds(base)
    ]).then(function (all) {
      var px = sheetData(all[0]);
      buildMask(px);
      cutTree(px);
      patchWaterline(px);
      cutBunnies(all[1]);
      cutDigits(all[2]);
      cutFlies(all[3]);
      cutGibs(all[4]);
      cutEau(all[5]);
      // Les traces de sang sont peintes directement dans une copie de la
      // carte : une seule grande image a recopier par trame au lieu de
      // deux superposees.
      decals = scratch(MAP_W, MAP_H);
      decalsCtx = decals.getContext("2d");
      decalsCtx.drawImage(mapCanvas, 0, 0);
      mapCanvas = decals;
      findSpawns();
      arenaWorld = {
        w: MAP_W, h: MAP_H, playW: PLAY_W,
        solid: solid, ice: ice, canvas: mapCanvas, clean: clean, spawns: spawns
      };
      buildLobby(all[6]);
      Butterflies.init();
    });
  };

  /* ==========================================================
     LES DEUX SCENES
     ========================================================== */

  // Le lobby et l'arene n'ont ni la meme taille ni le meme masque. Tout
  // le moteur lit MAP_W, MAP_H, solid… : il suffit donc de rebrancher
  // ces variables pour changer de monde, sans toucher au reste.
  function useScene(name) {
    var w = name === "lobby" ? lobbyWorld : arenaWorld;
    if (!w) return;
    scene = name;
    MAP_W = w.w; MAP_H = w.h; PLAY_W = w.playW;
    solid = w.solid; ice = w.ice; mapCanvas = w.canvas; spawns = w.spawns;
    if (cvs) { cvs.width = MAP_W; cvs.height = MAP_H; ctx.imageSmoothingQuality = "high"; }
    Butterflies.init();
    parts.length = 0; smokes.length = 0; bursts.length = 0;
    chunks.length = 0; splashes.length = 0;
    panelKey = "";
    waterGrad = null;
  }

  function logTop(x) {
    var pts = LOBBY.log;
    if (x <= pts[0][0] || x >= pts[pts.length - 1][0]) return LOBBY.ground + 1;
    for (var i = 1; i < pts.length; i++) {
      if (x <= pts[i][0]) {
        var a = pts[i - 1], b = pts[i];
        return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]);
      }
    }
    return LOBBY.ground + 1;
  }

  function buildLobby(image) {
    var w = LOBBY.w, h = LOBBY.h, x, y;
    var sm = new Uint8Array(w * h), im = new Uint8Array(w * h);

    // Tout est plein sauf la bande d'herbe.
    sm.fill(1);
    for (y = LOBBY.top; y <= LOBBY.ground; y++) {
      for (x = 24; x < w - 24; x++) sm[y * w + x] = 0;
    }
    for (x = LOBBY.log[0][0]; x <= LOBBY.log[LOBBY.log.length - 1][0]; x++) {
      var t = Math.max(LOBBY.logY, Math.round(logTop(x)));
      for (y = t; y <= LOBBY.ground; y++) sm[y * w + x] = 1;
    }

    var c = scratch(w, h);
    c.getContext("2d").drawImage(image, 0, 0, w, h);

    var sp = [];
    for (x = 150; x <= 620; x += 70) sp.push({ x: x, y: LOBBY.spawnY });
    lobbyWorld = { w: w, h: h, playW: w, solid: sm, ice: im, canvas: c, spawns: sp };
  }

  /* ==========================================================
     MASQUE
     ========================================================== */

  var HW = BODY_W / 2;

  // Le corps occupe les lignes [pieds - BODY_H + 1 .. pieds] ; `pieds`
  // est la derniere ligne libre, le sol commence juste en dessous.
  //
  // Les trois sondes ci-dessous lisent TOUS les pixels de l'arete qui
  // avance. Echantillonner tous les seize pixels coutait moins cher,
  // mais une pointe d'herbe de deux pixels tombait entre deux sondes :
  // elle bloquait la chute sans etre vue par le test « suis-je au
  // sol ? », et le lapin restait suspendu dans le vide.

  function colBlocked(x, top, bottom) {
    if (x < 0 || x >= PLAY_W) return true;
    var b = bottom | 0;
    if (b >= MAP_H) return true;
    var xi = x | 0, a = Math.max(0, top | 0);
    for (var y = a; y <= b; y++) {
      if (solid[y * MAP_W + xi]) return true;
    }
    return false;
  }

  function rowBlocked(left, right, y) {
    if (left < 0 || right >= PLAY_W) return true;
    if (y >= MAP_H) return true;
    if (y < 0) return false;
    var base = (y | 0) * MAP_W, a = left | 0, b = right | 0;
    for (var x = a; x <= b; x++) {
      if (solid[base + x]) return true;
    }
    return false;
  }

  function rowIce(left, right, y) {
    if (left < 0 || right >= PLAY_W || y < 0 || y >= MAP_H) return false;
    var base = (y | 0) * MAP_W, a = left | 0, b = right | 0;
    for (var x = a; x <= b; x++) {
      if (ice[base + x]) return true;
    }
    return false;
  }

  // Le corps entier, pour les cas rares : degagement et sondes des bots.
  function boxBlocked(cx, feet) {
    for (var y = feet - BODY_H + 1; y < feet; y += 3) {
      if (rowBlocked(cx - HW, cx + HW, y)) return true;
    }
    return rowBlocked(cx - HW, cx + HW, feet);
  }

  /* ==========================================================
     EAU — champ de hauteur a ressorts
     ========================================================== */

  var Water = {
    n: 100, h: null, v: null, col: 0,
    init: function () {
      this.h = new Float32Array(this.n);
      this.v = new Float32Array(this.n);
      this.col = (POOL.x1 - POOL.x0) / this.n;
    },
    step: function (dt) {
      var h = this.h, v = this.v, n = this.n, i;
      var k = 46, damp = 3.4, spread = 0.24;
      for (i = 0; i < n; i++) {
        v[i] += (-k * h[i] - damp * v[i]) * dt;
        h[i] += v[i] * dt;
      }
      for (var pass = 0; pass < 2; pass++) {
        for (i = 0; i < n; i++) {
          if (i > 0) v[i - 1] += spread * (h[i] - h[i - 1]);
          if (i < n - 1) v[i + 1] += spread * (h[i] - h[i + 1]);
        }
      }
      // Le filet d'eau qui tombe du haut ride la surface en continu.
      var f = Math.floor((288 - POOL.x0) / this.col);
      if (f >= 0 && f < n) v[f] += Math.sin(clock * 9) * 6 - 4;
    },
    surface: function (x) {
      if (x <= POOL.x0 || x >= POOL.x1) return POOL.y;
      var f = (x - POOL.x0) / this.col - 0.5;
      var i = Math.max(0, Math.min(this.n - 2, Math.floor(f)));
      var t = Math.max(0, Math.min(1, f - i));
      return POOL.y + this.h[i] * (1 - t) + this.h[i + 1] * t;
    },
    splash: function (x, power) {
      if (x < POOL.x0 || x > POOL.x1) return;
      var i = Math.max(0, Math.min(this.n - 1, Math.floor((x - POOL.x0) / this.col)));
      this.v[i] += power;
      if (i > 0) this.v[i - 1] += power * 0.5;
      if (i < this.n - 1) this.v[i + 1] += power * 0.5;
    }
  };
  Water.init();

  function inPool(x) { return x > POOL.x0 - 4 && x < POOL.x1; }

  // Part du corps sous l'eau, de 0 a 1.
  function submersion(p) {
    if (!inPool(p.x)) return 0;
    var s = Water.surface(p.x);
    return Math.max(0, Math.min(1, (p.y - s) / BODY_H));
  }

  /* ==========================================================
     PAPILLONS
     ========================================================== */

  var Butterflies = {
    list: [],
    top: function () { return scene === "lobby" ? LOBBY.sky[0] : 60; },
    bottom: function () { return scene === "lobby" ? LOBBY.sky[1] : MAP_H - 200; },
    init: function () {
      this.list.length = 0;
      var t = this.top(), b = this.bottom();
      for (var i = 0; i < 11; i++) {
        this.list.push({
          x: 80 + Math.random() * (PLAY_W - 160),
          y: t + Math.random() * (b - t),
          tint: Math.floor(Math.random() * 3),
          phase: Math.random() * 100,
          speed: 22 + Math.random() * 26,
          dir: Math.random() < 0.5 ? -1 : 1,
          drift: 0.4 + Math.random() * 0.8,
          scale: 0.5 + Math.random() * 0.45
        });
      }
    },
    step: function (dt) {
      for (var i = 0; i < this.list.length; i++) {
        var b = this.list[i];
        b.phase += dt;
        b.x += b.dir * b.speed * dt;
        b.y += Math.sin(b.phase * 1.7) * 26 * b.drift * dt * 2;
        if (b.x < 40) { b.x = 40; b.dir = 1; }
        if (b.x > PLAY_W - 40) { b.x = PLAY_W - 40; b.dir = -1; }
        if (b.y < this.top()) b.y = this.top();
        if (b.y > this.bottom()) b.y = this.bottom();
      }
    },
    draw: function (g) {
      g.save();
      g.globalAlpha = 0.72;
      for (var i = 0; i < this.list.length; i++) {
        var b = this.list[i];
        // Trois poses d'ailes : fermee, mi-ouverte, ouverte.
        var beat = Math.abs(Math.sin(b.phase * 5.5));
        var frame = beat < 0.33 ? 0 : beat < 0.72 ? 1 : 2;
        var s = flies[b.tint * 3 + frame];
        var w = s.width * b.scale, h = s.height * b.scale;
        g.save();
        g.translate(b.x, b.y);
        g.scale(b.dir, 1);
        g.drawImage(s, -w / 2, -h / 2, w, h);
        g.restore();
      }
      g.restore();
    }
  };

  /* ==========================================================
     PARTICULES
     ========================================================== */

  var parts = [];       // etincelles et gouttes
  var smokes = [];      // bouffees de poussiere
  var bursts = [];      // giclees de sang jouees image par image
  var chunks = [];      // grumeaux qui volent puis se posent
  var splashes = [];    // gerbes d'eau

  function spark(x, y, vx, vy, life, color, size, grav) {
    parts.push({
      x: x, y: y, vx: vx, vy: vy, t: 0, life: life,
      c: color, s: size, g: grav === undefined ? 1 : grav, mark: false
    });
  }

  /* ---------- traces permanentes ---------- */

  // Tout ce qui se depose reste dessine jusqu'a la fin de la partie :
  // le sang et les os ne s'effacent pas.
  function stampBlood(x, y, size) {
    var g = decalsCtx;
    if (!g) return;
    x = Math.round(x); y = Math.round(y);
    g.fillStyle = BLOOD_DARK;
    g.fillRect(x - size, y - size * 0.7, size * 2, size * 1.4);
    g.fillRect(x - size * 1.6, y - size * 0.3, size * 3.2, size * 0.7);
    g.fillStyle = BLOOD_MID;
    g.fillRect(x - size * 0.8, y - size * 0.9, size * 1.6, size);
    if (Math.random() < 0.5) {
      g.fillStyle = BLOOD_HOT;
      g.fillRect(x - size * 0.4, y - size * 0.6, size * 0.8, size * 0.6);
    }
    // quelques eclats detaches, pour que la tache ne soit pas un pate
    g.fillStyle = BLOOD_DARK;
    for (var i = 0; i < 2; i++) {
      var a = Math.random() * Math.PI * 2, d = size * (1.6 + Math.random() * 2.2);
      var s2 = Math.max(1, Math.round(size * 0.45));
      g.fillRect(Math.round(x + Math.cos(a) * d), Math.round(y + Math.sin(a) * d * 0.6), s2, s2);
    }
  }

  function stampChunk(c) {
    var g = decalsCtx;
    if (!g) return;
    var img = gibChunks[c.i];
    g.save();
    g.translate(c.x, c.y);
    g.rotate(c.rot);
    g.drawImage(img, -img.width / 2, -img.height / 2);
    g.restore();
  }

  /* ---------- mort ---------- */

  function burstBlood(x, y) {
    var cy = y - BODY_H * 0.55, i, a, sp;

    bursts.push({ x: x, y: cy, t: 0 });

    // Les gouttes : elles volent, puis marquent le decor la ou elles
    // touchent. C'est ce qui etale le sang sur la carte.
    for (i = 0; i < 36; i++) {
      a = Math.random() * Math.PI * 2;
      sp = 110 + Math.random() * 520;
      parts.push({
        x: x, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 210,
        t: 0, life: 2.6, c: Math.random() < 0.4 ? BLOOD_HOT : BLOOD_DARK,
        s: 2 + Math.random() * 3, g: 1, mark: true
      });
    }
    // Les trois grumeaux, avec un os dedans.
    for (i = 0; i < 5; i++) {
      a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
      sp = 190 + Math.random() * 300;
      chunks.push({
        x: x + (Math.random() - 0.5) * 10, y: cy,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        rot: Math.random() * 6.28, spin: (Math.random() - 0.5) * 14,
        i: i % gibChunks.length, still: 0
      });
    }
  }

  /* ---------- fumee ---------- */

  // La poussiere part des pattes, vers la gauche et vers la droite,
  // d'autant plus loin que l'impact a ete rude.
  function puff(x, y, power) {
    var n = Math.min(12, 3 + Math.round(power * 9));
    for (var i = 0; i < n; i++) {
      var side = (i % 2) ? 1 : -1;
      smokes.push({
        x: x + side * (3 + Math.random() * 12),
        y: y - 1 - Math.random() * 4,
        vx: side * (30 + Math.random() * (55 + power * 160)),
        vy: -18 - Math.random() * 34,
        t: 0, life: 0.55 + Math.random() * 0.4,
        r0: 4 + Math.random() * 4,
        r1: 18 + Math.random() * 12 + power * 14
      });
    }
  }

  function burstDrops(x, y, n, up) {
    for (var i = 0; i < n; i++) {
      spark(x + (Math.random() - 0.5) * 26, y,
        (Math.random() - 0.5) * 180, -up * (0.4 + Math.random()),
        0.4 + Math.random() * 0.5, "rgba(190,235,255,.9)", 2 + Math.random() * 2, 1);
    }
  }

  function splashWater(x) {
    // Uniquement au-dessus du bassin : ailleurs, la « surface » n'existe
    // pas et la gerbe se poserait en plein decor.
    if (!inPool(x)) return;
    splashes.push({ x: x, t: 0 });
  }

  /* ---------- avancement ---------- */

  function stepFx(dt) {
    var i, p;

    for (i = parts.length - 1; i >= 0; i--) {
      p = parts[i];
      p.t += dt;
      p.vy += GRAVITY * p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.mark && p.x > 2 && p.x < PLAY_W - 2 && p.y > 0 && p.y < MAP_H - 1 &&
        rowBlocked(p.x, p.x, p.y)) {
        stampBlood(p.x, p.y - 1, p.s * 0.9);
        parts.splice(i, 1);
        continue;
      }
      if (p.t >= p.life) { parts.splice(i, 1); }
    }

    for (i = smokes.length - 1; i >= 0; i--) {
      p = smokes[i];
      p.t += dt;
      if (p.t >= p.life) { smokes.splice(i, 1); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= Math.pow(0.05, dt);
      p.vy *= Math.pow(0.3, dt);
    }

    for (i = bursts.length - 1; i >= 0; i--) {
      bursts[i].t += dt;
      if (bursts[i].t * GIB_FPS >= GIB_COUNT) bursts.splice(i, 1);
    }

    for (i = splashes.length - 1; i >= 0; i--) {
      splashes[i].t += dt;
      if (splashes[i].t * EAU_FPS >= eauFrames.length) splashes.splice(i, 1);
    }

    for (i = chunks.length - 1; i >= 0; i--) {
      var c = chunks[i];
      c.vy += GRAVITY * 0.85 * dt;
      c.rot += c.spin * dt;
      var nx = c.x + c.vx * dt, ny = c.y + c.vy * dt;
      var hitY = rowBlocked(nx, nx, ny);
      var hitX = rowBlocked(nx, nx, c.y);
      if (hitY) {
        // rebond mou, puis le grumeau se colle au decor
        c.vy = -c.vy * 0.28;
        c.vx *= 0.55;
        c.spin *= 0.4;
        if (Math.abs(c.vy) < 60) { c.vy = 0; c.still += 1; }
        ny = c.y;
      } else if (hitX) {
        c.vx = -c.vx * 0.3;
        nx = c.x;
      } else {
        c.still = 0;
      }
      c.x = nx; c.y = ny;
      if (c.x < 4 || c.x > PLAY_W - 4 || c.y > MAP_H - 3) { chunks.splice(i, 1); continue; }
      if (c.still > 3) { stampChunk(c); chunks.splice(i, 1); }
    }
  }

  function drawFx(g) {
    var i, p;

    for (i = 0; i < parts.length; i++) {
      p = parts[i];
      g.globalAlpha = p.mark ? 1 : Math.max(0, 1 - p.t / p.life);
      g.fillStyle = p.c;
      g.fillRect(p.x - p.s / 2, p.y - p.s / 2, p.s, p.s);
    }
    g.globalAlpha = 1;

    for (i = 0; i < chunks.length; i++) {
      var c = chunks[i], img = gibChunks[c.i];
      g.save();
      g.translate(c.x, c.y);
      g.rotate(c.rot);
      g.drawImage(img, -img.width / 2, -img.height / 2);
      g.restore();
    }

    // Deux disques par bouffee : un halo large et un coeur plus dense.
    // Ca suffit a faire une poussiere douce sans degrade a calculer.
    g.fillStyle = "#FBF7EC";
    for (i = 0; i < smokes.length; i++) {
      p = smokes[i];
      // Le nuage s'ouvre vite puis s'efface : sans cette courbe, la
      // bouffee reste un point le temps qu'on la remarque.
      var k = p.t / p.life;
      var r = p.r0 + (p.r1 - p.r0) * (1 - Math.pow(1 - k, 2.2));
      var al = Math.min(1, (1 - k) * 1.7);
      g.globalAlpha = al * 0.34;
      g.beginPath();
      g.arc(p.x, p.y, r, 0, 6.2832);
      g.fill();
      g.globalAlpha = al * 0.5;
      g.beginPath();
      g.arc(p.x, p.y, r * 0.58, 0, 6.2832);
      g.fill();
    }
    g.globalAlpha = 1;

    for (i = 0; i < bursts.length; i++) {
      var b = bursts[i];
      var f = gibFrames[Math.min(GIB_COUNT - 1, Math.floor(b.t * GIB_FPS))];
      g.drawImage(f, b.x - GIB_ANCHOR[0] * GIB_SCALE, b.y - GIB_ANCHOR[1] * GIB_SCALE);
    }
  }

  // Les gerbes d'eau passent devant les lapins : on les dessine a part.
  function drawSplashes(g) {
    for (var i = 0; i < splashes.length; i++) {
      var s = splashes[i];
      var f = eauFrames[Math.min(eauFrames.length - 1, Math.floor(s.t * EAU_FPS))];
      g.drawImage(f.c, s.x - f.w / 2, Water.surface(s.x) - f.h + 3);
    }
  }

  /* ==========================================================
     SON — petit synthetiseur, pas de fichiers a charger
     ========================================================== */

  // Quatre bruitages sont fournis en fichier ; le reste est synthetise.
  // Un fichier absent ou pas encore decode retombe automatiquement sur
  // le son de synthese, donc le jeu ne devient jamais muet.
  var SFX_FILES = {
    jump: "jump.wav", death: "death.wav", spring: "spring.wav", splash: "splash.wav"
  };

  var Sfx = {
    ctx: null, vol: 0.5, on: true, raw: {}, buf: {},
    wake: function () {
      if (!this.ctx) {
        var C = window.AudioContext || window.webkitAudioContext;
        if (C) this.ctx = new C();
      }
      if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
      this.decode();
    },
    decode: function () {
      if (!this.ctx) return;
      var self = this;
      Object.keys(this.raw).forEach(function (k) {
        var ab = self.raw[k];
        if (!ab || self.buf[k]) return;
        self.raw[k] = null;
        self.ctx.decodeAudioData(ab,
          function (b) { self.buf[k] = b; },
          function () { /* format refuse : on garde la synthese */ });
      });
    },
    sample: function (name, gain) {
      if (!this.on || !this.ctx || !this.buf[name]) return false;
      var s = this.ctx.createBufferSource();
      s.buffer = this.buf[name];
      var g = this.ctx.createGain();
      g.gain.value = (gain === undefined ? 1 : gain) * this.vol;
      s.connect(g);
      g.connect(this.ctx.destination);
      s.start();
      return true;
    },
    tone: function (f0, f1, dur, type, gain) {
      if (!this.on || !this.ctx) return;
      var t = this.ctx.currentTime;
      var o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = type || "square";
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain * this.vol, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(this.ctx.destination);
      o.start(t); o.stop(t + dur + 0.02);
    },
    noise: function (dur, gain, freq) {
      if (!this.on || !this.ctx) return;
      var t = this.ctx.currentTime, n = Math.floor(this.ctx.sampleRate * dur);
      var buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate), d = buf.getChannelData(0);
      for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
      var s = this.ctx.createBufferSource(); s.buffer = buf;
      var f = this.ctx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = freq || 900;
      var g = this.ctx.createGain(); g.gain.value = gain * this.vol;
      s.connect(f); f.connect(g); g.connect(this.ctx.destination);
      s.start(t);
    },
    jump: function () {
      if (!this.sample("jump", 0.75)) this.tone(360, 640, 0.11, "square", 0.16);
    },
    land: function () { this.noise(0.07, 0.12, 500); },
    stroke: function () { this.noise(0.13, 0.10, 420); },
    splash: function () {
      if (!this.sample("splash", 0.85)) this.noise(0.32, 0.28, 1500);
    },
    boing: function () {
      if (!this.sample("spring", 0.9)) this.tone(180, 900, 0.26, "sawtooth", 0.22);
    },
    die: function () {
      if (this.sample("death", 0.9)) return;
      this.tone(700, 90, 0.34, "sawtooth", 0.24);
      this.noise(0.2, 0.2, 700);
    },
    point: function () { this.tone(760, 1180, 0.1, "triangle", 0.2); }
  };

  /* ==========================================================
     COMMANDES
     ========================================================== */

  // Chaque commande accepte plusieurs touches : le joueur en ajoute
  // autant qu'il veut depuis les reglages.
  var DEFAULT_KEYS = {
    left: ["KeyQ"], right: ["KeyD"], jump: ["KeyZ"], down: ["KeyS"]
  };
  var keys = {}, down = {};

  function copyKeys(src) {
    var out = {};
    Object.keys(DEFAULT_KEYS).forEach(function (k) {
      var v = src && src[k];
      // Les anciennes sauvegardes ne gardaient qu'une touche par
      // commande : on les relit sans rien perdre.
      if (typeof v === "string") v = [v];
      out[k] = (v && v.length ? v : DEFAULT_KEYS[k]).slice();
    });
    return out;
  }

  keys = copyKeys(DEFAULT_KEYS);
  try {
    var saved = JSON.parse(localStorage.getItem("jnb.keys") || "null");
    if (saved) keys = copyKeys(saved);
  } catch (e) { /* premier lancement */ }

  api.keys = keys;
  api.defaultKeys = DEFAULT_KEYS;
  api.resetKeys = function () {
    Object.keys(DEFAULT_KEYS).forEach(function (k) { keys[k] = DEFAULT_KEYS[k].slice(); });
    api.saveKeys();
  };
  api.keyBound = bound;
  api.saveKeys = function () {
    try { localStorage.setItem("jnb.keys", JSON.stringify(keys)); } catch (e) { /* mode prive */ }
  };
  api.sfx = Sfx;

  function bound(code) {
    var k = Object.keys(keys);
    for (var i = 0; i < k.length; i++) {
      if (keys[k[i]].indexOf(code) >= 0) return true;
    }
    return false;
  }

  window.addEventListener("keydown", function (e) {
    down[e.code] = true;
    if (running && !paused && bound(e.code)) e.preventDefault();
  });
  window.addEventListener("keyup", function (e) { down[e.code] = false; });
  window.addEventListener("blur", function () { down = {}; });

  function held(list) {
    for (var i = 0; i < list.length; i++) {
      if (down[list[i]]) return true;
    }
    return false;
  }

  function readInput() {
    if (paused || locked) return { l: false, r: false, j: false, d: false };
    return {
      l: held(keys.left), r: held(keys.right),
      j: held(keys.jump), d: held(keys.down)
    };
  }

  /* ==========================================================
     LAPINS
     ========================================================== */

  function makePlayer(info) {
    return {
      id: info.id, name: info.name, color: info.color,
      bot: !!info.bot, local: false,
      x: 200, y: 400, vx: 0, vy: 0,
      face: 1, anim: 0, onGround: false, onIce: false,
      alive: true, life: 0, score: info.score || 0,
      dead: 0, shield: 0, stroke: 0, coyote: 0, buffer: 0,
      jumpHeld: false, ownJump: false, squash: 0, bob: 0, wasWet: false, swimming: false,
      ear: 0, lean: 0, land: 0,
      brain: { t: 0, aim: 0, hop: 0, dive: false, stuck: 0, tries: 0, lx: 0, ly: 0, far: 0, fx: 0 },
      buf: [], rx: 200, ry: 400, rface: 1, ranim: 0, lastRx: 0, gapAvg: 0
    };
  }

  function pickSpawn(p) {
    if (!spawns.length) return { x: 200, y: 400 };
    var best = null, bestScore = -1;
    for (var tries = 0; tries < 14; tries++) {
      var s = spawns[Math.floor(Math.random() * spawns.length)];
      var far = 1e9;
      for (var i = 0; i < order.length; i++) {
        var o = players[order[i]];
        if (!o || o === p || !o.alive) continue;
        var d = Math.hypot(o.x - s.x, o.y - s.y);
        if (d < far) far = d;
      }
      if (far > bestScore) { bestScore = far; best = s; }
      if (far > 420) break;
    }
    return best;
  }

  function respawn(p, at) {
    var s = at || pickSpawn(p);
    p.x = s.x; p.y = s.y;
    p.vx = 0; p.vy = 0;
    p.alive = true; p.dead = 0; p.shield = SPAWN_SHIELD;
    p.onGround = true; p.squash = 0;
    // Sans ca, un lapin mort dans le bassin declenche une gerbe a son
    // point de reapparition, en pleine terre ferme.
    p.wasWet = false;
    p.ear = 0; p.lean = 0; p.land = 0;
  }

  function killed(p, killer) {
    if (!p.alive) return;
    p.alive = false;
    p.dead = DEAD_TIME;
    burstBlood(p.x, p.y);
    if (p === me || killer === me) Sfx.die();
    if (killer && killer === me) Sfx.point();
  }

  /* --- cerveau des lapins d'entrainement --- */

  function botInput(p, dt) {
    var b = p.brain;
    b.t -= dt;

    // Anti-blocage. Deux garde-fous : un lapin immobile depuis une
    // seconde fait demi-tour et saute ; et si, au bout de trois
    // secondes, il n'a pas quitte un rayon de trente pixels, c'est que
    // le recoin n'a pas de sortie — on le fait reapparaitre ailleurs.
    if (Math.abs(p.x - b.lx) > 4 || Math.abs(p.y - b.ly) > 4) {
      b.stuck = 0;
      b.lx = p.x;
      b.ly = p.y;
    } else {
      b.stuck += dt;
      if (b.stuck > 1) {
        b.stuck = 0;
        b.aim = -b.aim || 1;
        b.hop = 1;
        b.t = 0.8;
      }
    }
    b.far += dt;
    if (Math.abs(p.x - b.fx) > 30) { b.far = 0; b.fx = p.x; }
    else if (b.far > 3) { b.far = 0; b.fx = p.x; respawn(p, pickSpawn(p)); }

    var prey = null, best = 1e9;
    for (var i = 0; i < order.length; i++) {
      var o = players[order[i]];
      if (!o || o === p || !o.alive) continue;
      var d = Math.hypot(o.x - p.x, o.y - p.y);
      if (d < best) { best = d; prey = o; }
    }
    if (b.t <= 0) {
      b.t = 0.25 + Math.random() * 0.5;
      b.aim = prey ? Math.sign(prey.x - p.x) || (Math.random() < 0.5 ? -1 : 1)
        : (Math.random() < 0.5 ? -1 : 1);
      // Sauter pour retomber dessus, ou par pur enthousiasme.
      b.hop = prey && (prey.y > p.y + 30 || Math.abs(prey.x - p.x) < 90) ? 1 :
        (Math.random() < 0.35 ? 1 : 0);
      b.dive = !!(prey && prey.y > p.y + 70 && Math.abs(prey.x - p.x) < 60);
    }
    var wall = colBlocked(p.x + b.aim * (HW + 4), p.y - BODY_H + 1, p.y);
    var ahead = p.x + b.aim * 34;
    var edge = p.onGround && !rowBlocked(ahead - 4, ahead + 4, p.y + 8);
    if (edge && Math.random() < 0.5) b.aim = -b.aim;
    return {
      l: b.aim < 0, r: b.aim > 0,
      j: (b.hop && p.onGround) || wall || (submersion(p) > 0.4),
      d: prey ? (prey.y > p.y + 70 && !p.onGround) : false
    };
  }

  /* --- simulation d'un lapin --- */

  // Dans le lobby il n'y a pas de gravite : on se promene sur le plan
  // de la clairiere, gauche-droite et fond-avant, comme sur une carte
  // vue de trois quarts.
  var PLANE_ACC = 4200, PLANE_MAX = 285, PLANE_DAMP = 0.00002;

  function stepPlane(p, inp, dt) {
    var dx = (inp.r ? 1 : 0) - (inp.l ? 1 : 0);
    var dy = (inp.d ? 1 : 0) - (inp.j ? 1 : 0);
    if (dx && dy) { dx *= 0.707; dy *= 0.707; }   // pas plus vite en diagonale

    if (dx) { p.vx += dx * PLANE_ACC * dt; p.face = dx > 0 ? 1 : -1; }
    else { p.vx *= Math.pow(PLANE_DAMP, dt); if (Math.abs(p.vx) < 4) p.vx = 0; }
    if (dy) p.vy += dy * PLANE_ACC * dt;
    else { p.vy *= Math.pow(PLANE_DAMP, dt); if (Math.abs(p.vy) < 4) p.vy = 0; }
    p.vx = Math.max(-PLANE_MAX, Math.min(PLANE_MAX, p.vx));
    p.vy = Math.max(-PLANE_MAX, Math.min(PLANE_MAX, p.vy));

    if (boxBlocked(p.x, p.y)) unstick(p);
    moveX(p, p.vx * dt);
    moveY(p, p.vy * dt);
    p.y = Math.max(LOBBY.top + BODY_H, Math.min(LOBBY.ground, p.y));

    p.onGround = true;
    p.onIce = false;
    p.anim = (dx || dy) ? 1 : 0;
  }

  function stepPlayer(p, inp, dt) {
    if (!p.alive) return;
    if (scene === "lobby") { stepPlane(p, inp, dt); return; }
    // Un rebond mal place, une apparition trop pres d'un rocher : si le
    // corps chevauche le decor, plus rien ne bouge. On le repousse au
    // plus court plutot que de le laisser fige.
    if (boxBlocked(p.x, p.y)) unstick(p);

    var wet = submersion(p);
    p.swimming = wet > 0.2;
    var wasWet = p.wasWet;
    p.wasWet = wet > 0.2;

    // Entree et sortie d'eau : gerbe et onde sur la surface.
    if (p.wasWet !== wasWet && inPool(p.x)) {
      var speed = Math.abs(p.vy);
      Water.splash(p.x, (p.wasWet ? 1 : -0.6) * Math.min(120, 18 + speed * 0.16));
      burstDrops(p.x, Water.surface(p.x), 8, Math.min(340, 90 + speed * 0.5));
      splashWater(p.x);
      if (speed > 90) Sfx.splash();
    }

    var acc, max, damp;
    if (wet > 0.35) {
      acc = WALK_ACC * SWIM_ACC; max = WALK_MAX * SWIM_MAX; damp = SWIM_DAMP;
    } else if (p.onGround) {
      acc = p.onIce ? ICE_ACC : WALK_ACC;
      max = WALK_MAX;
      damp = p.onIce ? ICE_DAMP : null;
    } else {
      acc = AIR_ACC; max = WALK_MAX; damp = null;
    }

    var dir = (inp.r ? 1 : 0) - (inp.l ? 1 : 0);
    if (dir) {
      p.vx += dir * acc * dt;
      if (Math.abs(p.vx) > max) {
        // Sur la glace, l'elan acquis se garde ; ailleurs on plafonne.
        if (!p.onIce || Math.sign(p.vx) !== dir) p.vx = dir * max;
      }
      p.face = dir;
    } else {
      var f = damp !== null ? Math.pow(damp, dt) :
        (p.onGround ? Math.pow(GROUND_DAMP, dt) : Math.pow(AIR_DAMP, dt));
      p.vx *= f;
      if (Math.abs(p.vx) < 4) p.vx = 0;
    }

    // Saut : indulgence apres avoir quitte le sol, et memoire de la
    // touche pressee un peu trop tot.
    if (p.onGround) p.coyote = COYOTE; else p.coyote -= dt;
    if (inp.j && !p.jumpHeld) p.buffer = BUFFER; else p.buffer -= dt;
    p.jumpHeld = inp.j;
    p.stroke -= dt;

    if (wet > 0.35) {
      // Dans l'eau on saute comme sur terre, mais en boucle : c'est ce
      // qui permet de ressortir du bassin sans chercher un rebord.
      if (p.buffer > 0 && p.stroke <= 0) {
        p.vy = -JUMP_V * SWIM_JUMP;
        p.stroke = STROKE_CD;
        p.buffer = 0;
        p.ownJump = true;
        Water.splash(p.x, 26);
        burstDrops(p.x, Water.surface(p.x), 5, 160);
      }
    } else if (p.buffer > 0 && p.coyote > 0) {
      p.vy = -JUMP_V * (p.onIce ? 0.94 : 1);
      p.buffer = 0; p.coyote = 0;
      p.onGround = false;
      p.ownJump = true;
      p.squash = -0.5;
      puff(p.x, p.y, 0.25);
      if (p === me) Sfx.jump();
    }
    // Le saut se dose en relachant la touche — mais seulement pour un
    // saut qu'on a soi-meme lance. Une propulsion subie (trampoline,
    // rebond sur une tete) ne doit pas fondre parce que personne
    // n'appuie sur rien.
    if (p.ownJump && !inp.j && p.vy < 0 && wet < 0.35) {
      p.vy *= Math.pow(JUMP_CUT, dt * 8);
    }
    if (p.vy >= 0) p.ownJump = false;

    // Gravite, poussee d'Archimede, plongeon.
    var g = GRAVITY;
    if (wet > 0.15) {
      g *= SWIM_G;
      p.vy -= BUOY * wet * dt;
      p.vy *= Math.pow(SWIM_VDAMP, dt);
    } else if (inp.d && !p.onGround) {
      g *= DIVE;
    }
    p.vy += g * dt;
    p.vy = Math.max(-2600, Math.min(wet > 0.35 ? 420 : 2000, p.vy));

    var prevVy = p.vy;
    moveX(p, p.vx * dt);
    var wasAir = !p.onGround;
    moveY(p, p.vy * dt);

    // Meme largeur que la sonde de chute : sinon un lapin arrete par un
    // pixel de bord n'est jamais « au sol », donc ne saute plus et ne
    // franchit plus rien.
    p.onGround = p.vy >= 0 && rowBlocked(p.x - HW, p.x + HW, p.y + 1);
    if (p.onGround) {
      p.onIce = rowIce(p.x - HW, p.x + HW, p.y + 1);
      if (wasAir && prevVy > 200) {
        p.squash = Math.min(0.6, prevVy / 2600);
        p.ear = -0.95;
        p.land = 0.26;
        puff(p.x, p.y, Math.min(1, prevVy / 1500));
        if (p === me) Sfx.land();
      }
      // Le trampoline : atterrir sur la caisse renvoie tres haut.
      if (prevVy > 60 && p.x > BUMPER.x && p.x < BUMPER.x + BUMPER.w &&
        p.y > BUMPER.y - 10 && p.y < BUMPER.y + 12) {
        p.vy = -BUMP_V;
        p.onGround = false;
        p.ownJump = false;
        p.squash = -0.7;
        for (var i = 0; i < 12; i++) {
          spark(p.x + (Math.random() - 0.5) * 60, BUMPER.y,
            (Math.random() - 0.5) * 220, -140 - Math.random() * 200,
            0.4 + Math.random() * 0.4, "#FFD447", 3 + Math.random() * 3, 0.5);
        }
        if (p === me) Sfx.boing();
      }
    } else {
      p.onIce = false;
    }

    if (p.y > MAP_H - 2) p.y = MAP_H - 2;

    // La pose se deduit entierement de l'etat : la planche n'en a qu'une
    // par lapin, tout le reste est du mouvement calcule.
    p.anim = wet > 0.35 ? 4 : !p.onGround ? (p.vy < 0 ? 2 : 3) : (Math.abs(p.vx) > 25 ? 1 : 0);

    if (wet > 0.5 && Math.random() < dt * 6) {
      spark(p.x + (Math.random() - 0.5) * 20, p.y - 30, 0, -40 - Math.random() * 40,
        0.8, "rgba(210,240,255,.7)", 2 + Math.random() * 2, -0.06);
    }
  }

  function unstick(p) {
    for (var r = 1; r <= 70; r++) {
      if (!boxBlocked(p.x, p.y - r)) { p.y -= r; return; }
      if (!boxBlocked(p.x - r, p.y)) { p.x -= r; return; }
      if (!boxBlocked(p.x + r, p.y)) { p.x += r; return; }
      if (!boxBlocked(p.x, p.y + r)) { p.y += r; return; }
    }
    respawn(p, pickSpawn(p));
  }

  function moveX(p, dx) {
    if (!dx) return;
    var step = dx > 0 ? 1 : -1, left = Math.abs(dx);
    while (left > 0) {
      var adv = Math.min(1, left) * step;
      left -= 1;
      var edge = p.x + adv + step * HW;
      if (!colBlocked(edge, p.y - BODY_H + 1, p.y)) { p.x += adv; continue; }

      // Une bosse d'herbe ou un caillou : on l'enjambe si le corps tient
      // a la nouvelle hauteur, sinon c'est un mur.
      var climbed = false;
      var reach = p.swimming ? WATER_STEP : STEP_UP;
      if ((p.onGround || p.swimming) && scene !== "lobby") {
        for (var up = 1; up <= reach; up++) {
          if (!colBlocked(edge, p.y - up - BODY_H + 1, p.y - up) &&
            !rowBlocked(p.x + adv - HW, p.x + adv + HW, p.y - up - BODY_H + 1)) {
            p.x += adv;
            p.y -= up;
            climbed = true;
            break;
          }
        }
      }
      if (!climbed) { p.vx = 0; return; }
    }
  }

  function moveY(p, dy) {
    if (!dy) return;
    var step = dy > 0 ? 1 : -1, left = Math.abs(dy);
    while (left > 0) {
      var adv = Math.min(1, left) * step;
      left -= 1;
      var edge = dy > 0 ? p.y + adv : p.y + adv - BODY_H + 1;
      if (!rowBlocked(p.x - HW, p.x + HW, edge)) { p.y += adv; continue; }
      p.vy = 0;
      return;
    }
  }

  /* --- sauts mortels : seul le tueur les declare --- */

  function checkStomps() {
    if (phase !== "playing") return;
    for (var a = 0; a < order.length; a++) {
      var A = players[order[a]];
      // Un seul navigateur declare chaque mort : le sien, et ceux des
      // lapins qu'il pilote en entrainement.
      if (!A || (!A.local && !A.bot) || !A.alive || A.shield > 0) continue;
      if (A.vy <= STOMP_VY) continue;
      for (var b = 0; b < order.length; b++) {
        var B = players[order[b]];
        if (!B || B === A || !B.alive || B.shield > 0) continue;
        if (Math.abs(A.x - B.x) > BODY_W) continue;
        if (A.y < B.y - BODY_H || A.y - BODY_H > B.y) continue;
        if (A.y > B.y - BODY_H + STOMP_HEAD) continue;   // il faut arriver par le haut
        A.vy = -JUMP_V * 0.72;
        A.ownJump = false;
        A.squash = -0.4;
        killed(B, A);
        if (A.local && api.onKill) api.onKill(B.id, B.life);
        else if (A.bot) A.score++;
        break;
      }
    }
  }

  // Les lapins ne se traversent plus. Chaque navigateur ne deplace que
  // les lapins qu'il simule : les deux clients se repoussent donc
  // symetriquement, sans se disputer la meme position. La poussee est
  // horizontale seulement — sinon on glisserait de la tete d'un
  // adversaire avant que le saut mortel n'ait le temps de compter.
  function separate(dt) {
    if (phase === "over") return;
    for (var a = 0; a < order.length; a++) {
      var A = players[order[a]];
      if (!A || (!A.local && !A.bot) || !A.alive) continue;
      for (var b = 0; b < order.length; b++) {
        var B = players[order[b]];
        if (!B || B === A || !B.alive) continue;
        var dy = A.y - B.y;
        if (Math.abs(dy) > BODY_H * 0.6) continue;      // l'un est au-dessus
        var dx = A.x - B.x;
        var gap = BODY_W - Math.abs(dx);
        if (gap <= 0) continue;
        var dir = dx === 0 ? (A.id > B.id ? 1 : -1) : (dx > 0 ? 1 : -1);
        var step = Math.min(gap * 0.6, 5);
        if (!boxBlocked(A.x + dir * step, A.y)) A.x += dir * step;
        // Sans couper l'elan qui rentre dans l'autre, un lapin qui
        // marche droit sur son voisin annule la poussee et les deux
        // restent encastres.
        if (A.vx * dir < 0) A.vx *= Math.pow(0.02, dt);
        if (Math.abs(A.vx) < WALK_MAX * 1.5) A.vx += dir * 700 * dt;
      }
    }
  }

  /* ==========================================================
     BOUCLE
     ========================================================== */

  function tick(dt) {
    clock += dt;
    Water.step(dt);
    Butterflies.step(dt);
    stepFx(dt);

    var i, p;
    for (i = 0; i < order.length; i++) {
      p = players[order[i]];
      if (!p) continue;
      // Invulnerabilite et compte a rebours de la mort : au niveau de la
      // boucle, pas dans la physique, sinon les lapins des autres — qui
      // ne passent jamais par elle — restent invulnerables a vie.
      if (p.shield > 0) p.shield -= dt;
      if (!p.alive) p.dead -= dt;
      animate(p, dt);

      if (p.local) stepPlayer(p, readInput(), dt);
      else if (p.bot) stepPlayer(p, botInput(p, dt), dt);
      else stepRemote(p, dt);

      if (!p.alive && p.dead <= 0 && (p.local || p.bot)) {
        var s = pickSpawn(p);
        respawn(p, s);
        p.life++;
        if (p.local && api.onRespawn) api.onRespawn(s.x, s.y);
      }
    }
    checkStomps();
    separate(dt);
  }

  // Les lapins des autres sont rejoues avec 100 ms de retard : on
  // interpole entre deux positions recues au lieu de les faire sauter.
  // Le retard d'affichage suit le rythme reel des paquets : court quand
  // le reseau est regulier, plus long quand il hoquette. Un retard fixe
  // etait soit trop grand (jeu mou) soit trop petit (lapins qui sautent).
  function stepRemote(p, dt) {
    // On vise juste derriere le dernier paquet recu et on extrapole le
    // reste a la vitesse connue : le lapin d'en face colle au present au
    // lieu d'etre affiche dans le passe.
    var gap = p.gapAvg || 0.028;
    var delay = Math.max(0.018, Math.min(0.10, gap * 0.85));
    var t = clock - delay, b = p.buf;
    while (b.length > 2 && b[1].t <= t) b.shift();
    if (!b.length) return;
    if (b.length === 1 || b[0].t >= t) {
      var s0 = b[0], ahead = Math.max(0, Math.min(0.25, t - s0.t));
      p.rx = s0.x + s0.vx * ahead;
      p.ry = s0.y + s0.vy * ahead;
      p.rface = s0.f; p.ranim = s0.a;
    } else {
      var a = b[0], c = b[1];
      var k = (t - a.t) / Math.max(0.001, c.t - a.t);
      k = Math.max(0, Math.min(1, k));
      p.rx = a.x + (c.x - a.x) * k;
      p.ry = a.y + (c.y - a.y) * k;
      p.rface = k < 0.5 ? a.f : c.f;
      p.ranim = k < 0.5 ? a.a : c.a;
    }
    p.x = p.rx; p.y = p.ry;
    p.face = p.rface; p.anim = p.ranim;
  }

  // Les ressorts d'animation tournent pour tout le monde, y compris les
  // lapins des autres joueurs qui ne passent jamais par la physique.
  function animate(p, dt) {
    // Sur le plan du lobby, la vitesse verticale est un deplacement, pas
    // une chute : les oreilles n'ont pas a s'affoler.
    var tgt = scene === "lobby" ? 0 : Math.max(-1, Math.min(1, -p.vy / 1200));
    p.ear += (tgt - p.ear) * Math.min(1, 11 * dt);
    var lt = Math.max(-1, Math.min(1, p.vx / 420));
    p.lean += (lt - p.lean) * Math.min(1, 8 * dt);
    p.squash *= Math.pow(0.02, dt);
    p.land = Math.max(0, p.land - dt);
    p.bob += Math.abs(p.vx) * dt * 0.055;
  }

  function frame(now) {
    if (!running) return;
    requestAnimationFrame(frame);
    var dt = Math.min(0.1, (now - lastT) / 1000 || 0);
    lastT = now;

    fpsAcc += dt;
    fpsN++;
    if (fpsAcc >= 0.5) { fps = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; }

    if (!paused) {
      acc += dt;
      var guard = 0;
      while (acc >= 1 / 120 && guard++ < 8) { tick(1 / 120); acc -= 1 / 120; }

      netAcc += dt;
      if (netAcc >= 1 / 40) {
        netAcc = 0;
        if (me && api.onSend) {
          // Coordonnees entieres : le message est plus court, et le
          // dixieme de pixel ne se voit pas apres interpolation.
          var st = {
            x: Math.round(me.x), y: Math.round(me.y),
            vx: Math.round(me.vx), vy: Math.round(me.vy),
            f: me.face, a: me.anim, st: me.alive ? 0 : 1
          };
          // Un lapin immobile n'a rien a raconter : on se contente d'un
          // rappel toutes les deux cents millisecondes.
          var key = st.x + "," + st.y + "," + st.f + "," + st.a + "," + st.st;
          if (key !== lastSent || now - lastSentAt > 200) {
            lastSent = key;
            lastSentAt = now;
            api.onSend(st);
          }
        }
      }
    }
    draw();
  }

  /* ==========================================================
     RENDU
     ========================================================== */

  var STRIPS = 12;

  // Le lapin est dessine en tranches horizontales. Chaque tranche est
  // decalee et etiree selon sa hauteur : les pattes restent plantees au
  // sol, le corps ondule, les oreilles suivent avec un temps de retard.
  // Les deux pattes, elles, sont decoupees a part et bougent seules.
  function drawBunny(g, p) {
    var s = bunny[p.color];
    var h = SPRITE_H, w = h * s.ratio;
    var pw = s.c.width, ph = s.c.height;
    var footTop = s.footTop, split = s.footSplit;
    var scaleX = w / pw;

    // ecrasement general : impact a l'atterrissage, foulee a la course
    var sq = p.squash;
    var sy = 1 - sq * 0.45, sx = 1 + sq * 0.4;
    var stride = Math.sin(p.bob * 6);
    if (p.anim === 1) {
      sy *= 1 + stride * 0.06;
      sx *= 1 - stride * 0.045;
    } else if (p.anim === 0) {
      sy *= 1 + Math.sin(clock * 2.6 + p.id) * 0.02;
    }

    // Les oreilles trainent derriere le mouvement : `ear` est un ressort
    // qui suit la vitesse verticale avec du retard, `lean` la vitesse
    // horizontale. C'est ce decalage qui rend le lapin vivant.
    var stretch = p.ear * 0.28;
    var swayL = -p.lean * p.face;
    var wig = (p.anim === 1 ? 1 : 0) + (p.anim === 4 ? 0.8 : 0);

    g.save();
    g.translate(p.x, p.y);
    g.rotate(Math.max(-0.18, Math.min(0.18, p.vx / 3200)));
    g.scale(p.face * sx, sy);

    var map = function (t) { return t * (1 + stretch * t); };
    var i, r0, r1, t0, t1, tm, dx;

    for (i = 0; i < STRIPS; i++) {
      r0 = footTop * i / STRIPS;
      r1 = footTop * (i + 1) / STRIPS;
      t0 = 1 - r0 / ph;
      t1 = 1 - r1 / ph;
      tm = (t0 + t1) / 2;
      // L'onde qui remonte le corps se creuse a hauteur de la queue :
      // c'est elle qui la fait fretiller quand le lapin court.
      var tail = Math.exp(-Math.pow((tm - 0.45) / 0.17, 2));
      dx = swayL * 4.2 * Math.pow(tm, 1.8) +
        wig * Math.sin(tm * 5 - p.bob * 6) * (1.4 + tail * 2);
      g.drawImage(s.c, 0, r0, pw, r1 - r0,
        -w / 2 + dx, -h * map(t0), w, h * (map(t0) - map(t1)) + 0.8);
    }

    // Pattes : elles ne descendent jamais sous leur place, sinon un
    // liseré de fond apparaitrait entre le ventre et le pied.
    var fy = -h * map(1 - footTop / ph), fh = -fy;
    var lx = 0, ly = 0, rx = 0, ry = 0;
    if (p.anim === 1) {
      ly = -Math.max(0, stride) * 3.4;
      ry = -Math.max(0, -stride) * 3.4;
      lx = stride * 1.9;
      rx = -stride * 1.9;
    } else if (p.anim === 2) {
      ly = ry = -3.6; lx = 1.3; rx = -1.3;
    } else if (p.anim === 3) {
      ly = ry = -1.2; lx = -1.3; rx = 1.3;
    } else if (p.anim === 4) {
      ly = -Math.max(0, Math.sin(clock * 9)) * 3;
      ry = -Math.max(0, -Math.sin(clock * 9)) * 3;
    }
    if (p.land > 0) {
      var kick = p.land / 0.26;
      lx -= 2.6 * kick; rx += 2.6 * kick; ly = ry = 0;
    }
    g.drawImage(s.c, 0, footTop, split, ph - footTop,
      -w / 2 + lx, fy + ly, split * scaleX, fh);
    g.drawImage(s.c, split, footTop, pw - split, ph - footTop,
      -w / 2 + split * scaleX + rx, fy + ry, (pw - split) * scaleX, fh);
    g.restore();

  }

  // Deux chevrons au-dessus de la caisse : le seul element de decor
  // dont le comportement ne se devine pas a l'oeil.
  function drawBumper(g) {
    var cx = BUMPER.x + BUMPER.w / 2;
    g.save();
    g.strokeStyle = "#FFD447";
    g.lineWidth = 5;
    g.lineCap = "round";
    g.lineJoin = "round";
    for (var i = 0; i < 2; i++) {
      var t = (clock * 1.5 + i * 0.5) % 1;
      var y = BUMPER.y - 16 - t * 34;
      g.globalAlpha = 0.55 * Math.sin(t * Math.PI);
      g.beginPath();
      g.moveTo(cx - 13, y + 9);
      g.lineTo(cx, y);
      g.lineTo(cx + 13, y + 9);
      g.stroke();
    }
    g.restore();
  }

  function drawWater(g) {
    var i, x;
    g.save();
    g.beginPath();
    g.moveTo(POOL.x0, Water.surface(POOL.x0));
    for (i = 1; i <= Water.n; i++) {
      x = POOL.x0 + i * Water.col;
      g.lineTo(x, Water.surface(x));
    }
    g.lineTo(POOL.x1, MAP_H);
    g.lineTo(POOL.x0, MAP_H);
    g.closePath();

    if (!waterGrad) {
      // Un degrade se recree a l'identique a chaque image sinon.
      waterGrad = g.createLinearGradient(0, POOL.y - 12, 0, MAP_H);
      waterGrad.addColorStop(0, "rgba(120,215,255,.42)");
      waterGrad.addColorStop(0.16, "rgba(24,132,240,.30)");
      waterGrad.addColorStop(1, "rgba(4,52,140,.42)");
    }
    g.fillStyle = waterGrad;
    g.fill();

    // La crete : un trait clair, double d'un halo.
    g.beginPath();
    g.moveTo(POOL.x0, Water.surface(POOL.x0));
    for (i = 1; i <= Water.n; i++) {
      x = POOL.x0 + i * Water.col;
      g.lineTo(x, Water.surface(x));
    }
    g.strokeStyle = "rgba(180,235,255,.35)";
    g.lineWidth = 9;
    g.stroke();
    g.strokeStyle = "rgba(240,252,255,.95)";
    g.lineWidth = 3;
    g.stroke();
    g.restore();
  }

  function drawUnderwater(g) {
    g.save();
    g.beginPath();
    g.moveTo(POOL.x0, Water.surface(POOL.x0) + 3);
    for (var i = 1; i <= Water.n; i++) {
      var x = POOL.x0 + i * Water.col;
      g.lineTo(x, Water.surface(x) + 3);
    }
    g.lineTo(POOL.x1, MAP_H);
    g.lineTo(POOL.x0, MAP_H);
    g.closePath();
    g.fillStyle = "rgba(20,120,225,.30)";
    g.fill();
    g.restore();
  }

  function drawNumber(g, n, box) {
    var text = String(n), count = text.length;
    var pad = 8, availW = box[2] - pad * 2, availH = box[3] - pad * 2;
    var dh = availH, dw = 0, i, d;
    for (i = 0; i < count; i++) dw += digits[+text[i]].ratio * dh;
    dw += (count - 1) * 6;
    if (dw > availW) { dh *= availW / dw; dw = availW; }
    var x = box[0] + box[2] / 2 - dw / 2, y = box[1] + box[3] / 2 - dh / 2;
    for (i = 0; i < count; i++) {
      d = digits[+text[i]];
      var w = d.ratio * dh;
      g.drawImage(d.c, x, y, w, dh);
      x += w + 6;
    }
  }

  var panelCache = null, panelKey = "";

  // Le panneau ne bouge qu'au changement de score, de nom ou de pelage :
  // le redessiner soixante fois par seconde — avec ses mesures de texte —
  // etait le poste le plus cher du rendu.
  function drawPanel(g) {
    var key = order.length + "|";
    for (var i = 0; i < order.length; i++) {
      var q = players[order[i]];
      key += q ? q.id + "," + q.name + "," + q.color + "," + q.score + "," + (q.alive ? 1 : 0) + "|" : "-|";
    }
    if (key !== panelKey) {
      panelKey = key;
      if (!panelCache || panelCache.width !== MAP_W - PLAY_W) {
        panelCache = scratch(MAP_W - PLAY_W, MAP_H);
      }
      var pg = panelCache.getContext("2d");
      pg.clearRect(0, 0, panelCache.width, panelCache.height);
      pg.save();
      pg.translate(-PLAY_W, 0);
      renderPanel(pg);
      pg.restore();
    }
    g.drawImage(panelCache, PLAY_W, 0);
  }

  function renderPanel(g) {
    for (var i = 0; i < SLOTS.length; i++) {
      var slot = SLOTS[i], p = players[order[i]];
      if (!p) continue;
      var face = slot.face, nb = slot.name, sb = slot.score;

      // Portrait : le lapin dans son alveole, taille pour y tenir.
      var s = bunny[p.color];
      var h = Math.min(face[3] - 6, (face[2] - 8) / s.ratio), w = h * s.ratio;
      g.save();
      g.globalAlpha = p.alive ? 1 : 0.35;
      g.drawImage(s.c, face[0] + face[2] / 2 - w / 2, face[1] + face[3] / 2 - h / 2, w, h);
      g.restore();

      // Le panneau porte des prenoms graves dans l'image ; on pose une
      // plaque par-dessus pour y ecrire les nos.
      g.save();
      g.fillStyle = "rgba(24,25,27,.94)";
      roundRect(g, nb[0], nb[1], nb[2], nb[3], 7);
      g.fill();
      g.strokeStyle = "rgba(255,255,255,.16)";
      g.lineWidth = 1.5;
      g.stroke();

      var size = nb[3] * 0.56;
      g.font = "700 " + size + "px 'Archivo Black', 'Space Mono', sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      var label = p.name.length > 9 ? p.name.slice(0, 9) : p.name;
      while (g.measureText(label).width > nb[2] - 14 && size > 8) {
        size -= 1;
        g.font = "700 " + size + "px 'Archivo Black', 'Space Mono', sans-serif";
      }
      g.lineWidth = 3.5;
      g.strokeStyle = "rgba(0,0,0,.85)";
      g.strokeText(label, nb[0] + nb[2] / 2, nb[1] + nb[3] / 2 + 1);
      g.fillStyle = COLORS[p.color].tint;
      g.fillText(label, nb[0] + nb[2] / 2, nb[1] + nb[3] / 2 + 1);
      g.restore();

      drawNumber(g, p.score, sb);
    }
    // Les emplacements vides : le panneau porte des prenoms graves, on
    // les recouvre pour ne pas laisser croire a des joueurs fantomes.
    for (var k = order.length; k < 4; k++) {
      var e = SLOTS[k];
      g.save();
      g.fillStyle = "rgba(12,13,15,.62)";
      roundRect(g, e.face[0] - 6, e.face[1] - 6, e.face[2] + 12, e.face[3] + 12, 10);
      g.fill();
      g.fillStyle = "rgba(20,21,24,.96)";
      roundRect(g, e.name[0], e.name[1], e.name[2], e.name[3], 7);
      g.fill();
      g.fillStyle = "rgba(12,13,15,.62)";
      roundRect(g, e.score[0], e.score[1], e.score[2], e.score[3], 10);
      g.fill();
      g.font = "700 " + (e.name[3] * 0.46) + "px 'Archivo Black', 'Space Mono', sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillStyle = "rgba(237,231,218,.34)";
      g.fillText("LIBRE", e.name[0] + e.name[2] / 2, e.name[1] + e.name[3] / 2 + 1);
      g.restore();
    }
  }

  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  function draw() {
    var g = ctx, arena = scene === "arena";
    g.clearRect(0, 0, MAP_W, MAP_H);
    g.drawImage(mapCanvas, 0, 0);

    Butterflies.draw(g);
    if (arena) {
      drawWater(g);
      drawBumper(g);
    }

    var i, p;
    for (i = 0; i < order.length; i++) {
      p = players[order[i]];
      if (!p) continue;
      if (p.alive) drawBunny(g, p);
    }
    drawFx(g);
    if (arena) {
      drawSplashes(g);
      g.drawImage(treeCanvas, TREE.x, TREE.y);
      drawUnderwater(g);
      drawPanel(g);
    }

    if (banner) {
      g.save();
      g.textAlign = "center";
      g.font = "700 58px 'Archivo Black', sans-serif";
      g.lineWidth = 10;
      g.strokeStyle = "rgba(0,0,0,.8)";
      g.fillStyle = "#FFD447";
      g.strokeText(banner, PLAY_W / 2, 140);
      g.fillText(banner, PLAY_W / 2, 140);
      g.restore();
    }
    drawCountdown(g);
    drawStats(g);
    if (paused || locked) {
      g.save();
      g.fillStyle = "rgba(10,10,11,.55)";
      g.fillRect(0, 0, PLAY_W, MAP_H);
      g.restore();
    }
  }

  // Le decompte reprend les chiffres graves du panneau de score : gros,
  // au centre, chaque seconde entre d'un coup puis s'efface.
  // Images par seconde et latence, en bas a gauche : de quoi savoir tout
  // de suite si ca rame a cause de la machine ou du reseau.
  function drawStats(g) {
    var t = fps + " FPS";
    if (netMs !== null) t = netMs + " ms  ·  " + t;
    g.save();
    g.font = "700 21px 'Space Mono', ui-monospace, monospace";
    g.textAlign = "left";
    g.textBaseline = "alphabetic";
    g.lineWidth = 4;
    g.strokeStyle = "rgba(0,0,0,.8)";
    g.strokeText(t, 16, MAP_H - 16);
    g.fillStyle = "#FF3B2F";
    g.fillText(t, 16, MAP_H - 16);
    g.restore();
  }

  api.setPing = function (ms) { netMs = ms; };

  function drawCountdown(g) {
    if (countdown === null || countdown <= 0) return;
    var n = Math.min(9, Math.ceil(countdown));
    var d = digits[n];
    var frac = countdown - Math.floor(countdown);
    if (frac === 0) frac = 1;
    var pop = 1 + Math.max(0, frac - 0.78) * 1.5;
    var h = MAP_H * 0.30 * pop, w = h * d.ratio;
    // Dans le lobby il s'affiche au-dessus de la clairiere de droite,
    // celle qu'il faut rejoindre ; en partie, au centre.
    var cx = scene === "lobby" ? (LOBBY.side + MAP_W) / 2 : MAP_W / 2;
    var cy = MAP_H * 0.44;
    var pw = h * 0.92, ph = h * 1.16;

    g.save();
    // Le chiffre tient presque toute la seconde puis s'efface d'un coup :
    // au-dessus du feuillage clair, une fondu lent le rendait illisible.
    g.globalAlpha = Math.min(1, frac * 4);
    // Les chiffres du panneau de score sont graves en clair sur du noir :
    // sans plaque derriere, ils disparaissent dans le ciel.
    g.fillStyle = "rgba(9,10,12,.84)";
    roundRect(g, cx - pw / 2, cy - ph / 2, pw, ph, h * 0.11);
    g.fill();
    g.strokeStyle = "rgba(237,231,218,.32)";
    g.lineWidth = Math.max(2, h * 0.015);
    g.stroke();
    g.drawImage(d.c, cx - w / 2, cy - h / 2, w, h);
    g.restore();
  }

  /* ==========================================================
     API PUBLIQUE
     ========================================================== */

  api.attach = function (canvas) {
    cvs = canvas;
    cvs.width = MAP_W;
    cvs.height = MAP_H;
    // `alpha:false` evite de melanger le canvas avec la page a chaque
    // trame, `desynchronized:true` court-circuite un etage de mise en
    // memoire tampon du navigateur : deux images de latence en moins
    // entre la touche et l'ecran.
    ctx = cvs.getContext("2d", { alpha: false, desynchronized: true });
    ctx.imageSmoothingQuality = "high";
  };

  api.start = function (opts) {
    useScene("arena");
    players = {}; order = [];
    parts.length = 0; smokes.length = 0; bursts.length = 0;
    chunks.length = 0; splashes.length = 0;
    if (decalsCtx) {
      decalsCtx.clearRect(0, 0, MAP_W, MAP_H);
      decalsCtx.drawImage(arenaWorld.clean, 0, 0);
    }
    phase = "playing";
    banner = null;
    me = null;

    for (var i = 0; i < opts.players.length && i < 4; i++) {
      var info = opts.players[i];
      var p = makePlayer(info);
      p.local = info.id === opts.localId;
      players[info.id] = p;
      order.push(info.id);
      respawn(p, spawns[(i * 7 + 3) % spawns.length]);
      if (p.local) me = p;
    }
    running = true;
    paused = false;
    lastT = performance.now();
    acc = 0;
    requestAnimationFrame(frame);
  };

  api.stop = function () { running = false; phase = "lobby"; countdown = null; };

  // Le lobby tourne sur le meme moteur que l'arene : meme physique,
  // memes lapins, simplement une autre carte et aucune mise a mort.
  api.startLobby = function (opts) {
    useScene("lobby");
    players = {}; order = [];
    phase = "lobby";
    banner = null;
    countdown = null;
    me = null;
    for (var i = 0; i < opts.players.length && i < 4; i++) {
      var info = opts.players[i];
      var p = makePlayer(info);
      p.local = info.id === opts.localId;
      players[info.id] = p;
      order.push(info.id);
      respawn(p, spawns[i % spawns.length]);
      p.shield = 0;
      if (p.local) me = p;
    }
    running = true;
    paused = false;
    lastT = performance.now();
    acc = 0;
    requestAnimationFrame(frame);
  };

  api.countdown = function (v) { countdown = v; };
  api.inLobby = function () { return scene === "lobby"; };
  api.side = function () { return me && me.x >= LOBBY.side ? "right" : "left"; };
  api.allRight = function () {
    if (!order.length) return false;
    for (var i = 0; i < order.length; i++) {
      var p = players[order[i]];
      if (!p || p.x < LOBBY.side) return false;
    }
    return true;
  };
  api.lobbyBar = function () { return { top: LOBBY.bar[0], h: LOBBY.bar[1] - LOBBY.bar[0], w: LOBBY.w, ht: LOBBY.h }; };
  api.pause = function (v) { paused = v; if (!v) lastT = performance.now(); };
  api.lockInput = function (v) { locked = v; };
  api.isRunning = function () { return running; };
  api.colors = COLORS;

  api.addPlayer = function (info) {
    if (players[info.id] || order.length >= 4) return;
    var p = makePlayer(info);
    players[info.id] = p;
    order.push(info.id);
    respawn(p, pickSpawn(p));
  };

  api.removePlayer = function (id) {
    delete players[id];
    var k = order.indexOf(id);
    if (k >= 0) order.splice(k, 1);
  };

  api.remoteState = function (id, s) {
    var p = players[id];
    if (!p || p.local) return;
    if (p.lastRx) {
      var gap = clock - p.lastRx;
      // Les longs silences d'un lapin immobile ne comptent pas : sinon
      // le retard d'affichage gonflerait juste avant qu'il reparte.
      if (gap < 0.1) p.gapAvg = p.gapAvg ? p.gapAvg * 0.85 + gap * 0.15 : gap;
    }
    p.lastRx = clock;
    p.buf.push({ t: clock, x: s.x, y: s.y, vx: s.vx, vy: s.vy, f: s.f, a: s.a });
    if (p.buf.length > 8) p.buf.shift();
    p.vx = s.vx; p.vy = s.vy;
    // Chaque client est seul juge de sa propre mort : on recopie son
    // verdict, ce qui rattrape un message « k » ou « r » manque.
    if (s.st === 1) p.alive = false;
    else if (!p.alive) { p.alive = true; p.dead = 0; }
  };

  api.applyKill = function (killerId, victimId, score) {
    var v = players[victimId], k = players[killerId];
    if (v && v.alive) killed(v, k);
    if (v) v.alive = false;
    if (k) k.score = score;
  };

  api.applyRespawn = function (id, x, y, life) {
    var p = players[id];
    if (!p) return;
    p.life = life;
    if (p.local) return;                 // deja fait localement
    respawn(p, { x: x, y: y });
    p.buf.length = 0;
    p.rx = x; p.ry = y;
  };

  api.setScores = function (list) {
    for (var i = 0; i < list.length; i++) {
      var p = players[list[i].id];
      if (p) { p.score = list[i].score; p.color = list[i].color; p.name = list[i].name; }
    }
  };

  api.banner = function (text) { banner = text; };
  api.setPhase = function (v) { phase = v; };
  window.JNB = api;
})();
