# VoidBelt

## Lancer le site en local

```bash
npm start
```

Le site est ensuite disponible sur <http://localhost:8080>.

Quatre pages de jeu : `/arena/`, `/velocity/`, `/jumpnbump/` et
`/shutdown/`.

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

## Shutdown

Un district a la grille, jusqu'a quatre Fennec et une manette. Les salons
et les collisions sont arbitres par le serveur Rust. La ville
(chaussee, trottoirs, immeubles) est fabriquee au chargement, textures
comprises, et la seule ressource lue sur le disque est le modele de la
voiture, `public/shutdown/models/fennec/scene.gltf`.

Les quatre roues sont des noeuds separes du fichier glTF. Au
chargement, elles sont detachees du chassis et remontees sur des pivots
maison : un pour tourner, un second au-dessus pour braquer les roues
avant. L'orientation du modele n'est pas codee en dur, elle se deduit
de la position des roues.

La manette est la commande de reference (gachettes, manche gauche pour
braquer, manche droit pour regarder) ; le clavier reprend les memes
actions en secours.

Le modele est « Fennec - Rocket League Car » par Jako, sous licence
CC-BY-4.0 ; le credit est affiche dans l'ecran de pause du jeu, voir
`public/shutdown/models/fennec/license.txt`.

## Passerelle multijoueur

L'interface globale `/multiplayer/` cree un salon en choisissant le jeu,
puis ouvre directement celui-ci. Le code a quatre chiffres reste visible
et copiable dans le menu Echap de chaque jeu. Les salons ouverts indiquent
leur jeu et permettent de le rejoindre sans repasser par un deploiement.

En production, Jump'n Bump et Shutdown partagent le relais Rust deja
disponible sur `/api/jnb/*`. Le type de jeu est transporte avec le salon et
chaque paquet d'etat accepte une enveloppe specifique au jeu. Ajouter un
nouveau jeu consiste donc a brancher son client sur ce relais et a
l'enregistrer dans `/multiplayer/`, sans nouvelle route, SSH ou API.

Les routes Rust plus explicites `/api/multiplayer/*` et `/api/shutdown/*`
restent disponibles pour un futur deploiement. L'interface retombe
automatiquement sur le relais partage tant que cette version du backend
n'est pas installee.
