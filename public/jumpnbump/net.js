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

  function refreshHall() {
    fetch(HTTP + "/api/jnb/rooms", { headers: { accept: "application/json" } })
      .then(function (r) { return r.json(); })
      .then(renderHall)
      .catch(function () {
        $("#rooms").innerHTML =
          "<p class='empty'>Serveur injoignable. L'entrainement solo reste jouable.</p>";
      });
  }

  function renderHall(list) {
    var box = $("#rooms");
    if (!list.length) {
      box.innerHTML = "<p class='empty'>Aucun salon ouvert. Creez le premier.</p>";
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
        "<span class='room-code'>" + r.code + "</span>" +
        "<span class='room-who'>" + r.players.map(esc).join(" &middot; ") + "</span>" +
        "<span class='room-n'>" + r.players.length + "/" + r.max + "</span>" +
        "<span class='room-go'>" + (r.phase === "playing" ? "EN COURS" : "REJOINDRE") + "</span>";
      b.addEventListener("click", function () { connect(r.code); });
      box.appendChild(b);
    });
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  $("#b-create").addEventListener("click", function () { connect(""); });

  $("#form-join").addEventListener("submit", function (e) {
    e.preventDefault();
    var code = $("#f-code").value.trim().toUpperCase();
    if (code.length === 4) connect(code);
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
        syncRoster();
        break;

      case "start":
        S.target = m.target;
        beginMatch();
        break;

      case "back":
        JNB.stop();
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
    show(null);
    JNB.start({ localId: 1, players: list, target: S.target });
  }

  function soloKill(victimId) {
    solo.scores[S.id] = (solo.scores[S.id] || 0) + 1;
    JNB.applyKill(S.id, victimId, solo.scores[S.id]);
    if (solo.scores[S.id] >= S.target) {
      JNB.banner("VOUS GAGNEZ !");
      JNB.setPhase("over");
      setTimeout(function () { JNB.stop(); show("#screen-hall"); refreshHall(); }, 4200);
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
