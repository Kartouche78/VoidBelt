# VoidBelt

## Lancer le site en local

```bash
npm start
```

Le site est ensuite disponible sur <http://localhost:8080>.

Deux pages de jeu : `/arena/` et `/jumpnbump/`.

## Jump'n Bump

Quatre lapins, une falaise flottante, un bassin et un trampoline. Le jeu
tourne entierement dans le navigateur ; le serveur ne tient que les
salons et arbitre les sauts mortels via la passerelle multijoueur.

Le bouton de creation genere un code a quatre chiffres. Un code saisi ne
peut rejoindre qu'un salon encore dans son lobby. Les zones de spawn sont
attribuees par le serveur Rust : les joueurs vivants apparaissent a des
endroits distincts, y compris apres une mort.

Les salons vivent en memoire : redemarrer le serveur les efface. En
local, la page parle au serveur qui la sert ; en ligne, elle parle a
`api.voidbelt.com`, qui doit donc faire tourner ce meme binaire pour que
le multijoueur fonctionne. L'entrainement solo, lui, marche sans serveur.

## Passerelle multijoueur

L'interface `/multiplayer/` liste les salons Jump'n Bump et permet de
creer ou rejoindre une partie. Elle n'est pas affichee sur l'accueil.

Les routes `/api/multiplayer/*` et `/api/jnb/*` utilisent les memes salons.
L'interface retombe sur `/api/jnb/rooms` si la passerelle est indisponible.
