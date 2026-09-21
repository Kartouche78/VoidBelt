# VoidBelt

## Lancer le site en local

```bash
npm start
```

Le site est ensuite disponible sur <http://localhost:8080>.

Les fichiers de `/rl2/` sont servis en `no-cache` : le navigateur revalide a
chaque chargement. Sans en-tete il applique sa propre heuristique et peut
servir un module d'hier a cote d'un module d'aujourd'hui, ce qui suffit a
casser la page.

Pages de jeu : `/arena/`, `/jumpnbump/` et `/rl2/`.

## RL2 — football motorise

`/rl2/` : un 1 contre 1 vu de dessus, dans l'esprit de Rocket League mais a
plat, sans saut. Le menu lance directement un match contre la machine.

Toute la simulation vit dans `voidbelt-rl2/`, un module Rust compile en
WebAssembly sans binding genere : le JavaScript ne fait que lire un tampon de
`f32` dans la memoire lineaire et dessiner. Le navigateur n'arbitre rien.

```bash
npm run test:rl2     # 28 tests de regles et de physique
npm run build:rl2    # compile puis depose public/rl2/rl2.wasm
```

### Ce qui vient du jeu d'origine

Vitesses, accelerations, cout du boost et poussee des frappes sont repris des
valeurs de Rocket League (uu/s) puis ramenes a l'echelle de l'arene dessinee.
Le terrain porte les 34 plots reglementaires — 6 gros a 100 de boost qui
reviennent en 10 s, 28 petits a 12 qui reviennent en 4 s. Le chrono a plat sur
un score de parite bascule en prolongation en but en or.

Se rentrer dedans pousse. Au-dela de 90 km/h au compteur, le choc demolit : la
victime explose sur place et revient de son camp trois secondes plus tard. Un
frontal entre deux voitures lancees ne laisse pas de survivant.

Le drift fait vraiment glisser. La vitesse vit dans le repere du monde, pas
dans celui du chassis : braquer ne fait tourner que le nez, et c'est l'ecart
entre le nez et la trajectoire que l'adherence rattrape — vite en appui (une
dizaine de degres de derive), lentement au frein a main (une quarantaine).

Les murs ne bloquent jamais. Il n'y a pas de verticalite, donc pas de montee
au mur : a la place, le contact conserve la vitesse tangentielle et redresse
le nez vers la paroi. On la longe au lieu d'y rester plante. L'aire roulable
va jusqu'a la bordure du stade, gouttiere peinte comprise.

### Les planches

Tout l'habillage vit dans `public/rl2/assets/`. `terrain.png` et `stade.png`
sont dessinees dans le meme repere 1672 x 941, terrain deja place dans son
stade : les deux planches se posent a l'echelle 1:1, sans rien mettre a
l'echelle. Les bornes de l'enceinte (`voidbelt-rl2/src/arena.rs`) sont
relevees sur la decoupe transparente de `stade.png`.

Les cages debordent sur le terrain : leur bouche est en retrait du muret de
trente-deux unites. Le muret lateral avance donc jusqu'a leur face sur toute
la hauteur de l'ossature, avec un biseau de raccord — sans quoi un creux se
forme entre la cage et le muret, et on s'y coince. Ce biseau tient aussi lieu
de montant : un disque de poteau ajoute par-dessus se contredirait avec le
muret et bloquerait le mobile entre les deux.

Chaque plot est dessine en deux couches, `_socle` et `_boost`. Seule la
seconde part au ramassage : le socle metallique reste visse au sol et
l'orbe y repousse a la reapparition.

Les voitures viennent de `car_bleue.png` et `car_orange.png`, dessinees nez
vers le haut quand le monde met le cap sur `+x` : le chassis porte donc un
quart de tour a lui seul. La boite de collision reprend leur format 2:3, si
bien que la physique colle au dessin. `car_white.png` attend un choix de
carrosserie.

### Le son

Les bruits de jeu sont synthetises au vol, sans aucun fichier. Deux moments
font exception et utilisent des pistes fournies : `goal-sound.mp3` pour
l'ovation du but et `countdown.mp3` pour le decompte. Si l'une manque, le
jeu retombe sur sa version synthetisee.

Les durees de phase sont calees sur ces pistes, et un test les verrouille.
`countdown.mp3` garde une seconde de silence avant d'egrener 3, 2, 1 puis le
depart a la quatrieme : le decompte dure donc quatre secondes, la premiere
sans chiffre a l'ecran. `goal-sound.mp3` tient 5,6 s quand la fete en dure
4,6 : sa queue deborde sur le silence d'entree du decompte suivant, si bien
que les deux pistes ne se marchent jamais dessus.

### Multijoueur

`/api/rl2/rooms` liste les salons ouverts, `/api/rl2/ws` les fait vivre. Le
serveur ne relaie pas : il fait tourner **le meme moteur** que le navigateur,
en dependance normale du crate `voidbelt-rl2`. Les clients n'envoient que
leurs commandes (quatre `f32`), le serveur simule a 60 Hz et rediffuse l'etat
complet en binaire. Personne ne peut donc mentir sur sa position, et les deux
camps voient rigoureusement la meme partie.

Un salon simule des sa creation : on y roule librement, sans chrono ni score,
en attendant que l'hote lance le match — le bouton prend la place du tableau
d'affichage. Rejoindre depose directement sur le terrain, pas dans une salle
d'attente. Un match fini ramene tout le monde a l'echauffement au bout de huit
secondes, prets a remettre ca.

Le navigateur affiche le monde 70 ms dans le passe et interpole entre les deux
dernieres images recues : la gigue du reseau ne se voit pas. Un client qui
cesse d'emettre (onglet passe en arriere-plan) voit sa voiture relacher les
gaz au bout de six dixiemes, au lieu de filer tout droit sur sa derniere
consigne.

Les salons vivent en memoire. Le jeu parle au serveur qui le sert, quel
qu'il soit ; seul le site statique de Cloudflare fait exception, ses salons
etant sur `api.voidbelt.com`, qui doit donc faire tourner ce meme binaire.

### Jouer a plusieurs sans rien deployer

Le serveur local a deja tout, site et salons compris : il ne lui manque
qu'une adresse publique.

```bash
npm start     # un terminal : le serveur
npm run share # un autre : ouvre un tunnel et affiche l'adresse a partager
```

`partager.sh` recupere `cloudflared` a la volee et en tire une adresse
`trycloudflare.com` valable le temps de la session, sans compte ni
installation. Les invites ouvrent cette adresse suivie de `/rl2/` et
rejoignent les salons directement. L'adresse change a chaque lancement, et
tout se ferme avec le tunnel.

Un salon tient deux pilotes, puisque le moteur joue en un contre un.

### Commandes

Manette par defaut (mapping Xbox) : RT accelere, LT freine puis recule,
stick gauche dirige, B boost, X drift, Start met en pause. Au clavier :
fleches, `Maj` pour le boost, `Espace` pour le drift, `Echap` pour la pause.
Tout est reassignable dans les parametres, avec les volumes, la duree du
match, le niveau du bot et le mode de camera.

La boucle d'affichage survit a une image ratee : l'erreur est signalee une
fois a l'ecran, et le jeu continue. Sans ce filet, la moindre exception
arretait le rendu pour de bon et laissait un ecran noir muet.

Les menus se parcourent entierement a la manette, croix directionnelle ou
stick : A valide, B revient en arriere. Les rangees horizontales — onglets,
choix, les deux colonnes clavier et manette d'une ligne de reglage — se
parcourent a gauche et a droite, tandis que haut et bas passent au reglage
suivant en sautant le reste de la rangee. Sur un curseur, gauche et droite
reglent la valeur. Le focus est souligne d'un liseré : celui du navigateur
ne se voit pas toujours quand il vient d'une manette. Dans un salon en
ligne, A lance la partie sans passer par la souris.

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
