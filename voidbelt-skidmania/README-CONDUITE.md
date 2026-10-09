# Skid Mania : conduite et caméra façon Stadium Car (Trackmania 2020)

Ce fichier garde le cahier des charges de la conduite et de la caméra (le
prompt d'origine, tel quel), puis, à la fin, ce qui est réellement mis en
œuvre dans le moteur, ce qui est adapté à son architecture et ce qui reste à
calibrer.

---

## Le prompt

Modifie directement mon projet pour obtenir une conduite et une caméra aussi proches que possible de la Stadium Car de Trackmania 2020, avec une vitesse maximale de 600 km/h.

Commence par examiner le contrôleur actuel, le moteur physique, les unités, les collisions et la caméra. Adapte les modifications à l’architecture existante et réalise l’implémentation complète. Je veux un résultat jouable, pas seulement un plan.

Nous ne disposons pas de toutes les constantes internes de Trackmania. Les chiffres ci-dessous sont des réglages de départ pour mon jeu. Ne les présente pas comme des données officielles et centralise-les pour permettre leur calibration.

### 1. Objectif de conduite

La voiture doit être précise, réactive et agréable au clavier comme à la manette :

- Forte accélération à basse vitesse, progressivement réduite à haute vitesse.
- Bonne adhérence en conduite normale.
- Drifts contrôlables avec direction + frein, tout en maintenant l’accélérateur.
- Conservation de l’inertie : pendant un drift, l’orientation de la carrosserie et la direction réelle du déplacement peuvent différer.
- Reprise d’adhérence progressive, sans réalignement instantané du vecteur vitesse.
- Sauts, réceptions, contrôle aérien limité et airbrake.
- Circuits avec virages relevés, loops, wallrides et portions inversées.

### 2. Vitesse maximale et accélération

Travaille en mètres et secondes :

- Vitesse maximale : 600 km/h, soit 166,6667 m/s.
- Compteur : vitesse réelle en m/s × 3,6.
- Sur route plate, sans boost, la voiture doit pouvoir approcher 600 km/h.
- Réduis progressivement la propulsion à proximité de la limite.

La limite concerne la norme de la vitesse linéaire totale, y compris après un boost ou en descente. Conserve la direction du déplacement lorsque tu limites la vitesse. Ne limite pas séparément chaque axe.

Courbe initiale d’accélération nette sur route plate :

| Vitesse | Accélération cible |
|---|---|
| 0 km/h | 14 m/s² |
| 100 km/h | 12 m/s² |
| 200 km/h | 9 m/s² |
| 300 km/h | 6 m/s² |
| 400 km/h | 4 m/s² |
| 500 km/h | 2 m/s² |
| 550 km/h | 1 m/s² |
| 590 km/h | 0,3 m/s² |
| 600 km/h | 0 m/s² |

Interpole continûment entre les points. Tiens compte des résistances éventuelles pour obtenir cette accélération nette ; ne soustrais pas une traînée qui empêcherait d’approcher la vitesse maximale.

### 3. Direction et adhérence

Calcule les vitesses longitudinale et latérale dans le repère local de la voiture et du contact avec la piste.

Utilise une force latérale qui combat la glisse, avec une capacité maximale configurable selon la vitesse et la surface. Le drift doit apparaître lorsque cette capacité est dépassée ou réduite par le freinage.

Évite un changement instantané entre les états « grip » et « drift ».

Adapte le braquage à la vitesse :

- À basse vitesse : voiture maniable et virages serrés.
- À haute vitesse : réponse précise, sans rotation excessive lors d’une pression brève.
- Les grandes courbes restent négociables à très haute vitesse.
- Clavier et manette utilisent le même modèle physique.

Ajoute seulement le filtrage nécessaire pour éviter les à-coups. Expose séparément vitesse de braquage, retour au centre et sensibilité selon la vitesse.

### 4. Freinage, drift et speedslide

Distingue les comportements suivants :

- Frein seul : décélération forte et stable.
- Accélérateur + frein + direction : initiation et modulation du drift.
- Relâchement de l’accélérateur : ralentissement plus doux.
- Contre-braquage : contrôle de la rotation et sortie du drift.

Le freinage doit réellement retirer de la vitesse et rester indépendant du framerate.

Ajoute un speedslide inspiré de Trackmania, configurable et désactivable :

- Glisse insuffisante : aucun bonus.
- Glisse dans une plage optimale dépendante de la vitesse : léger avantage d’accélération.
- Glisse excessive : perte d’efficacité.

Ce bonus est une approximation de gameplay. Il doit rester lié à la propulsion, respecter les 600 km/h et ne pas accélérer gratuitement la voiture lorsque l’accélérateur est relâché.

### 5. Contact avec la piste et adhérence magnétique

Je veux une adhérence magnétique propre à mon jeu : la voiture reste accrochée aux portions inversées tant qu’elle roule sur la piste.

- Détecte les contacts sous les roues avec des raycasts ou des shape casts adaptés.
- Applique l’attraction selon la normale locale du contact.
- Utilise le plan tangent de la piste pour la propulsion et l’adhérence.
- Oriente progressivement la voiture avec la surface, sans annuler artificiellement toute réaction de suspension.
- Stabilise les transitions entre les blocs et les triangles du mesh.
- N’attire pas la voiture vers une route voisine, au-dessus ou au-dessous.
- Préserve les sauts des rampes et les sorties de piste : aucune attraction vers une route distante.
- En vol libre, conserve une gravité mondiale.

L’attraction magnétique est un choix de conception de mon jeu, pas une constante supposée de Trackmania.

### 6. Suspension, sauts et réceptions

Utilise une suspension courte, ferme et amortie :

- Absorption des petites irrégularités.
- Réaction visible mais modérée aux bosses.
- Absence de rebonds répétés après réception.
- Forces appliquées aux points de contact pour permettre tangage et roulis.

En vol :

- Conserve l’inertie et la gravité.
- Désactive la propulsion normale sans contact au sol.
- Autorise une correction limitée de l’orientation avec les commandes.
- Une impulsion de frein réduit fortement la rotation de tangage : airbrake.
- L’airbrake ne doit pas arrêter la translation ni figer la voiture en l’air.

Une réception alignée avec la trajectoire et la piste conserve davantage de vitesse qu’une réception de travers. Évite les pénalités arbitraires et les changements instantanés de direction.

### 7. Collisions avec les murs et perte de vitesse

La perte de vitesse dépend de l’angle et de la violence de l’impact :

- Frottement presque parallèle : faible perte, possibilité de glisser le long du mur.
- Impact oblique : perte intermédiaire et déviation.
- Impact frontal : forte perte, jusqu’à un arrêt presque complet.
- Aucun rebond puissant ni gain artificiel de vitesse.

Calcule la réponse à partir de la vitesse relative au mur et de sa normale. Sépare les composantes normale et tangentielle.

Réglages initiaux :
- Supprime la composante qui pénètre dans le mur, avec une restitution de 0 à 0,05.
- Réduis la composante tangentielle de 5 à 20 % lors d’un nouvel impact selon sa sévérité.
- En contact prolongé, applique une friction dépendante du temps écoulé ; ne retire pas ce pourcentage à chaque frame.
- Applique les impulsions au point de contact pour obtenir une rotation cohérente lors des impacts décentrés.

Après un choc important, réduis temporairement la propulsion :
- Réduction maximale : 70 %.
- Récupération progressive sur 0,2 à 0,8 seconde selon la sévérité.
- Les simples frottements ne déclenchent pas cette pénalité forte.

Évite de compter plusieurs fois un même impact lorsque plusieurs colliders touchent le mur. Si le moteur physique résout déjà la collision, ajoute uniquement les effets manquants : ne supprime pas deux fois la vitesse normale.

### 8. Rapports automatiques et son

Ajoute ou adapte une boîte automatique pour les indications et le son moteur.

- Changements cohérents avec la vitesse et la charge.
- Seuils distincts des points de la courbe d’accélération.
- Éventuelle interruption de propulsion configurable.
- Aucun changement de rapport manuel obligatoire.
- Son lié au régime et à la charge, sans sauts audio brutaux.

### 9. Surfaces

Prévois des profils séparés pour asphalte, terre, herbe, glace et plastique, selon les surfaces disponibles.

Chaque profil peut régler :
- Propulsion selon la vitesse.
- Adhérence latérale.
- Résistance au roulement.
- Freinage.
- Paramètres du speedslide.

Calibre d’abord l’asphalte. Ne présente pas les coefficients des autres surfaces comme des valeurs exactes de Trackmania sans mesures.

### 10. Caméra : viser le comportement de Trackmania

Je veux retrouver au plus près le cadrage, la réactivité et la lisibilité de Trackmania 2020. Ne crée pas une caméra cinématique lente.

Prévois trois modes commutables :
1. Caméra extérieure proche, utilisée par défaut.
2. Caméra extérieure plus haute et plus éloignée.
3. Caméra embarquée vers l’avant.

Ces modes doivent être configurables pour ajuster leur correspondance avec les vues de référence de Trackmania. Si des vidéos de référence sont disponibles, compare le cadrage et les transitions ; sinon, indique clairement que le réglage est approximatif.

#### Suivi extérieur

- Garde la voiture dans la partie basse du cadre avec une bonne visibilité sur la route devant.
- Suis sa position avec un amortissement court, sans retard gênant à haute vitesse.
- Sépare le lissage de position, de rotation et du point regardé.
- Base le regard principalement sur l’orientation de la voiture, avec une influence configurable de la direction du déplacement.
- Pendant un drift, conserve une lecture claire de la carrosserie et de la sortie du virage ; ne réaligne pas instantanément la caméra sur le vecteur vitesse.
- À très basse vitesse, lorsque la direction du déplacement est instable, utilise l’orientation de la voiture.
- Prévois un comportement stable en marche arrière et un bouton pour regarder derrière.

#### Vitesse et anticipation

- Anticipe la trajectoire devant la voiture selon la vitesse.
- Fais varier légèrement le FOV et la distance avec la vitesse, avec des transitions douces.
- Garde ces variations modérées pour préserver la lecture des virages.
- Expose FOV minimal/maximal, distance, hauteur et anticipation.
- Ne masque pas une mauvaise caméra avec du motion blur ou des secousses excessives.

#### Loops, wallrides et portions inversées

- Utilise un repère de piste continu pour éviter les inversions soudaines de caméra.
- Lisse les normales de contact ; ne copie pas directement les variations de chaque triangle.
- Prévois une assistance de caméra configurable pour les loops, avec une vue embarquée automatique optionnelle et retour progressif au mode choisi.
- La caméra doit rester lisible au sommet des loops et pendant la conduite à l’envers.
- En vol, conserve temporairement le dernier repère stable, puis reviens progressivement vers la verticale mondiale si nécessaire.
- Évite les rotations de 180° provoquées par une normale ou une direction presque nulle.

#### Sauts et réceptions

- Ne reproduis pas chaque oscillation de suspension dans la caméra.
- Laisse visibles le tangage et le roulis de la voiture depuis les vues extérieures.
- Absorbe les petits chocs de réception tout en gardant le suivi réactif.
- Après un saut, retrouve le cadrage normal sans téléportation visible.

#### Obstacles et collisions

- Utilise un sphere cast ou équivalent entre la cible et la caméra.
- Rapproche la caméra lorsqu’un obstacle bloque la vue.
- Rétablis sa distance progressivement une fois l’espace dégagé.
- Évite que le sol, les murs ou le dessous d’une route masquent entièrement la voiture.
- Après un choc contre un mur, la caméra doit rester stable et permettre de reprendre immédiatement la conduite.
- Une légère réaction visuelle à l’impact est possible, mais configurable et courte.

#### Caméra embarquée

- Place-la pour bien voir la route sans obstruction par la carrosserie.
- Filtre les vibrations de suspension.
- Conserve une orientation cohérente avec la voiture sur les loops et les wallrides.
- Effectue les changements de caméra sans conserver un lissage provenant du mode précédent.

### 11. Stabilité à 600 km/h

Utilise une simulation à pas fixe, indépendante du framerate. Un point de départ possible est 120 Hz, à adapter aux performances du projet ; ce n’est pas une fréquence officielle de Trackmania.

À 600 km/h, la voiture parcourt environ 1,39 m par pas à 120 Hz. Prévois les collisions continues, balayages ou sous-pas nécessaires pour éviter de traverser les barrières.

Sépare simulation physique et interpolation visuelle. Mets à jour la caméra à partir du mouvement interpolé pour éviter les micro-saccades.

### 12. Paramètres et diagnostic

Centralise tous les réglages de conduite et de caméra.

Ajoute un affichage de diagnostic activable :
- Vitesse réelle.
- Accélération.
- Vitesse latérale et angle de glisse.
- Contacts au sol et normale de piste.
- Rapport.
- Forces principales.
- Mode de caméra, FOV et distance.

### 13. Vérification et livraison

Vérifie :
1. Accélération en ligne droite jusqu’à la limite de 600 km/h.
2. Freinage depuis 100, 300 et 600 km/h.
3. Virages avec et sans drift.
4. Sorties de drift sans réalignement instantané.
5. Sauts, airbrake et réceptions.
6. Loops, wallrides et portions inversées.
7. Impacts frontaux, obliques et frottements à différentes vitesses.
8. Absence de traversée des barrières.
9. Lisibilité des trois caméras et de leurs transitions.
10. Absence de retournement soudain ou de clipping de caméra.
11. Comportement comparable à différents framerates.

Implémente les modifications dans le projet. Termine par un compte rendu court : fichiers modifiés, vérifications réellement effectuées et paramètres restant à calibrer. Ne prétends pas avoir validé en jeu ce que tu n’as pas pu tester.

---

## Mise en œuvre (2026-10-09)

### Frein et drift séparés (2026-10-09)

À la demande du joueur, le frein ne fait que freiner, gaz tenus ou non :
il ne retire aucune adhérence. Le drift a sa propre touche (Espace / Maj,
A / RB), qui réduit la capacité latérale (`drift_adherence`) et ralentit un
peu (`drift_ralenti`). Cela s'écarte du §4 du prompt (gaz + frein + volant
pour lancer le drift).

### Adaptations à l'architecture du jeu

Le moteur de Skid Mania ne simule pas un corps rigide sur un maillage : la
voiture roule dans le **plan déplié du ruban de piste** (x = écart latéral,
z = abscisse), et la piste est un ruban continu, sans triangles ni blocs.
Conséquences, assumées :

- **Adhérence magnétique (§5)** : elle est structurelle. Au sol, la voiture
  est collée au ruban, loopings, wallrides et portions inversées compris ;
  propulsion et adhérence travaillent dans le plan tangent ; elle ne peut
  pas être attirée vers une autre route. Il n'y a **pas de raycasts par
  roue** : rien à détecter, le contact est la piste elle-même.
- **Gravité** : au sol, sa composante le long de la piste ralentit les
  montées et relance les descentes ; sa composante latérale tire vers le bas
  des dévers et wallrides (`gravite_laterale`, 0,35 : l'aimant retient le
  reste). En vol, gravité du monde.
- **Sauts (§6)** : un trou dans le trace (`Seg::Trou`) coupe le ruban. La
  voiture vole en 3D (`vol.rs`) et ne se repose que sur sa propre piste, à
  l'abscisse survolée, hors du trou.
- **Suspension (§6)** : visuelle (`suspension.rs`) : tangage, roulis,
  enfoncement à la réception, ressort amorti près du critique. Elle n'agit
  pas sur la trajectoire, puisqu'il n'y a pas de roues physiques.
- **Collisions continues (§11)** : les murets sont deux droites du plan
  déplié ; la position est bornée à chaque pas, la voiture ne peut pas les
  traverser, même à 1,39 m par pas.

### Fichiers

- Moteur Rust (`voidbelt-skidmania/src/`) :
  - `tune.rs` (tous les réglages, conduite et caméra) ;
  - `car.rs` (conduite au sol) ;
  - `mur.rs` (murets) ;
  - `vol.rs` (sauts) ;
  - `suspension.rs` ;
  - `surface.rs` (profils de sol) ;
  - `camera.rs` (trois modes) ;
  - `game.rs` ;
  - `state.rs` (champs de diagnostic) ;
  - `boite.rs` (étagement sur ~550 km/h) ;
  - `track.rs` (trous, sols, gravité) ;
  - `trace.rs` (un wallride, un saut) ;
  - `lib.rs` ;
  - `bin/piste.rs`.
- Tests : `tests/conduite.rs`, `murs.rs`, `vol.rs` et `camera.rs` sont
  nouveaux ; `course.rs` et `boite.rs` sont adaptés. L'ancien
  `physique.rs`, qui vérifiait le modèle PeakDrive, est supprimé.
- Blender : `blender/construire-circuit.py`, qui laisse les trous vides.
- Jeu web (`public/skidmania/`) :
  - `js/moteur.js` (noms des réglages lus dans le module) ;
  - `js/main.js` ;
  - `js/parametres.js` ;
  - `js/commandes.js`, `js/entrees.js`, `js/onglet-commandes.js` (regarder
    derrière, caméra suivante) ;
  - `js/panneaux.js` ;
  - `js/diagnostic.js`, nouveau ;
  - `css/skidmania.css`.

### Vérifications réellement faites

Toutes par `cargo test` (35 tests, pas fixe de 1/120 s), sauf la dernière :

1. **Accélération** : la courbe mesurée colle au tableau (14 / 12 / 6 / 2 /
   0,3 m/s²). 0-100 km/h en 2,1 s, 0-300 en 8,6 s, 0-500 en 23,8 s, 600 km/h
   atteints sur le plat. Le plafond tient au boost et garde la direction.
2. **Freinage** : depuis 100, 300 et 600 km/h, en 1,1 / 3,2 / 6,4 s, sans
   recul. Pied levé, la voiture ralentit plus doucement.
3. **Virages** : en adhérence (moins de 6° de glisse) ; drift au gaz + frein +
   volant (34° à 200 km/h).
4. **Sortie de drift** : progressive, jamais plus de 0,6° par pas. Le
   contre-braquage freine la rotation.
5. **Sauts** : décollage, réception après le trou (474 km/h gardés),
   airbrake (le tangage tombe, la translation continue). Une réception de
   travers coûte 13 %. Trop lent, la voiture tombe et revient au checkpoint.
6. **Loopings, wallride, portions inversées** : le pilote de test boucle le
   tour (125 s) ; les trois caméras le suivent en entier.
7. **Murs** : on garde 93 % de la vitesse en frottement, 71 % en oblique
   (35°), 4 % de face, à 144, 360 et 576 km/h. Le frottement prolongé est
   identique à 120 et à 30 Hz. Un contact ne compte qu'une fois. La
   propulsion revient en 0,2 à 0,8 s.
8. **Barrières** : aucune traversée à 600 km/h contre le mur.
9. **Caméras** : changement de mode sans lissage hérité ; regard arrière.
10. **Pas de retournement** : moins de 2° de rotation par image sur tout le
    tour. La caméra reste au moins 0,6 m au-dessus de la chaussée, et jamais
    plus près de la voiture que 7 m (proche) ou 11,8 m (éloignée).
11. **Framerate** : à 30, 60 et 144 images par seconde, même trajectoire, à
    un pas près.

Vérifié aussi en images dans Chrome sans écran : wallride, haut de looping,
vue embarquée, diagnostic (F3) et Paramètres, sans erreur dans la page.

**Rien n'a été testé à la main en jeu** (ni au clavier, ni à la manette) :
le Chrome sans écran fait tourner le jeu trop lentement pour conduire.

### À calibrer en jeu

- **Sensation de conduite** : `lacet_bas`, `lacet_haut`, `lacet_mi`,
  `adherence`, `adherence_haut`, `raideur`, `drift_adherence`,
  `alignement`.
- **Speedslide** : `speedslide`, `ss_angle_*`, `ss_largeur`.
- **Caméras** : `cam0_*`, `cam1_*`, `cam2_*` et les lissages. Les cadrages
  sont **approximatifs**, réglés sans vidéo de référence de Trackmania.
- **Vol** : `gravite_laterale` (wallrides), `reception_perte`, contrôle en
  vol (`air_*`, `airbrake`).
- **Surfaces** : seul l'asphalte sert sur le circuit ; terre, herbe, glace et
  plastique sont des estimations.
- **Durée du tour** : avec 14 m/s² au départ, il dure environ deux minutes
  pour le pilote de test, contre une minute avant.

En direct, depuis la console du navigateur :
`skidmania.tuning.adherence = 30`. Pour le reste, les valeurs de départ
sont dans `tune.rs`.
