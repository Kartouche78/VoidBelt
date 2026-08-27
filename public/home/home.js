(function(){
"use strict";

var REDUCED = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ============================================================
   1 — ARCHIVE : repliques de films et series
   Le texte vit desormais cote serveur (Rust) et arrive en JSON ;
   une poignee de repliques reste embarquee au cas ou l'appel
   echoue, pour que la carte ne s'affiche jamais vide.
   ============================================================ */

var ARCHIVE = [];

var FALLBACK = [
  { fr:"Tous ces moments se perdront dans le temps, comme des larmes dans la pluie.",
    vo:"All those moments will be lost in time, like tears in rain.",
    title:"Blade Runner", creator:"Ridley Scott", year:1982, kind:"Film" },
  { fr:"Dans l'espace, personne ne vous entend crier.",
    vo:"In space, no one can hear you scream.",
    title:"Alien", creator:"Ridley Scott", year:1979, kind:"Film" },
  { fr:"Que la Force soit avec toi.",
    vo:"May the Force be with you.",
    title:"Star Wars", creator:"George Lucas", year:1977, kind:"Film" },
  { fr:"Autrefois, nous levions les yeux vers le ciel en rêvant de notre place parmi les étoiles.",
    vo:"We used to look up at the sky and wonder at our place in the stars.",
    title:"Interstellar", creator:"Christopher Nolan", year:2014, kind:"Film" },
  { fr:"C'est la voie.",
    vo:"This is the way.",
    title:"The Mandalorian", creator:"Jon Favreau", year:2019, kind:"Série" },
  { fr:"Les portes et les angles, gamin. C'est là qu'ils t'auront.",
    vo:"Doors and corners, kid. That's where they get you.",
    title:"The Expanse", creator:"Mark Fergus & Hawk Ostby", year:2015, kind:"Série" }
];

function pickIndex(){
  if (ARCHIVE.length < 2) return 0;
  var last = -1;
  try { last = parseInt(localStorage.getItem("voidbelt.lastArchive"), 10); } catch (e) {}
  var i = Math.floor(Math.random() * ARCHIVE.length);
  if (i === last) i = (i + 1) % ARCHIVE.length;
  try { localStorage.setItem("voidbelt.lastArchive", String(i)); } catch (e) {}
  return i;
}

var GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/\\<>=*#%$@";

function decode(el, text, duration){
  if (!el) return;
  if (REDUCED){ el.textContent = text; return; }
  setTimeout(function(){ if (el.textContent !== text) el.textContent = text; }, duration + 200);
  var start = performance.now();
  function step(now){
    var p = Math.min((now - start) / duration, 1);
    var revealed = Math.floor(p * text.length);
    var out = "";
    for (var i = 0; i < text.length; i++){
      var ch = text.charAt(i);
      if (i < revealed || ch === " ") out += ch;
      else out += GLYPHS.charAt(Math.floor(Math.random() * GLYPHS.length));
    }
    el.textContent = out;
    if (p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

var archiveAt = -1, archiveT = 0;

function showArchive(i){
  var it = ARCHIVE[i];
  if (!it) return;
  archiveAt = i;
  try { localStorage.setItem("voidbelt.lastArchive", String(i)); } catch (e) {}
  document.getElementById("ref").textContent = "ARC " + pad(i + 1) + "/" + pad(ARCHIVE.length);
  document.getElementById("vo").textContent = "« " + it.vo + " »";
  document.getElementById("m-title").textContent = it.title;
  document.getElementById("m-creator").textContent = it.creator;
  document.getElementById("m-year").textContent = it.year;
  document.getElementById("m-type").textContent = it.kind;
  decode(document.getElementById("quote"), it.fr, 900);
}

/* Espace : transmission suivante. On evite de retomber sur celle qui est
   affichee, et on ignore les appels trop rapproches pour qu'une touche
   maintenue ne fasse pas defiler l'archive en bouillie. */
function nextArchive(){
  if (!ARCHIVE.length) return;
  var now = performance.now();
  if (now - archiveT < 280) return;
  archiveT = now;
  var i = archiveAt;
  if (ARCHIVE.length > 1){
    do { i = Math.floor(Math.random() * ARCHIVE.length); } while (i === archiveAt);
  }
  showArchive(i);
  var tr = document.querySelector(".transmission");
  if (tr && !REDUCED){ tr.classList.remove("swap"); void tr.offsetWidth; tr.classList.add("swap"); }
}

/* la ligne de service et le slogan se revelent comme la premiere
   transmission : un seul geste visuel pour toute la page. */
function bootDecode(){
  var b1 = document.querySelector(".tagline b");
  var spans = document.querySelectorAll(".tagline > span");
  if (b1) decode(b1, b1.textContent, 500);
  if (spans[1]) setTimeout(function(){ decode(spans[1], spans[1].textContent, 420); }, 150);
  if (spans[2]) setTimeout(function(){ decode(spans[2], spans[2].textContent, 420); }, 300);
}

function boot(list){
  ARCHIVE = list;
  showArchive(pickIndex());
  bootDecode();
}

fetch("/api/transmissions").then(function(r){
  if (!r.ok) throw new Error("status " + r.status);
  return r.json();
}).then(function(list){
  if (!Array.isArray(list) || !list.length) throw new Error("empty archive");
  boot(list);
}).catch(function(){
  boot(FALLBACK);
});

window.addEventListener("keydown", function(e){
  var t = e.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA")) return;
  if (e.key === " "){ e.preventDefault(); nextArchive(); }
});

/* ============================================================
   2 — CHAMP D'ASTEROIDES
   Dense, reagit au curseur, se brise au clic, et souffle une
   traine d'etoiles filantes. Entraine au passage un leger
   parallaxe sur les couches decoratives du fond.
   ============================================================ */

var Field = (function(){
  var cvs = document.getElementById("space");
  var ctx = cvs.getContext("2d");
  var DPR = Math.min(window.devicePixelRatio || 1, 2);
  var W = 0, H = 0;
  var rocks = [], shards = [], stars = [], streaks = [];
  var mx = -9999, my = -9999, px = 0, py = 0, tpx = 0, tpy = 0;
  var broken = 0, hovering = false, warpT = 0, streakAt = 0;
  var bgEl = document.querySelector(".bg-parallax");

  function rand(a, b){ return a + Math.random() * (b - a); }

  function silhouette(r, n){
    var pts = [], i, a, rr;
    for (i = 0; i < n; i++){
      a = (i / n) * Math.PI * 2;
      rr = r * rand(0.62, 1.12);
      pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
    }
    return pts;
  }

  function makeRock(x, y){
    var r = rand(7, 38);
    return {
      x: x, y: y,
      vx: rand(-0.20, 0.20), vy: rand(-0.16, 0.16),
      r: r, pts: silhouette(r, Math.floor(rand(7, 12))),
      rot: rand(0, 6.28), spin: rand(-0.005, 0.005),
      depth: rand(0.25, 1.20),
      hot: Math.random() < 0.13
    };
  }

  function spawnEdge(){
    var side = Math.floor(Math.random() * 4), m = 70;
    if (side === 0) return makeRock(rand(0, W), -m);
    if (side === 1) return makeRock(W + m, rand(0, H));
    if (side === 2) return makeRock(rand(0, W), H + m);
    return makeRock(-m, rand(0, H));
  }

  function build(){
    /* champ dense : on vise 100 rochers des que la fenetre est assez grande */
    var n = Math.max(55, Math.min(100, Math.round((W * H) / 8000)));
    rocks = [];
    for (var i = 0; i < n; i++) rocks.push(makeRock(rand(0, W), rand(0, H)));
    stars = [];
    var sc = Math.round((W * H) / 7000);
    for (var j = 0; j < sc; j++){
      stars.push({ x: rand(0, W), y: rand(0, H), s: rand(0.4, 1.5),
                   a: rand(0.10, 0.55), tw: rand(0.4, 1.8), ph: rand(0, 6.28) });
    }
  }

  function resize(){
    W = cvs.clientWidth; H = cvs.clientHeight;
    cvs.width = Math.round(W * DPR); cvs.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    build();
  }

  function shatter(rk){
    var n = Math.floor(rand(6, 11));
    for (var i = 0; i < n; i++){
      var a = rand(0, 6.28), sp = rand(0.7, 3.4), sr = rk.r * rand(0.10, 0.30);
      shards.push({
        x: rk.x, y: rk.y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        pts: silhouette(sr, 5), rot: rand(0, 6.28), spin: rand(-0.10, 0.10),
        life: 1, hot: rk.hot
      });
    }
    broken++;
    var el = document.getElementById("kills");
    if (el) el.textContent = pad(broken);
  }

  function hit(cx, cy){
    for (var i = rocks.length - 1; i >= 0; i--){
      var rk = rocks[i];
      var dx = cx - (rk.x + px * rk.depth), dy = cy - (rk.y + py * rk.depth);
      /* marge fixe autour du rocher : viser devient nettement plus facile,
         y compris sur les petits fragments. */
      var tol = rk.r + 15;
      if (dx * dx + dy * dy < tol * tol) return i;
    }
    return -1;
  }

  function drawShape(pts){
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
  }

  /* impulsion donnee au champ — au clic sur un rocher proche, et
     juste avant de quitter la page vers l'Arene. */
  function warp(dir){
    warpT = 1;
    for (var i = 0; i < rocks.length; i++){
      rocks[i].vy -= dir * (1.6 + Math.random() * 3.2) * (0.35 + rocks[i].depth);
    }
  }

  function spawnStreak(){
    var fromLeft = Math.random() < .5;
    var x = fromLeft ? rand(-40, W * .3) : rand(W * .7, W + 40);
    var y = rand(-40, H * .22);
    var sp = rand(9, 13);
    var ang = fromLeft ? rand(.35, .55) : Math.PI - rand(.35, .55);
    streaks.push({ x: x, y: y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life: 1 });
  }

  function frame(t){
    /* pendant le warp on n'efface que partiellement : les rochers laissent
       une trainee, ce qui donne la sensation de vitesse. */
    if (warpT > 0.02){
      ctx.fillStyle = "rgba(10,10,11,.26)";
      ctx.fillRect(0, 0, W, H);
      warpT *= 0.92;
    } else {
      if (warpT !== 0){ warpT = 0; }
      ctx.clearRect(0, 0, W, H);
    }

    px += (tpx - px) * 0.05;
    py += (tpy - py) * 0.05;
    if (bgEl) bgEl.style.transform = "translate3d(" + (px * -.6).toFixed(1) + "px," + (py * -.6).toFixed(1) + "px,0)";

    var i, k;

    for (i = 0; i < stars.length; i++){
      var st = stars[i];
      var a = st.a * (0.55 + 0.45 * Math.sin(t * 0.001 * st.tw + st.ph));
      ctx.fillStyle = "rgba(237,231,218," + a.toFixed(3) + ")";
      ctx.fillRect(st.x + px * 0.25, st.y + py * 0.25, st.s, st.s);
    }

    for (i = 0; i < rocks.length; i++){
      var rk = rocks[i];

      /* le curseur ne fait plus qu'effleurer le champ : rayon court et
         poussee faible, pour que les rochers restent faciles a viser. */
      var ddx = rk.x - mx, ddy = rk.y - my;
      var d2 = ddx * ddx + ddy * ddy;
      if (d2 < 6400 && d2 > 1){
        var d = Math.sqrt(d2), f = (1 - d / 80) * 0.13;
        rk.vx += (ddx / d) * f; rk.vy += (ddy / d) * f;
      }

      rk.vx *= 0.985; rk.vy *= 0.985;
      rk.x += rk.vx; rk.y += rk.vy; rk.rot += rk.spin;

      var m = rk.r + 60;
      if (rk.x < -m) rk.x = W + m; else if (rk.x > W + m) rk.x = -m;
      if (rk.y < -m) rk.y = H + m; else if (rk.y > H + m) rk.y = -m;

      ctx.save();
      ctx.translate(rk.x + px * rk.depth, rk.y + py * rk.depth);
      ctx.rotate(rk.rot);
      drawShape(rk.pts);
      ctx.fillStyle = "rgba(20,20,22,.55)";
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = rk.hot
        ? "rgba(255,77,0," + (0.20 + rk.depth * 0.30).toFixed(3) + ")"
        : "rgba(237,231,218," + (0.07 + rk.depth * 0.13).toFixed(3) + ")";
      ctx.stroke();
      ctx.restore();
    }

    for (k = shards.length - 1; k >= 0; k--){
      var sh = shards[k];
      sh.x += sh.vx; sh.y += sh.vy; sh.rot += sh.spin;
      sh.vx *= 0.97; sh.vy *= 0.97;
      sh.life -= 0.016;
      if (sh.life <= 0){ shards.splice(k, 1); continue; }
      ctx.save();
      ctx.translate(sh.x, sh.y);
      ctx.rotate(sh.rot);
      drawShape(sh.pts);
      ctx.lineWidth = 1;
      ctx.strokeStyle = (sh.hot ? "rgba(255,77,0," : "rgba(237,231,218,") + sh.life.toFixed(3) + ")";
      ctx.stroke();
      ctx.restore();
    }

    /* une etoile filante de loin en loin : un fil discret, une trainee
       qui s'efface. Purement decoratif, ca ne heurte jamais un rocher. */
    if (t > streakAt){
      streakAt = t + rand(3200, 8600);
      spawnStreak();
    }
    for (k = streaks.length - 1; k >= 0; k--){
      var sk = streaks[k];
      sk.x += sk.vx; sk.y += sk.vy; sk.life -= 0.014;
      if (sk.life <= 0 || sk.x < -60 || sk.x > W + 60 || sk.y > H + 60){ streaks.splice(k, 1); continue; }
      ctx.save();
      ctx.globalAlpha = Math.max(0, sk.life);
      var grad = ctx.createLinearGradient(sk.x, sk.y, sk.x - sk.vx * 6, sk.y - sk.vy * 6);
      grad.addColorStop(0, "rgba(237,231,218,.9)");
      grad.addColorStop(1, "rgba(237,231,218,0)");
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(sk.x, sk.y);
      ctx.lineTo(sk.x - sk.vx * 6, sk.y - sk.vy * 6);
      ctx.stroke();
      ctx.restore();
    }

    requestAnimationFrame(frame);
  }

  function init(){
    resize();
    window.addEventListener("resize", resize);

    if (REDUCED){
      ctx.clearRect(0, 0, W, H);
      for (var i = 0; i < rocks.length; i++){
        var rk = rocks[i];
        ctx.save(); ctx.translate(rk.x, rk.y); ctx.rotate(rk.rot);
        drawShape(rk.pts);
        ctx.strokeStyle = "rgba(237,231,218,.14)"; ctx.stroke();
        ctx.restore();
      }
      return;
    }

    window.addEventListener("pointermove", function(e){
      mx = e.clientX; my = e.clientY;
      tpx = (e.clientX / W - 0.5) * 34;
      tpy = (e.clientY / H - 0.5) * 34;
      var over = hit(e.clientX, e.clientY) >= 0 && !inText(e.target);
      if (over !== hovering){
        hovering = over;
        document.body.style.cursor = over ? "crosshair" : "";
      }
    }, { passive: true });

    window.addEventListener("pointerleave", function(){ mx = my = -9999; });

    window.addEventListener("pointerdown", function(e){
      if (inText(e.target)) return;      /* on laisse selectionner le texte */
      var i = hit(e.clientX, e.clientY);
      if (i < 0) return;
      shatter(rocks[i]);
      rocks.splice(i, 1);
      rocks.push(spawnEdge());           /* un autre entre par un bord, au hasard */
    });

    requestAnimationFrame(frame);
  }

  /* zones ou le clic sert a selectionner du texte, pas a casser un rocher */
  function inText(el){
    return !!(el && el.closest && el.closest(".transmission, .footer"));
  }

  return { init: init, warp: warp };
})();

Field.init();

/* ============================================================
   3 — ACCES : depart en vitesse de distorsion vers l'Arene.
   Le champ d'asteroides souffle, puis la page change.
   ============================================================ */

(function(){
  var cards = document.querySelectorAll(".access-card");
  for (var i = 0; i < cards.length; i++){
    cards[i].addEventListener("click", function(e){
      if (REDUCED) return;               /* navigation immediate, sans fard */
      var href = this.getAttribute("href");
      if (!href || e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
      e.preventDefault();
      Field.warp(-1);
      this.style.pointerEvents = "none";
      var go = href;
      setTimeout(function(){ window.location.href = go; }, 320);
    });
  }
})();

/* ============================================================
   4 — LOGO : lumiere qui suit le curseur
   ============================================================ */

(function(){
  var wm = document.getElementById("wordmark");
  if (!wm || REDUCED) return;
  var words = wm.querySelectorAll(".w");

  wm.addEventListener("pointermove", function(e){
    var r = wm.getBoundingClientRect();
    var x = (e.clientX - r.left) / r.width;
    var y = (e.clientY - r.top) / r.height;
    /* chaque mot a sa propre boite de fond : on lui donne les coordonnees
       du curseur dans SON repere, sinon le halo se dedouble. */
    for (var i = 0; i < words.length; i++){
      var wr = words[i].getBoundingClientRect();
      words[i].style.setProperty("--mx", (((e.clientX - wr.left) / wr.width) * 100).toFixed(1) + "%");
      words[i].style.setProperty("--my", (((e.clientY - wr.top) / wr.height) * 100).toFixed(1) + "%");
    }
    wm.style.setProperty("--tx", (1 + (x - 0.5) * 2.6).toFixed(3));
    wm.style.setProperty("--ry", ((x - 0.5) * 11).toFixed(2) + "deg");
    wm.style.setProperty("--rx", ((0.5 - y) * 8).toFixed(2) + "deg");
    wm.style.setProperty("--spot", "1");
  });

  wm.addEventListener("pointerleave", function(){
    wm.style.setProperty("--spot", "0");
    wm.style.setProperty("--tx", "1");
    wm.style.setProperty("--rx", "0deg");
    wm.style.setProperty("--ry", "0deg");
  });
})();

/* ============================================================
   5 — BANDE-SON DE L'ACCUEIL
   ============================================================ */

var HomeMusic = Track("hometrack", "voidbelt.home.volume", 25);
var HomeVol = VolumeUI(HomeMusic);
HomeVol.add("f-mute", "f-volr", "f-volv");
HomeMusic.set(true);

})();
