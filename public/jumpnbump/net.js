/* ==========================================================
   JUMP'N BUMP — salons, reseau et interface
   ----------------------------------------------------------
   Le serveur ne fait que relayer : chaque navigateur simule son
   propre lapin et diffuse sa position. Le seul point d'autorite
   partage, ce sont les morts — le serveur n'accepte qu'un tueur
   par vie, ce qui suffit a departager deux lapins qui atterrissent
   sur la meme tete au meme instant.
   ========================================================== */

(function () {
  "use strict";

  var $ = function (s) { return document.querySelector(s); };

  var LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  var HTTP = LOCAL ? location.origin : "https://api.voidbelt.com";
  var WS = LOCAL ? (location.protocol === "https:" ? "wss://" : "ws://") + location.host
    : "wss://api.voidbelt.com";

  var S = {
    name: "", id: 0, room: "", host: 0, phase: "lobby",
    target: 15, players: [], color: 0, ready: false,
    mode: null
  };
  var sock = null, ping = null, hallTimer = null, rebinding = null;

  /* ---------- la bande-son ---------- */

  // Elle ne demarre qu'au coup d'envoi et s'arrete des qu'on revient au
  // salon : dans les menus, le silence.
  var track = $("#track"), musicVol = 0.4;

  function musicPlay() {
    track.volume = musicVol;
    if (musicVol <= 0) return;
    try {
      track.currentTime = 0;
      var pr = track.play();
      if (pr && pr.catch) pr.catch(function () { /* lecture refusee, tant pis */ });
    } catch (e) { /* pas de piste */ }
  }

  function musicStop() {
    try { track.pause(); } catch (e) { /* pas de piste */ }
  }

  /* ---------- petits utilitaires d'interface ---------- */

  var SCREENS = ["#screen-name", "#screen-hall", "#screen-room", "#screen-options"];

  function show(which) {
    SCREENS.forEach(function (s) { $(s).classList.toggle("hidden", s !== which); });
    document.body.classList.toggle("playing", which === null || which === "#screen-options");
    $("#tip").classList.toggle("hidden", which !== null && which !== "#screen-options");
  }

  var toastTimer = null;
  function toast(msg) {
    var el = $("#toast");
    el.textContent = msg;
    el.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.add("hidden"); }, 3200);
  }

  var KEY_LABEL = {
    Space: "Espace", ArrowUp: "↑", ArrowDown: "↓",
    ArrowLeft: "←", ArrowRight: "→",
    ShiftLeft: "Maj G", ShiftRight: "Maj D",
    ControlLeft: "Ctrl G", ControlRight: "Ctrl D",
    AltLeft: "Alt", AltRight: "Alt Gr", Enter: "Entree", Tab: "Tab"
  };

  function keyLabel(code) {
    if (KEY_LABEL[code]) return KEY_LABEL[code];
    if (/^Key./.test(code)) return code.slice(3);
    if (/^Digit./.test(code)) return code.slice(5);
    if (/^Numpad/.test(code)) return "Pave " + code.slice(6);
    return code;
  }

  /* ==========================================================
     ECRAN 1 — le prenom
     ========================================================== */

  try {
    var last = localStorage.getItem("jnb.name");
    if (last) $("#f-name").value = last;
  } catch (e) { /* mode prive */ }

  $("#form-name").addEventListener("submit", function (e) {
    e.preventDefault();
    var n = $("#f-name").value.trim();
    if (!n) { $("#f-name").focus(); return; }
    S.name = n.slice(0, 14);
    try { localStorage.setItem("jnb.name", S.name); } catch (err) { /* mode prive */ }
    JNB.sfx.wake();
    $("#hall-who").textContent = S.name.toUpperCase();
    show("#screen-hall");
    refreshHall();
    hallTimer = setInterval(refreshHall, 4000);
  });

  /* ==========================================================
     ECRAN 2 — le hall
     ========================================================== */

  var online = false;

  function setOnline(ok, why) {
    online = ok;
    $("#b-create").disabled = !ok;
    $("#form-join").querySelector("button").disabled = !ok;
    $("#rooms-state").textContent = why;
    $("#rooms-state").classList.toggle("bad", !ok);
  }

  function refreshHall() {
    fetch(HTTP + "/api/jnb/rooms", { headers: { accept: "application/json" } })
      .then(function (r) {
        if (!r.ok) throw new Error(r.status === 404 ? "route" : "http " + r.status);
        return r.json();
      })
      .then(function (list) {
        setOnline(true, list.length + " salon(s) ouvert(s)");
        renderHall(list);
      })
      .catch(function (e) {
        // Deux pannes bien differentes : le serveur ne repond pas, ou il
        // repond mais ne connait pas encore Jump'n Bump.
        var msg = e.message === "route"
          ? "Serveur de salons pas a jour"
          : "Serveur injoignable";
        setOnline(false, msg);
        $("#rooms").innerHTML = "<p class='empty'>" + msg +
          ". Le jeu en ligne est indisponible pour le moment&nbsp;; l'entrainement " +
          "solo, lui, tourne sans serveur.</p>";
      });
  }

  function renderHall(list) {
    var box = $("#rooms");
    if (!list.length) {
      box.innerHTML = "<p class='empty'>Aucun salon ouvert. Creez le premier : " +
        "les autres le verront apparaitre ici.</p>";
      return;
    }
    box.innerHTML = "";
    list.forEach(function (r) {
      var full = r.players.length >= r.max;
      var b = document.createElement("button");
      b.type = "button";
      b.className = "room" + (full ? " full" : "");
      b.disabled = full;
      b.innerHTML =
        "<span class='room-code'>" + esc(r.code) + "</span>" +
        "<span class='room-who'>" + (r.players.map(esc).join(" &middot; ") || "&mdash;") + "</span>" +
        "<span class='room-n" + (full ? " full" : "") + "'>" +
        r.players.length + "<s>/</s>" + r.max + "</span>" +
        "<span class='room-go'>" +
        (full ? "COMPLET" : r.phase === "playing" ? "EN COURS" : "REJOINDRE") + "</span>";
      b.addEventListener("click", function () { connect(r.code); });
      box.appendChild(b);
    });
  }

  $("#b-refresh").addEventListener("click", refreshHall);

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  $("#b-create").addEventListener("click", function () { connect(""); });

  // Quatre cases d'un chiffre : on avance tout seul, on recule au
  // retour arriere, et un code colle se repartit dans les cases.
  var codeBoxes = Array.prototype.slice.call($("#code-in").querySelectorAll("input"));

  function codeValue() {
    return codeBoxes.map(function (b) { return b.value; }).join("");
  }

  codeBoxes.forEach(function (box, i) {
    box.addEventListener("input", function () {
      box.value = box.value.replace(/[^0-9]/g, "").slice(0, 1);
      if (box.value && i < 3) codeBoxes[i + 1].focus();
      if (codeValue().length === 4) $("#form-join").requestSubmit
        ? $("#form-join").requestSubmit()
        : connect(codeValue());
    });
    box.addEventListener("keydown", function (e) {
      if (e.key === "Backspace" && !box.value && i > 0) {
        codeBoxes[i - 1].focus();
        codeBoxes[i - 1].value = "";
        e.preventDefault();
      }
      if (e.key === "ArrowLeft" && i > 0) codeBoxes[i - 1].focus();
      if (e.key === "ArrowRight" && i < 3) codeBoxes[i + 1].focus();
    });
    box.addEventListener("paste", function (e) {
      var t = (e.clipboardData || window.clipboardData).getData("text") || "";
      var d = t.replace(/[^0-9]/g, "").slice(0, 4);
      if (!d) return;
      e.preventDefault();
      codeBoxes.forEach(function (b, k) { b.value = d[k] || ""; });
      codeBoxes[Math.min(3, d.length - 1)].focus();
      if (d.length === 4) connect(d);
    });
  });

  function clearCode() {
    codeBoxes.forEach(function (b) { b.value = ""; });
  }

  $("#form-join").addEventListener("submit", function (e) {
    e.preventDefault();
    var code = codeValue();
    if (code.length === 4) connect(code);
    else { toast("Il faut les quatre chiffres du salon."); codeBoxes[0].focus(); }
  });

  $("#b-hall-back").addEventListener("click", function () {
    clearInterval(hallTimer);
    show("#screen-name");
  });

  $("#b-solo").addEventListener("click", startSolo);

  /* ==========================================================
     RESEAU
     ========================================================== */

  function connect(code) {
    if (sock) { sock.close(); sock = null; }
    S.mode = "online";
    var url = WS + "/api/jnb/ws?name=" + encodeURIComponent(S.name) +
      (code ? "&room=" + encodeURIComponent(code) : "");
    try {
      sock = new WebSocket(url);
    } catch (e) {
      toast("Connexion impossible.");
      return;
    }
    sock.onopen = function () {
      ping = setInterval(function () { send({ t: "ping" }); }, 25000);
    };
    sock.onmessage = function (ev) {
      var m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      handle(m);
    };
    sock.onclose = function () {
      clearInterval(ping);
      if (S.mode === "online") {
        S.mode = null;
        JNB.stop();
        musicStop();
        show("#screen-hall");
        refreshHall();
        toast("Connexion perdue.");
      }
    };
    sock.onerror = function () { toast("Le serveur de salons ne repond pas."); };
  }

  function send(msg) {
    if (sock && sock.readyState === 1) sock.send(JSON.stringify(msg));
  }

  function handle(m) {
    switch (m.t) {
      case "joined":
        S.id = m.id;
        S.room = m.room;
        clearInterval(hallTimer);
        clearCode();
        $("#room-code").textContent = m.room;
        show("#screen-room");
        break;

      case "lobby":
        S.host = m.host;
        S.phase = m.phase;
        S.target = m.target;
        S.players = m.players;
        var mine = m.players.filter(function (p) { return p.id === S.id; })[0];
        if (mine) { S.color = mine.color; S.ready = mine.ready; }
        renderRoom();
        // Arrive en cours de partie : on entre dans l'arene tout de
        // suite plutot que d'attendre le salon suivant.
        if (m.phase === "playing" && !JNB.isRunning()) beginMatch();
        else syncRoster();
        break;

      case "start":
        S.target = m.target;
        beginMatch();
        break;

      case "back":
        JNB.stop();
        musicStop();
        show("#screen-room");
        break;

      case "s":
        JNB.remoteState(m.i, m);
        break;

      case "k":
        JNB.applyKill(m.k, m.v, m.s);
        if (m.v === S.id) toast(nameOf(m.k) + " vous a ecrase.");
        else if (m.k === S.id) toast("+1 sur " + nameOf(m.v));
        break;

      case "r":
        JNB.applyRespawn(m.i, m.x, m.y, m.l);
        break;

      case "over":
        JNB.banner(nameOf(m.w) + " GAGNE !");
        JNB.setPhase("over");
        setTimeout(function () {
          JNB.stop();
          musicStop();
          show("#screen-room");
        }, 4200);
        break;

      case "left":
        JNB.removePlayer(m.i);
        break;

      case "error":
        toast(m.m);
        if (sock) { S.mode = null; sock.close(); }
        show("#screen-hall");
        refreshHall();
        break;
    }
  }

  function nameOf(id) {
    for (var i = 0; i < S.players.length; i++) {
      if (S.players[i].id === id) return S.players[i].name;
    }
    return "Un lapin";
  }

  /* ==========================================================
     ECRAN 3 — le salon
     ========================================================== */

  function buildColors() {
    var box = $("#colors");
    box.innerHTML = "";
    JNB.colors.forEach(function (c) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "swatch";
      b.dataset.color = c.key;
      b.style.setProperty("--tint", c.tint);
      b.innerHTML = "<i></i><span>" + c.label + "</span>";
      b.addEventListener("click", function () {
        if (b.disabled) return;
        S.color = c.key;
        if (S.mode === "online") send({ t: "color", c: c.key });
        else renderRoom();
      });
      box.appendChild(b);
    });
  }

  function renderRoom() {
    var taken = {};
    S.players.forEach(function (p) { if (p.id !== S.id) taken[p.color] = true; });
    Array.prototype.forEach.call($("#colors").children, function (b) {
      var k = +b.dataset.color;
      b.disabled = !!taken[k];
      b.classList.toggle("on", k === S.color);
      b.classList.toggle("taken", !!taken[k]);
    });

    var slots = $("#slots");
    slots.innerHTML = "";
    for (var i = 0; i < 4; i++) {
      var p = S.players[i];
      var d = document.createElement("div");
      d.className = "slot" + (p ? "" : " empty") + (p && p.ready ? " ready" : "");
      if (p) {
        d.style.setProperty("--tint", JNB.colors[p.color].tint);
        // Apres une partie, le salon garde les points au tableau : c'est
        // la seule trace qui reste du match qui vient de se jouer.
        var tail = p.score > 0
          ? "<b>" + p.score + "</b> point" + (p.score > 1 ? "s" : "")
          : (p.ready ? "PRET" : "en attente");
        d.innerHTML =
          "<span class='slot-n'>" + esc(p.name) + (p.id === S.host ? " &#9733;" : "") + "</span>" +
          "<span class='slot-c'>" + JNB.colors[p.color].label + "</span>" +
          "<span class='slot-s'>" + tail + "</span>";
      } else {
        d.innerHTML = "<span class='slot-n'>libre</span>";
      }
      slots.appendChild(d);
    }

    $("#room-count").textContent = S.players.length + "/4";

    var isHost = S.host === S.id;
    $("#f-target").value = S.target;
    $("#f-target").disabled = !isHost;
    $("#b-start").classList.toggle("hidden", !isHost);
    $("#b-ready").textContent = S.ready ? "PAS PRET" : "JE SUIS PRET";
    $("#b-ready").classList.toggle("on", S.ready);

    var others = S.players.length - 1;
    var waiting = S.players.filter(function (p) { return !p.ready; }).length;
    $("#room-hint").innerHTML = isHost
      ? (others < 1
        ? "Partagez le code <b>" + S.room + "</b>. Vous pouvez lancer seul pour visiter la carte."
        : waiting + " lapin(s) pas encore pret(s) &mdash; a vous de lancer quand vous voulez.")
      : "Code <b>" + S.room + "</b> &mdash; en attente de l'hote.";
  }

  $("#b-ready").addEventListener("click", function () {
    S.ready = !S.ready;
    send({ t: "ready", v: S.ready });
  });

  $("#b-start").addEventListener("click", function () { send({ t: "start" }); });

  $("#f-target").addEventListener("change", function () {
    var n = Math.max(3, Math.min(99, +$("#f-target").value || 15));
    $("#f-target").value = n;
    send({ t: "target", n: n });
  });

  $("#b-leave").addEventListener("click", function () {
    S.mode = null;
    if (sock) sock.close();
    sock = null;
    JNB.stop();
    musicStop();
    show("#screen-hall");
    refreshHall();
    hallTimer = setInterval(refreshHall, 4000);
  });

  /* ==========================================================
     LA PARTIE
     ========================================================== */

  function roster() {
    return S.players.slice(0, 4).map(function (p) {
      return { id: p.id, name: p.name, color: p.color, score: p.score };
    });
  }

  // Le salon peut bouger pendant la partie : on tient la liste des
  // lapins a jour sans redemarrer le moteur.
  function syncRoster() {
    if (!JNB.isRunning()) return;
    JNB.setScores(roster());
    S.players.slice(0, 4).forEach(function (p) { JNB.addPlayer(p); });
  }

  function beginMatch() {
    JNB.sfx.wake();
    musicPlay();
    $("#tip-mode").textContent = "SALON " + S.room;
    show(null);
    JNB.start({ localId: S.id, players: roster(), target: S.target });
    JNB.banner(null);
    JNB.setPhase("playing");
    setTimeout(function () { JNB.banner(null); }, 10);
  }

  JNB.onSend = function (st) {
    if (S.mode === "online") {
      st.t = "s";
      send(st);
    }
  };

  JNB.onKill = function (victimId, victimLife) {
    if (S.mode === "online") send({ t: "k", v: victimId, l: victimLife });
    else soloKill(victimId);
  };

  JNB.onRespawn = function (x, y) {
    if (S.mode === "online") send({ t: "r", x: Math.round(x), y: Math.round(y) });
  };

  /* ---------- entrainement hors ligne ---------- */

  var solo = null;

  function startSolo() {
    clearInterval(hallTimer);
    if (sock) { S.mode = null; sock.close(); sock = null; }
    S.mode = "solo";
    S.id = 1;
    S.target = 15;
    var used = { };
    used[S.color] = true;
    var list = [{ id: 1, name: S.name || "Vous", color: S.color, score: 0 }];
    var botNames = ["Dott", "Jiffy", "Pizza"];
    var c = 0;
    for (var i = 0; i < 3; i++) {
      while (used[c]) c++;
      used[c] = true;
      list.push({ id: 2 + i, name: botNames[i], color: c, score: 0, bot: true });
    }
    solo = { scores: { 1: 0, 2: 0, 3: 0, 4: 0 } };
    S.players = list;
    JNB.sfx.wake();
    musicPlay();
    $("#tip-mode").textContent = "ENTRAINEMENT SOLO";
    show(null);
    JNB.start({ localId: 1, players: list, target: S.target });
  }

  function soloKill(victimId) {
    solo.scores[S.id] = (solo.scores[S.id] || 0) + 1;
    JNB.applyKill(S.id, victimId, solo.scores[S.id]);
    if (solo.scores[S.id] >= S.target) {
      JNB.banner("VOUS GAGNEZ !");
      JNB.setPhase("over");
      setTimeout(function () {
        JNB.stop();
        musicStop();
        show("#screen-hall");
        refreshHall();
      }, 4200);
    }
  }

  /* ==========================================================
     REGLAGES (Echap)
     ========================================================== */

  var BIND_LABELS = [
    ["left", "Aller a gauche"],
    ["right", "Aller a droite"],
    ["jump", "Sauter / nager"],
    ["down", "Plonger"]
  ];

  function renderBinds() {
    var ul = $("#binds");
    ul.innerHTML = "";
    BIND_LABELS.forEach(function (pair) {
      var li = document.createElement("li");
      li.innerHTML = "<span>" + pair[1] + "</span>";
      var b = document.createElement("button");
      b.type = "button";
      b.className = "key" + (rebinding === pair[0] ? " listening" : "");
      b.textContent = rebinding === pair[0] ? "appuyez…" : keyLabel(JNB.keys[pair[0]]);
      b.addEventListener("click", function () {
        rebinding = rebinding === pair[0] ? null : pair[0];
        renderBinds();
      });
      li.appendChild(b);
      ul.appendChild(li);
    });
  }

  $("#b-reset-keys").addEventListener("click", function () {
    Object.keys(JNB.defaultKeys).forEach(function (k) { JNB.keys[k] = JNB.defaultKeys[k]; });
    JNB.saveKeys();
    rebinding = null;
    renderBinds();
  });

  $("#f-vol").addEventListener("input", function () {
    var v = +$("#f-vol").value;
    $("#vol-out").textContent = v;
    JNB.sfx.vol = v / 100;
    JNB.sfx.on = v > 0;
    try { localStorage.setItem("jnb.vol", v); } catch (e) { /* mode prive */ }
  });

  $("#f-music").addEventListener("input", function () {
    var v = +$("#f-music").value;
    $("#music-out").textContent = v;
    musicVol = v / 100;
    track.volume = musicVol;
    if (musicVol <= 0) track.pause();
    else if (JNB.isRunning() && track.paused) musicPlay();
    try { localStorage.setItem("jnb.music", v); } catch (e) { /* mode prive */ }
  });

  try {
    var m0 = localStorage.getItem("jnb.music");
    if (m0 !== null) {
      $("#f-music").value = m0;
      $("#music-out").textContent = m0;
      musicVol = +m0 / 100;
    }
  } catch (e) { /* mode prive */ }

  try {
    var v0 = localStorage.getItem("jnb.vol");
    if (v0 !== null) {
      $("#f-vol").value = v0;
      $("#vol-out").textContent = v0;
      JNB.sfx.vol = +v0 / 100;
      JNB.sfx.on = +v0 > 0;
    } else {
      JNB.sfx.vol = 0.5;
    }
  } catch (e) { /* mode prive */ }

  function openOptions() {
    if (!JNB.isRunning()) return;
    rebinding = null;
    renderBinds();
    $("#screen-options").classList.remove("hidden");
    JNB.lockInput(true);
    if (S.mode === "solo") JNB.pause(true);
  }

  function closeOptions() {
    $("#screen-options").classList.add("hidden");
    rebinding = null;
    JNB.lockInput(false);
    JNB.pause(false);
  }

  $("#b-resume").addEventListener("click", closeOptions);

  $("#b-quit").addEventListener("click", function () {
    closeOptions();
    JNB.stop();
    musicStop();
    if (S.mode === "online") {
      show("#screen-room");
    } else {
      S.mode = null;
      show("#screen-hall");
      refreshHall();
      hallTimer = setInterval(refreshHall, 4000);
    }
  });

  window.addEventListener("keydown", function (e) {
    // Reassignation en cours : la prochaine touche prend la place.
    if (rebinding) {
      e.preventDefault();
      if (e.code !== "Escape") {
        JNB.keys[rebinding] = e.code;
        JNB.saveKeys();
      }
      rebinding = null;
      renderBinds();
      return;
    }
    if (e.code === "Escape") {
      e.preventDefault();
      if (!$("#screen-options").classList.contains("hidden")) closeOptions();
      else openOptions();
    }
  });

  /* ==========================================================
     DEMARRAGE
     ========================================================== */

  JNB.attach($("#stage"));
  buildColors();
  renderBinds();
  show("#screen-name");

  $("#name-hint").textContent = "Chargement de l'arene…";
  JNB.load().then(function () {
    $("#name-hint").innerHTML =
      "Deplacements <b>" + keyLabel(JNB.keys.left) + "</b> <b>" + keyLabel(JNB.keys.right) +
      "</b>, saut <b>" + keyLabel(JNB.keys.jump) + "</b>, plongeon <b>" +
      keyLabel(JNB.keys.down) + "</b> &mdash; modifiable avec <b>Echap</b>.";
    $("#f-name").focus();
  }).catch(function (err) {
    $("#name-hint").textContent = "Les images de l'arene n'ont pas pu etre chargees : " +
      err.message;
  });

  window.addEventListener("beforeunload", function () { if (sock) sock.close(); });
})();
