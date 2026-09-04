/* ==========================================================
   JUMP'N BUMP — lobby, serveurs et interface
   ----------------------------------------------------------
   Il n'y a plus de menu : le lobby est une scene jouable. On y
   promene son lapin. A gauche du tronc couche, la bande noire du
   bas devient une barre de reglages ; a droite, on est en position
   et le decompte part. En ligne, il faut que tout le monde ait
   franchi le tronc.

   Le serveur ne fait que relayer : chaque navigateur simule son
   propre lapin. Le seul point d'autorite partage, ce sont les
   morts — un seul tueur par vie.
   ========================================================== */

(function () {
  "use strict";

  var $ = function (s) { return document.querySelector(s); };

  var LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  var HTTP = LOCAL ? location.origin : "https://api.voidbelt.com";
  var WS = LOCAL ? (location.protocol === "https:" ? "wss://" : "ws://") + location.host
    : "wss://api.voidbelt.com";

  var S = {
    name: "", color: 0, id: 1, room: "", host: 0,
    phase: "lobby", target: 15, players: [],
    mode: "solo"                      // "solo" tant qu'on n'a rejoint aucun serveur
  };
  var sock = null, ping = null, roomsTimer = null, pingSent = 0;
  var lastSide = null, wantJoin = false;
  var centralGateway = false;

  /* ==========================================================
     MUSIQUE
     ========================================================== */

  var trackGame = $("#track"), trackLobby = $("#track-lobby"), musicVol = 0.4;

  function play(el) {
    el.volume = musicVol;
    if (musicVol <= 0) return;
    try {
      var pr = el.play();
      if (pr && pr.catch) pr.catch(function () { /* lecture refusee */ });
    } catch (e) { /* pas de piste */ }
  }

  // Deux pistes, jamais ensemble : on coupe systematiquement les deux
  // avant de relancer celle qu'il faut.
  function music(which) {
    var on = which === "lobby" ? trackLobby : which === "game" ? trackGame : null;
    [trackLobby, trackGame].forEach(function (el) {
      if (el !== on) { try { el.pause(); } catch (e) { /* rien */ } }
    });
    if (!on) return;
    if (on.paused) { on.currentTime = 0; play(on); }
    else on.volume = musicVol;
  }

  /* ==========================================================
     PETITS OUTILS
     ========================================================== */

  var toastTimer = null;
  function toast(msg) {
    var el = $("#toast");
    el.textContent = msg;
    el.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.add("hidden"); }, 3200);
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
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
     LA BARRE DU LOBBY
     ----------------------------------------------------------
     Elle est en HTML par-dessus le canvas — des vrais champs, de
     vrais boutons — mais doit rester collee a la bande noire de la
     carte, dont la taille a l'ecran change avec la fenetre.
     ========================================================== */

  function layoutBar() {
    if (!JNB.inLobby()) return;
    var bar = JNB.lobbyBar();
    var r = $("#stage").getBoundingClientRect();
    var f = $(".jnb-frame").getBoundingClientRect();
    var u = r.height / bar.ht;
    [$("#lobbybar"), $("#lobbytip")].forEach(function (el) {
      el.style.left = (r.left - f.left) + "px";
      el.style.width = r.width + "px";
      el.style.top = (r.top - f.top + bar.top * u) + "px";
      el.style.height = (bar.h * u) + "px";
      el.style.setProperty("--u", u);
    });
  }

  window.addEventListener("resize", layoutBar);

  function showBar(on) {
    $("#lobbybar").hidden = !on;
    $("#lobbytip").hidden = on;
    if (on || !$("#lobbytip").hidden) layoutBar();
  }

  function hideLobbyUi() {
    $("#lobbybar").hidden = true;
    $("#lobbytip").hidden = true;
  }

  /* ==========================================================
     PELAGES
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
      b.title = c.label;
      b.innerHTML = "<i></i>";
      b.addEventListener("click", function () {
        if (b.disabled) return;
        S.color = c.key;
        try { localStorage.setItem("jnb.color", c.key); } catch (e) { /* mode prive */ }
        if (S.mode === "online") send({ t: "color", c: c.key });
        else { renderColors(); refreshLobbyRoster(); }
      });
      box.appendChild(b);
    });
  }

  function renderColors() {
    var taken = {};
    S.players.forEach(function (p) { if (p.id !== S.id) taken[p.color] = true; });
    Array.prototype.forEach.call($("#colors").children, function (b) {
      var k = +b.dataset.color;
      b.disabled = !!taken[k];
      b.classList.toggle("on", k === S.color);
      b.classList.toggle("taken", !!taken[k]);
    });
  }

  /* ==========================================================
     LE LOBBY
     ========================================================== */

  function roster() {
    if (S.mode === "online") {
      return S.players.slice(0, 4).map(function (p) {
        return {
          id: p.id, name: p.name, color: p.color, score: p.score,
          spawn: p.spawn, alive: p.alive, life: p.life
        };
      });
    }
    return [{ id: 1, name: S.name || "Lapin", color: S.color, score: 0 }];
  }

  function enterLobby() {
    launching = false;
    lastSide = null;
    JNB.startLobby({ localId: S.id, players: roster() });
    music("lobby");
    showBar(true);
    renderColors();
    layoutBar();
  }

  // Le lobby tourne deja : on met juste la liste des lapins a jour.
  function refreshLobbyRoster() {
    if (!JNB.isRunning() || !JNB.inLobby()) return;
    var list = roster();
    JNB.setScores(list);
    list.forEach(function (p) { JNB.addPlayer(p); });
  }

  $("#f-name").addEventListener("input", function () {
    S.name = $("#f-name").value.slice(0, 10);
    try { localStorage.setItem("jnb.name", S.name); } catch (e) { /* mode prive */ }
    if (S.mode === "online") send({ t: "name", n: "JNB-" + S.name });
    else refreshLobbyRoster();
  });

  // La boucle du lobby : de quel cote du tronc est-on, faut-il montrer
  // la barre, et peut-on lancer la partie.
  var launching = false;

  setInterval(function () {
    if (!JNB.isRunning() || !JNB.inLobby()) { launching = false; return; }
    var side = JNB.side();
    if (side !== lastSide) {
      lastSide = side;
      showBar(side === "left");
    }
    if (side !== "right") return;

    $("#lobbytip").textContent = tipText();
    if (S.mode === "online") {
      // L'hote tranche pour tout le monde : c'est lui qui donne le
      // depart des que tous les lapins ont franchi le tronc.
      if (S.host === S.id && JNB.allRight() && !launching) {
        launching = true;
        send({ t: "start" });
      }
    } else if (!launching) {
      launching = true;
      beginSolo();
    }
  }, 80);

  function tipText() {
    if (S.mode !== "online") return "EN POSITION";
    if (JNB.allRight()) return "TOUT LE MONDE EST EN POSITION";
    return "EN ATTENTE DES AUTRES LAPINS — SERVEUR " + S.room;
  }

  /* ==========================================================
     LES PARTIES
     ========================================================== */

  var solo = { score: 0 };

  function beginSolo() {
    S.mode = "solo";
    S.id = 1;
    var used = {};
    used[S.color] = true;
    var list = [{ id: 1, name: S.name || "Vous", color: S.color, score: 0 }];
    var names = ["Dott", "Jiffy", "Pizza"], c = 0;
    for (var i = 0; i < 3; i++) {
      while (used[c]) c++;
      used[c] = true;
      list.push({ id: 2 + i, name: names[i], color: c, score: 0, bot: true });
    }
    solo.score = 0;
    S.players = list;
    hideLobbyUi();
    music("game");
    JNB.sfx.wake();
    JNB.start({ localId: 1, players: list, target: S.target });
  }

  function beginMatch() {
    hideLobbyUi();
    music("game");
    JNB.sfx.wake();
    JNB.start({
      localId: S.id, players: roster(), target: S.target, serverSpawns: true
    });
  }

  function backToLobby() {
    JNB.stop();
    enterLobby();
  }

  /* ==========================================================
     RESEAU
     ========================================================== */

  function connect(code, priv) {
    if (sock) { try { sock.close(); } catch (e) { /* rien */ } sock = null; }
    var path = centralGateway ? "/api/multiplayer/ws?game=jumpnbump&name=" : "/api/jnb/ws?name=";
    var url = WS + path + encodeURIComponent("JNB-" + (S.name || "Lapin")) +
      (code ? "&room=" + encodeURIComponent(code) : "") + (priv ? "&priv=1" : "");
    try {
      sock = new WebSocket(url);
    } catch (e) {
      toast("Connexion impossible.");
      return;
    }
    wantJoin = true;
    toast("Connexion au serveur…");
    var opened = false, mine = sock;
    mine.onopen = function () {
      opened = true;
      // Un aller-retour toutes les deux secondes : ca mesure la latence
      // et ca tient la connexion ouverte du meme coup.
      ping = setInterval(function () {
        pingSent = performance.now();
        send({ t: "ping" });
      }, 2000);
    };
    // Sans ce garde-fou, un serveur muet laisse le joueur devant un
    // ecran qui ne bouge pas, sans savoir pourquoi.
    setTimeout(function () {
      if (!opened && sock === mine) {
        toast("Le serveur ne repond pas. Reessayez plus tard.");
        try { mine.close(); } catch (e) { /* rien */ }
      }
    }, 6000);
    mine.onmessage = function (ev) {
      var m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      handle(m);
    };
    mine.onclose = function () {
      clearInterval(ping);
      if (sock !== mine) return;
      sock = null;
      if (S.mode === "online") {
        toast("Connexion perdue.");
        goSolo();
      }
    };
  }

  function goSolo() {
    JNB.setPing(null);
    S.mode = "solo";
    S.id = 1;
    S.players = [];
    S.room = "";
    S.host = 0;
    $("#roomtag").hidden = true;
    $("#b-copy-room").classList.add("hidden");
    $("#b-quitroom").classList.add("hidden");
    backToLobby();
  }

  function send(msg) {
    if (sock && sock.readyState === 1) sock.send(JSON.stringify(msg));
  }

  function handle(m) {
    switch (m.t) {
      case "joined":
        S.id = m.id;
        S.room = m.room;
        S.mode = "online";
        $("#roomtag").textContent = m.room;
        $("#roomtag").hidden = false;
        $("#b-copy-room").textContent = "SERVEUR " + m.room;
        $("#b-copy-room").classList.remove("hidden");
        $("#b-quitroom").classList.remove("hidden");
        break;

      case "lobby":
        S.host = m.host;
        S.phase = m.phase;
        S.target = m.target;
        S.players = m.players.map(function (p) {
          var copy = Object.assign({}, p);
          copy.name = String(copy.name || "Lapin").replace(/^JNB-/, "");
          return copy;
        });
        var mine = S.players.filter(function (p) { return p.id === S.id; })[0];
        if (mine) S.color = mine.color;
        renderColors();
        if (wantJoin) {
          wantJoin = false;
          closeMulti();
          enterLobby();
        } else if (m.phase === "playing" && (!JNB.isRunning() || JNB.inLobby())) {
          beginMatch();
        } else {
          refreshLobbyRoster();
        }
        break;

      case "start":
        S.target = m.target || S.target;
        if (m.players) S.players = m.players;
        beginMatch();
        break;

      case "back":
        backToLobby();
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
        JNB.applyRespawn(m.i, m.spawn, m.l);
        break;

      case "over":
        JNB.banner(nameOf(m.w) + " GAGNE !");
        JNB.setPhase("over");
        setTimeout(backToLobby, 4200);
        break;

      case "pong":
        if (pingSent) JNB.setPing(Math.round(performance.now() - pingSent));
        break;

      case "left":
        JNB.removePlayer(m.i);
        break;

      case "error":
        toast(m.m);
        if (sock) { try { sock.close(); } catch (e) { /* rien */ } }
        break;
    }
  }

  function nameOf(id) {
    for (var i = 0; i < S.players.length; i++) {
      if (S.players[i].id === id) return S.players[i].name;
    }
    return "Un lapin";
  }

  JNB.onSend = function (st) {
    if (S.mode === "online") { st.t = "s"; send(st); }
  };
  JNB.onKill = function (victimId, victimLife) {
    if (S.mode === "online") send({ t: "k", v: victimId, l: victimLife });
    else soloKill(victimId);
  };
  JNB.onRespawn = function () {
    if (S.mode === "online") send({ t: "r" });
  };

  function soloKill(victimId) {
    solo.score += 1;
    JNB.applyKill(S.id, victimId, solo.score);
    if (solo.score >= S.target) {
      JNB.banner("VOUS GAGNEZ !");
      JNB.setPhase("over");
      setTimeout(backToLobby, 4200);
    }
  }

  /* ==========================================================
     ECRAN MULTIJOUEUR
     ========================================================== */

  function openMulti() {
    $("#screen-multi").classList.remove("hidden");
    JNB.lockInput(true);
    refreshRooms();
    clearInterval(roomsTimer);
    roomsTimer = setInterval(refreshRooms, 4000);
  }

  function closeMulti() {
    $("#screen-multi").classList.add("hidden");
    JNB.lockInput(false);
    clearInterval(roomsTimer);
  }

  $("#b-multi").addEventListener("click", openMulti);
  $("#b-multi-close").addEventListener("click", closeMulti);
  $("#b-refresh").addEventListener("click", refreshRooms);

  $("#b-quitroom").addEventListener("click", function () {
    if (sock) { try { sock.close(); } catch (e) { /* rien */ } }
    sock = null;
    closeMulti();
    goSolo();
  });

  // Clic sur le code : il part dans le presse-papier.
  $("#roomtag").addEventListener("click", function () {
    var code = S.room;
    if (!code) return;
    var ok = function () { toast("Code " + code + " copie."); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).then(ok, function () { fallbackCopy(code, ok); });
    } else fallbackCopy(code, ok);
  });

  function fallbackCopy(text, ok) {
    var t = document.createElement("textarea");
    t.value = text;
    t.style.position = "fixed";
    t.style.opacity = "0";
    document.body.appendChild(t);
    t.select();
    try { document.execCommand("copy"); ok(); } catch (e) { toast("Code : " + text); }
    document.body.removeChild(t);
  }

  function setState(ok, why) {
    $("#rooms-state").textContent = why;
    $("#rooms-state").classList.toggle("bad", !ok);
  }

  function refreshRooms() {
    fetch(HTTP + "/api/multiplayer/rooms?game=jumpnbump", { headers: { accept: "application/json" } })
      .then(function (r) {
        if (!r.ok) throw new Error("gateway");
        centralGateway = true;
        return r.json();
      })
      .catch(function () {
        centralGateway = false;
        return fetch(HTTP + "/api/jnb/rooms", { headers: { accept: "application/json" } })
          .then(function (r) {
            if (!r.ok) throw new Error(r.status === 404 ? "route" : "http " + r.status);
            return r.json().then(function (rooms) {
              return rooms.filter(function (room) {
                return !room.players.some(function (name) { return /^SHD-/.test(name); });
              });
            });
          });
      })
      .then(function (list) {
        setState(true, list.length + " ouvert(s)");
        renderRooms(list);
      })
      .catch(function (e) {
        // Deux pannes bien differentes : le serveur ne repond pas, ou il
        // repond mais ne connait pas encore Jump'n Bump.
        var msg = e.message === "route" ? "SERVEUR PAS A JOUR" : "SERVEUR INJOIGNABLE";
        setState(false, msg);
        $("#rooms").innerHTML = "<p class='empty'>" + msg + ". Le jeu en ligne est " +
          "indisponible ; le solo, lui, tourne sans serveur.</p>";
      });
  }

  function renderRooms(list) {
    var box = $("#rooms");
    if (!list.length) {
      box.innerHTML = "<p class='empty'>Aucun serveur ouvert. Creez le premier : " +
        "les autres le verront apparaitre ici.</p>";
      return;
    }
    box.innerHTML = "";
    list.forEach(function (r) {
      var full = r.players.length >= r.max;
      var unavailable = full || r.phase !== "lobby";
      var b = document.createElement("button");
      b.type = "button";
      b.className = "room" + (full ? " full" : "");
      b.disabled = unavailable;
      b.innerHTML =
        "<span class='room-code'>" + esc(r.code) + "</span>" +
        "<span class='room-who'>" + (r.players.map(function (name) {
          return esc(String(name).replace(/^JNB-/, ""));
        }).join(" &middot; ") || "&mdash;") + "</span>" +
        "<span class='room-n" + (full ? " full" : "") + "'>" +
        r.players.length + "<s>/</s>" + r.max + "</span>" +
        "<span class='room-go'>" +
        (full ? "COMPLET" : r.phase === "playing" ? "EN COURS" : "REJOINDRE") + "</span>";
      b.addEventListener("click", function () { connect(r.code, false); });
      box.appendChild(b);
    });
  }

  $("#b-create").addEventListener("click", function () {
    connect("", $("#f-priv").checked);
  });

  /* ---------- le code, en quatre cases ---------- */

  var codeBoxes = Array.prototype.slice.call($("#code-in").querySelectorAll("input"));

  function codeValue() {
    return codeBoxes.map(function (b) { return b.value; }).join("");
  }

  function clearCode() { codeBoxes.forEach(function (b) { b.value = ""; }); }

  codeBoxes.forEach(function (box, i) {
    box.addEventListener("input", function () {
      box.value = box.value.replace(/[^0-9]/g, "").slice(0, 1);
      if (box.value && i < 3) codeBoxes[i + 1].focus();
      if (codeValue().length === 4) { connect(codeValue(), false); clearCode(); }
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
      if (d.length === 4) { connect(d, false); clearCode(); }
      else codeBoxes[d.length].focus();
    });
  });

  $("#form-join").addEventListener("submit", function (e) {
    e.preventDefault();
    var code = codeValue();
    if (code.length === 4) { connect(code, false); clearCode(); }
    else { toast("Il faut les quatre chiffres du serveur."); codeBoxes[0].focus(); }
  });

  /* ==========================================================
     REGLAGES (Echap)
     ========================================================== */

  var BIND_LABELS = [
    ["left", "Gauche"],
    ["right", "Droite"],
    ["jump", "Sauter — monter dans le lobby"],
    ["down", "Plonger — descendre dans le lobby"]
  ];

  // `listening` designe la case en attente d'une touche : soit une case
  // existante qu'on remplace, soit le « + » qui en ajoute une.
  var listening = null;

  function isListening(act, i) {
    return listening && listening.a === act && listening.i === i;
  }

  function renderBinds() {
    var ul = $("#binds");
    ul.innerHTML = "";
    BIND_LABELS.forEach(function (pair) {
      var act = pair[0];
      var li = document.createElement("li");
      var lab = document.createElement("span");
      lab.textContent = pair[1];
      li.appendChild(lab);

      var box = document.createElement("span");
      box.className = "keys";

      JNB.keys[act].forEach(function (code, i) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "key" + (isListening(act, i) ? " listening" : "");
        b.textContent = isListening(act, i) ? "appuyez…" : keyLabel(code);
        b.title = "Clic : remplacer — clic droit : retirer";
        b.addEventListener("click", function () {
          listening = isListening(act, i) ? null : { a: act, i: i };
          renderBinds();
        });
        b.addEventListener("contextmenu", function (e) {
          e.preventDefault();
          if (JNB.keys[act].length > 1) {
            JNB.keys[act].splice(i, 1);
            JNB.saveKeys();
            listening = null;
            renderBinds();
          }
        });
        box.appendChild(b);
      });

      var add = document.createElement("button");
      add.type = "button";
      add.className = "key add" + (isListening(act, -1) ? " listening" : "");
      add.textContent = isListening(act, -1) ? "appuyez…" : "+";
      add.title = "Ajouter une touche";
      add.addEventListener("click", function () {
        listening = isListening(act, -1) ? null : { a: act, i: -1 };
        renderBinds();
      });
      box.appendChild(add);

      li.appendChild(box);
      ul.appendChild(li);
    });
  }

  function assign(code) {
    var act = listening.a;
    var list = JNB.keys[act].slice();
    if (listening.i === -1) list.push(code);
    else list[listening.i] = code;
    // pas deux fois la meme touche pour une meme commande
    JNB.keys[act] = list.filter(function (c, i) { return list.indexOf(c) === i; });
    // ni la meme touche sur deux commandes differentes
    Object.keys(JNB.keys).forEach(function (k) {
      if (k === act) return;
      JNB.keys[k] = JNB.keys[k].filter(function (c) { return c !== code; });
      if (!JNB.keys[k].length) JNB.keys[k] = JNB.defaultKeys[k].slice();
    });
    JNB.saveKeys();
  }

  $("#b-reset-keys").addEventListener("click", function () {
    JNB.resetKeys();
    listening = null;
    renderBinds();
  });

  $("#b-copy-room").addEventListener("click", function () {
    if (!S.room) return;
    fallbackCopy(S.room, function () { toast("Code " + S.room + " copie."); });
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
    trackGame.volume = musicVol;
    trackLobby.volume = musicVol;
    if (musicVol <= 0) { trackGame.pause(); trackLobby.pause(); }
    else music(JNB.inLobby() ? "lobby" : "game");
    try { localStorage.setItem("jnb.music", v); } catch (e) { /* mode prive */ }
  });

  function openOptions() {
    if (!JNB.isRunning()) return;
    listening = null;
    renderBinds();
    $("#screen-options").classList.remove("hidden");
    JNB.lockInput(true);
    if (S.mode !== "online") JNB.pause(true);
  }

  function closeOptions() {
    $("#screen-options").classList.add("hidden");
    listening = null;
    JNB.lockInput(false);
    JNB.pause(false);
  }

  $("#b-resume").addEventListener("click", closeOptions);

  $("#b-quit").addEventListener("click", function () {
    closeOptions();
    if (JNB.inLobby()) return;
    if (S.mode === "online" && S.host === S.id) send({ t: "back" });
    else backToLobby();
  });

  window.addEventListener("keydown", function (e) {
    if (listening) {
      e.preventDefault();
      if (e.code !== "Escape") assign(e.code);
      listening = null;
      renderBinds();
      return;
    }
    if (e.code === "Escape") {
      e.preventDefault();
      if (!$("#screen-multi").classList.contains("hidden")) closeMulti();
      else if (!$("#screen-options").classList.contains("hidden")) closeOptions();
      else openOptions();
    }
  });

  /* ==========================================================
     DEMARRAGE
     ========================================================== */

  try {
    var n0 = localStorage.getItem("jnb.name");
    if (n0) { S.name = n0.slice(0, 10); $("#f-name").value = S.name; }
    var c0 = localStorage.getItem("jnb.color");
    if (c0 !== null) S.color = +c0;
    var v0 = localStorage.getItem("jnb.vol");
    if (v0 !== null) {
      $("#f-vol").value = v0;
      $("#vol-out").textContent = v0;
      JNB.sfx.vol = +v0 / 100;
      JNB.sfx.on = +v0 > 0;
    } else JNB.sfx.vol = 0.5;
    var m0 = localStorage.getItem("jnb.music");
    if (m0 !== null) {
      $("#f-music").value = m0;
      $("#music-out").textContent = m0;
      musicVol = +m0 / 100;
    }
  } catch (e) { /* mode prive */ }

  JNB.attach($("#stage"));
  buildColors();
  renderBinds();

  // Les navigateurs n'autorisent le son qu'apres un geste du joueur. On
  // ecoute donc des maintenant — et pas seulement une fois les images
  // chargees, sinon un clic pendant le chargement passait a la trappe.
  var woke = false;
  function wake() {
    JNB.sfx.wake();
    if (JNB.isRunning()) music(JNB.inLobby() ? "lobby" : "game");
    woke = true;
  }
  window.addEventListener("pointerdown", wake);
  window.addEventListener("keydown", wake);

  JNB.load().then(function () {
    enterLobby();
    if (woke) music("lobby");
    var direct = new URLSearchParams(location.search).get("room") || "";
    if (/^\d{4}$/.test(direct)) connect(direct, false);
    else if (new URLSearchParams(location.search).get("create") === "1") connect("", false);
  }).catch(function (err) {
    toast("Chargement impossible : " + err.message);
  });

  window.addEventListener("beforeunload", function () { if (sock) sock.close(); });
})();
