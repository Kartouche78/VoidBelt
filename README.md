# VoidBelt

## Lancer le site en local

```bash
npm start
```

Le site est ensuite disponible sur <http://localhost:8080>.

Trois pages de jeu : `/arena/`, `/velocity/` et `/jumpnbump/`.

## Jump'n Bump

Quatre lapins, une falaise flottante, un bassin et un trampoline. Le jeu
tourne entierement dans le navigateur ; le serveur ne tient que les
salons et arbitre les sauts mortels, via `GET /api/jnb/rooms` et le
WebSocket `/api/jnb/ws?name=...&room=...`.

Les salons vivent en memoire : redemarrer le serveur les efface. En
local, la page parle au serveur qui la sert ; en ligne, elle parle a
`api.voidbelt.com`, qui doit donc faire tourner ce meme binaire pour que
le multijoueur fonctionne. L'entrainement solo, lui, marche sans serveur.
