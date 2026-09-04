(function () {
  "use strict";
  var local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  var api = local ? location.origin : "https://api.voidbelt.com";
  var names = { jumpnbump: "JUMP'N BUMP", shutdown: "SHUTDOWN" };
  var paths = { jumpnbump: "/jumpnbump/", shutdown: "/shutdown/" };

  function refresh() {
    document.getElementById("state").textContent = "SYNCHRONISATION…";
    fetch(api + "/api/multiplayer/rooms", { headers: { accept: "application/json" } })
      .then(function (response) { if (!response.ok) throw new Error(); return response.json(); })
      .catch(function () {
        return fetch(api + "/api/jnb/rooms", { headers: { accept: "application/json" } })
          .then(function (response) { if (!response.ok) throw new Error(); return response.json(); })
          .then(function (rooms) {
            return rooms.map(function (room) {
              room.game = room.players.some(function (name) { return /^SHD-/.test(name); })
                ? "shutdown" : "jumpnbump";
              return room;
            });
          });
      })
      .then(render)
      .catch(function () { document.getElementById("state").textContent = "PASSERELLE INJOIGNABLE"; });
  }

  function render(rooms) {
    var box = document.getElementById("servers");
    box.innerHTML = "";
    document.getElementById("state").textContent = rooms.length + " SERVEUR(S) DISPONIBLE(S)";
    if (!rooms.length) {
      box.innerHTML = '<p class="empty">Aucun serveur ouvert. Créez la première partie ci-dessous.</p>';
      return;
    }
    rooms.forEach(function (room) {
      if (!paths[room.game]) return;
      var card = document.createElement("a");
      card.className = "server";
      card.href = paths[room.game] + "?room=" + encodeURIComponent(room.code);
      var game = document.createElement("span"); game.className = "game"; game.textContent = names[room.game];
      var code = document.createElement("b"); code.className = "code"; code.textContent = room.code;
      var players = document.createElement("span"); players.className = "players";
      players.textContent = (room.players || []).map(function (name) {
        return String(name).replace(/^(?:JNB|SHD)-/, "");
      }).join(" · ") + "  [" + room.players.length + "/" + room.max + "]";
      card.append(game, code, players); box.appendChild(card);
    });
  }

  document.getElementById("refresh").addEventListener("click", refresh);
  refresh();
  setInterval(refresh, 5000);
})();
