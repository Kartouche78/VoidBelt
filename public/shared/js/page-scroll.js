/* ============================================================
   VOIDBELT — NAVIGATION PAR DEFILEMENT
   Les trois pages sont empilees verticalement, comme un seul
   long document :

        haut   ^   ARENE      (le jeu du vaisseau)
                   ACCUEIL
        bas    v   VELOCITY   (le jeu de course)

   Depuis l'accueil : molette vers le haut -> l'Arene,
   molette vers le bas -> Velocity. Depuis un jeu, on revient a
   l'accueil dans l'autre sens. Le script se configure par des
   attributs poses sur la balise <script> :

     data-up          adresse de la page au-dessus
     data-up-label    son nom, affiche pendant la poussee
     data-down        adresse de la page en dessous
     data-down-label  son nom

   Une jauge apparait sur le bord vise et se remplit tant que
   l'on pousse ; arrivee au bout, la page bascule. Un jeu en
   cours bloque tout : PageScroll.lock() pendant la partie,
   PageScroll.unlock() dans les menus.
   ============================================================ */

window.PageScroll = (function () {
  "use strict";

  var script = document.currentScript;
  var UP    = script && script.getAttribute("data-up");
  var DOWN  = script && script.getAttribute("data-down");
  var NAMES = {
    "-1": (script && script.getAttribute("data-up-label")) || "PAGE PRÉCÉDENTE",
    "1":  (script && script.getAttribute("data-down-label")) || "PAGE SUIVANTE"
  };

  /* Le contenu defile peut etre .view (accueil, arene) ; les jeux en
     plein ecran n'ont rien qui defile, la page est alors sa propre
     limite haute et basse. */
  var pane = document.querySelector(".view");
  var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var THRESHOLD = 300;   /* poussee cumulee necessaire : trois crans de molette */
  var DECAY     = 750;   /* pixels par seconde repris quand on relache      */
  var GRACE     = 260;   /* silence, en ms, avant que la jauge ne retombe   */

  var charge = 0, dir = 0, leaving = false, locked = false;
  var born = performance.now();
  var lastMove = 0, lastFrame = 0, raf = 0, touchY = null, touchT = 0;
  var cue = null, cueFill = null, cueName = null;

  /* ---------------- limites du contenu ---------------- */

  function atTop(){ return !pane || pane.scrollTop <= 2; }
  function atBottom(){
    return !pane || pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 2;
  }
  function target(d){ return d > 0 ? DOWN : UP; }

  /* ---------------- moments ou l'on ne navigue pas ---------------- */

  function busy(){
    if (locked || leaving) return true;
    /* l'inertie d'un pave tactile continue apres la bascule : on laisse la
       page respirer avant d'ecouter a nouveau, sinon on enchaine deux sauts */
    if (performance.now() - born < 420) return true;
    if (document.pointerLockElement) return true;

    /* une saisie en cours (pseudo du pilote, par exemple) */
    var focused = document.activeElement;
    if (focused && (focused.tagName === "INPUT" || focused.tagName === "TEXTAREA" ||
                    focused.isContentEditable)) return true;

    /* une fenetre de jeu ouverte par-dessus la scene */
    return !!document.querySelector(".gmodal:not([hidden]), .nav-block:not([hidden])");
  }

  /* ---------------- jauge de bord ---------------- */

  function buildCue(){
    if (cue) return;
    cue = document.createElement("div");
    cue.className = "pscroll";
    cue.setAttribute("aria-hidden", "true");
    cue.innerHTML =
      '<span class="pscroll-arrow"></span>' +
      '<span class="pscroll-name"></span>' +
      '<span class="pscroll-rail"><i></i></span>';
    document.body.appendChild(cue);
    cueFill = cue.querySelector(".pscroll-rail i");
    cueName = cue.querySelector(".pscroll-name");
  }

  function paint(){
    var ratio = Math.min(1, Math.abs(charge) / THRESHOLD);
    if (!charge || !dir){
      if (cue) cue.classList.remove("on");
      return;
    }
    buildCue();
    cue.classList.toggle("up", dir < 0);
    cue.classList.toggle("down", dir > 0);
    cue.classList.add("on");
    cueName.textContent = NAMES[dir];
    cueFill.style.transform = "scaleX(" + ratio.toFixed(3) + ")";
  }

  /* La charge retombe d'elle-meme des que l'on cesse de pousser : un
     defilement anodin ne fait donc jamais changer de page. On mesure le
     temps ecoule depuis l'image precedente, jamais depuis le dernier
     evenement : sinon une machine lente perd sa poussee en chemin. */
  function bleed(now){
    raf = 0;
    var dt = lastFrame ? Math.min(.12, (now - lastFrame) / 1000) : 0;
    lastFrame = now;
    if (now - lastMove > GRACE && charge){
      charge -= Math.sign(charge) * DECAY * dt;
      if (Math.abs(charge) < 6){ charge = 0; dir = 0; }
      paint();
    }
    if (charge) raf = requestAnimationFrame(bleed);
    else lastFrame = 0;
  }
  function keepBleeding(){ if (!raf){ lastFrame = 0; raf = requestAnimationFrame(bleed); } }

  /* ---------------- bascule ---------------- */

  function go(d){
    var url = target(d);
    if (!url || leaving) return;
    leaving = true;
    charge = 0;
    if (cue) cue.classList.add("fire");
    document.body.classList.add("page-leaving", d > 0 ? "page-leaving-next" : "page-leaving-previous");
    window.setTimeout(function () { window.location.href = url; }, reduced ? 0 : 260);
  }

  function push(amount, d){
    if (busy() || !target(d)) return;
    if (d > 0 ? !atBottom() : !atTop()) { charge = 0; dir = 0; paint(); return; }

    if (dir !== d){ dir = d; charge = 0; }
    charge += Math.abs(amount);
    lastMove = performance.now();
    paint();
    keepBleeding();
    if (charge >= THRESHOLD) go(d);
  }

  /* ---------------- entrees ---------------- */

  /* Si le curseur survole quelque chose qui peut encore defiler dans ce
     sens — un classement, une fenetre de reglages — la molette lui revient. */
  function inner(node, d){
    for (var i = 0; node && node !== document.body && i < 6; i++, node = node.parentElement){
      if (node.scrollHeight - node.clientHeight > 4){
        if (d > 0 && node.scrollTop + node.clientHeight < node.scrollHeight - 2) return true;
        if (d < 0 && node.scrollTop > 2) return true;
      }
    }
    return false;
  }

  window.addEventListener("wheel", function (e) {
    if (e.ctrlKey || !e.deltaY) return;
    if (inner(e.target, e.deltaY > 0 ? 1 : -1)){ charge = 0; dir = 0; paint(); return; }
    /* les molettes crantees renvoient des lignes ou des pages, pas des pixels */
    var px = e.deltaMode === 1 ? e.deltaY * 18 : e.deltaMode === 2 ? e.deltaY * 380 : e.deltaY;
    push(px, px > 0 ? 1 : -1);
  }, { passive: true });

  window.addEventListener("touchstart", function (e) {
    if (e.touches.length !== 1){ touchY = null; return; }
    touchY = e.touches[0].clientY;
    touchT = performance.now();
  }, { passive: true });

  window.addEventListener("touchmove", function (e) {
    if (touchY === null || e.touches.length !== 1) return;
    var y = e.touches[0].clientY, moved = touchY - y;
    touchY = y;
    if (Math.abs(moved) > .5) push(moved * 2.4, moved > 0 ? 1 : -1);
  }, { passive: true });

  window.addEventListener("touchend", function () {
    /* un vrai coup de pouce rapide vaut une poussee complete */
    if (touchY !== null && performance.now() - touchT < 320 && Math.abs(charge) > THRESHOLD * .45 && dir) go(dir);
    touchY = null;
  }, { passive: true });

  /* le raccourci clavier n'existe que hors des jeux, ou les fleches pilotent */
  window.addEventListener("keydown", function (e) {
    if (e.altKey || e.ctrlKey || e.metaKey || busy()) return;
    if (e.code === "PageDown" && atBottom()) { e.preventDefault(); go(1); }
    if (e.code === "PageUp"   && atTop())    { e.preventDefault(); go(-1); }
  });

  /* revenir par le bouton « precedent » ne doit pas laisser la page fanee */
  window.addEventListener("pageshow", function () {
    leaving = false;
    charge = 0; dir = 0;
    if (cue) cue.classList.remove("on", "fire");
    document.body.classList.remove("page-leaving", "page-leaving-next", "page-leaving-previous");
  });

  return {
    lock:   function(){ locked = true; charge = 0; dir = 0; paint(); },
    unlock: function(){ locked = false; },
    go:     go
  };
})();
