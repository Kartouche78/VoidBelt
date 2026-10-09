# Prompt : son moteur riche et rond (mission de la Création > Son)

Ce prompt a été écrit pour Skidball. Il est appliqué ici à **Skid Mania**, dont
la Création reprend le moteur de son de Skidball. Correspondance des chemins :

| Dans le prompt (Skidball)                 | Ici (Skid Mania)                                        |
| ----------------------------------------- | ------------------------------------------------------- |
| `web/src/game/moteur-worklet.js`          | `public/skidmania/creation/son/moteur-worklet.js`       |
| (état d'origine, référence « avant »)     | `public/skidmania/creation/son/moteur-worklet-reference.js` |
| `web/src/game/moteur.js`                  | `public/skidmania/creation/son/moteur.js`               |
| `web/src/game/generateur-moteur.js`       | `public/skidmania/creation/son/generateur.js`           |
| `web/src/game/effets.js` (moteurs)        | `public/skidmania/creation/son/recettes.js`             |
| `web/src/game/banc-moteur.js`             | `public/skidmania/creation/son/banc.js`                 |
| `web/src/creation/sons/`                  | `public/skidmania/creation/` (page Création, section Son) |
| `web/src/game/audio.js` (lecture en match)| `public/skidmania/js/son.js`                            |
| `web/tests/` + `npm run test:son`         | `tests/skidmania-son/` + `npm run test:son`             |
| `/api/effets` (recettes sur le serveur)   | le navigateur (`localStorage`), voir `versionSon`       |

Le compte rendu des mesures est dans `RESULTATS-SON.md`, à côté de ce fichier.

---

# Mission : un son moteur riche et rond, plus jamais strident

Tu travailles sur Skidball (football motorisé vu de dessus, web + Android).
Lis d'abord `CLAUDE.md` : ses règles s'appliquent (français, commentaires sans
accents qui expliquent le pourquoi, web ET téléphone, vérification avant de
dire « fini »).

## Ce qui existe

Le son moteur est **procédural**, inspiré d'Engine Simulator (ange-yaghi),
sans sa thermodynamique :

- `web/src/game/moteur-worklet.js` : l'AudioWorklet qui fabrique le son
  échantillon par échantillon. Le vilebrequin tourne au régime demandé, et
  chaque cylindre lâche une « bouffée » à son angle d'ouverture
  d'échappement. La bouffée passe par son collecteur (retard, atténuation),
  puis par la ligne d'échappement (tube résonant en guide d'onde, réflexion
  inversée), puis par le silencieux (2 biquads passe-bas). La synthèse
  mélange ensuite le signal et sa dérivée (« mordant »), le module par du
  bruit (« souffle »), le sature en tanh (« rugosité ») et nivelle le volume.
  Par-dessus s'ajoutent : admission, turbo (sifflement + sinus), soupape de
  décharge, sifflement de boîte, démarreur, pétarades. Le fichier doit
  rester **autonome** (un worklet ne charge pas de module).
- `web/src/game/moteur.js` : les architectures (angles d'allumage par
  cylindre, lignes, bouffée), `configMoteur(recette)`, la boîte virtuelle
  (`Boite`) et `rendreScenario` (rendu hors ligne via OfflineAudioContext).
- `web/src/game/generateur-moteur.js` : rend hors ligne les 4 sons utilisés
  en match (`demarrage`, `froid`, `continu`, `deceleration`), les met en
  boucle, les normalise **en crête** (0,85), puis `appliquerSynthese` :
  graves/aigus en shelf, « douceur » (passe-bas), « grain » (cloche -dB à
  4,2 kHz), compresseur, petite réverb.
- `web/src/game/effets.js` : `CHAMPS.moteur` (les curseurs de la recette),
  `DEFAUT.moteur`, `SYNTHESE`, et les 13 moteurs d'usine `USINE.moteur`
  (Kestrel L4, Typhoon V6 turbo, Mirage flat-6, Grizzly boxer, Mammoth V8
  croisé, Raptor V8 plat, Banshee V10, Leviathan V12, Cobra L5, Cyclone et
  Hydra rotatifs, Howler V10 F1 à 19 000 tr/min, Hornet L3).
- `web/src/game/banc-moteur.js` + `web/src/creation/sons/` : le banc d'essai
  et l'atelier de création (scénarios, export WAV).
- En match, **seuls les 4 sons pré-générés jouent** (`web/src/game/audio.js`) :
  `engineOn` en boucle, avec un `playbackRate` de 0,82 à 1,28 selon la
  vitesse. Le simulateur en direct n'est qu'un outil de création.

## Le problème

Le son est **beaucoup trop strident**, surtout sur les haut-parleurs de
téléphone : agressif dans les 2-6 kHz et fatigant après un match. Il nous
faut un son de moteur plein, grave et rond, qui garde son mordant sans
siffler.

Causes probables vues dans le code. **Mesure-les avant de corriger**, ne
les prends pas pour acquises :

1. **Le « mordant » est un filtre passe-haut caché.** Dans
   `Ligne.f`, `(y - avant) * 6`, lissé à ~2,8 kHz, dépasse le signal brut
   dès ~1,2 kHz. On amplifie donc exactement la bande où l'oreille est la
   plus sensible. Défauts 0,4 à 0,7 selon les moteurs.
2. **La saturation `tanh` n'a pas d'anti-repliement.** Avec un drive
   jusqu'à ×6 et aucun suréchantillonnage, les harmoniques impaires
   au-delà de Nyquist se replient en grésillement aigu et non harmonique.
3. **Des sons purs et aigus échappent au silencieux.** Admission, turbo,
   soupape, boîte et démarreur sont ajoutés *après* les lignes, donc sans
   aucun passe-bas. Le sifflement de boîte est un sinus à 17 × régime/60
   (2,5 kHz à 9 000 tr/min, **5,4 kHz** sur Howler). Le sinus turbo monte
   jusqu'à 8,8 kHz. Le sifflet turbo est un passe-bande à 2,4 kHz, Q 6,
   sur du **bruit blanc**.
4. **Bruit blanc partout** (`Math.random`) : souffle, admission, soupape.
   Le bruit blanc a autant d'énergie par Hz dans les aigus, donc il siffle.
5. **Le silencieux est trop ouvert** : coupure jusqu'à 5,2 kHz, et il ne
   change pas avec le régime.
6. **Le guide d'onde de la ligne** : la réflexion -0,72 et un seul pôle de
   perte (~3 kHz) donnent des pics de peigne qui « sonnent métal ».
7. **Le « corps » grave est maigre** : un seul passe-bande à
   150 - 12 × cylindrée Hz. Sur un téléphone, ces graves disparaissent et il
   ne reste que les aigus.
8. **La chaîne finale ne corrige presque rien.** Par défaut, « douceur »
   0,25 donne un passe-bas à ~10,8 kHz et « grain » 0,3 seulement -4 dB à
   4,2 kHz. La normalisation en **crête** (pas en sonie) laisse le volume
   perçu varier d'un moteur à l'autre.
9. **En match**, `playbackRate` 1,28 remonte tout le spectre de 4,3
   demi-tons à pleine vitesse.

## Ce que je veux

### 1. D'abord, mesurer (avant toute retouche du son)

Construis un banc de mesure reproductible :

- Un script Puppeteer (Chrome local, comme les autres tests de `web/tests/`)
  qui rend hors ligne, pour **chacun des 13 moteurs d'usine**, les 4 sons
  du générateur et le « tour de piste » de `banc-moteur.js`. Il exporte les
  WAV dans un dossier hors du dépôt et renvoie les échantillons à Node.
- Remplace `Math.random` par un PRNG à graine (xorshift32 ou mulberry32)
  pour que deux rendus soient identiques et comparables.
- Mesures dans Node (FFT maison ou petite dépendance de dev) :
  - centroïde spectral ;
  - énergie 2-6 kHz rapportée à 80-1 000 Hz, en dB : l'**indice de
    stridence** ;
  - sonie intégrée en LUFS (pondération K, ITU-R BS.1770) et true peak ;
  - facteur de crête ;
  - pics tonals isolés au-dessus de 3 kHz ;
  - test de repliement : un balayage de régime ne doit produire **aucune**
    composante qui descend quand le régime monte.
- Sauvegarde les mesures de l'état actuel comme **référence « avant »**.

### 2. Corriger la stridence dans le moteur de son

Dans cet ordre, avec une mesure après chaque étape :

1. **Mordant** : remplace la dérivée brute par une attaque prise dans le
   **domaine temporel**. Le front de la bouffée devient plus raide
   (`montee`) au lieu d'amplifier les aigus. Par exemple un « transient
   shaper » sur l'enveloppe, ou une dérivée passée par un passe-bas à
   ~1,5 kHz.
2. **Saturation** : ajoute un anti-repliement : ADAA du premier ordre
   (antidérivée de tanh = log cosh), ou suréchantillonnage ×2/×4 par filtre
   demi-bande polyphase autour de l'étage non linéaire uniquement.
   Envisage une saturation asymétrique douce, à harmoniques paires,
   plus chaude.
3. **Bouffées à bande limitée** : à haut régime, la bouffée raccourcit et son
   front devient un clic large bande. Arrondis le front en fonction de la
   durée en échantillons (correction de type BLEP, ou durée de montée
   plancher en µs).
4. **Bruits colorés** : bruit rose (Voss-McCartney ou filtre de Paul
   Kellet) pour le souffle et l'admission, bruit brun pour le grondement.
   Le sifflet turbo reste, mais filtré, discret, et suit la pression.
5. **Tout passe par l'échappement ou par un filtre** : le sifflement de
   boîte et le sinus turbo passent sous un passe-bas qui suit le régime.
   Plafonne ce que les sons purs font dans les 3 kHz et plus (le sifflement
   de Howler doit rester une couleur, pas une alarme).
6. **Silencieux qui suit le régime** : coupure plus basse, qui s'ouvre
   avec la charge (un vrai silencieux est sombre au ralenti et s'ouvre en
   pleine charge). Pente 24 dB/oct au-delà.
7. **Guide d'onde** : perte dépendante de la fréquence dans la boucle
   (passe-bas plus marqué, ou deux pôles) et délai **fractionnaire** (Thiran
   passe-tout ou Lagrange du 3e ordre) pour que la longueur de ligne ne
   donne ni pics métalliques ni « fermeture éclair » quand elle change.
8. **Graves pour le téléphone** : renforce le fondamental du cycle
   (régime/60 × cylindres/2) et ajoute des **harmoniques psychoacoustiques**
   (2e et 3e harmoniques générés depuis le grave filtré, l'effet de
   fondamentale manquante). Le grondement doit s'entendre sur un
   haut-parleur qui ne descend pas sous 300 Hz. Ne monte pas les aigus pour
   compenser.

### 3. Mieux finir les sons générés (`generateur-moteur.js`)

- Normalisation en **sonie** (cible ~-16 LUFS, true peak ≤ -1 dBTP) au lieu
  de la crête, en gardant les écarts voulus entre les 4 sons.
- Un **de-esser / égaliseur dynamique** 2,5-6 kHz qui ne mord que quand cette
  bande déborde. Il sert de filet de sécurité, pas de correction
  principale.
- Change les **valeurs par défaut** de `SYNTHESE` si les mesures le
  justifient (douceur, grain).
- Pense au `playbackRate` jusqu'à 1,28 en match : la boucle `continu` doit
  rester douce même remontée de 4 demi-tons. Mesure-la aussi à 1,28.

### 4. Si tout cela ne suffit pas

Propose, sans l'implémenter, une option plus ambitieuse avec son coût. Par
exemple : porter le cœur DSP en Rust → wasm dans le worklet, pour se payer
un suréchantillonnage ×4 partout sur téléphone, ou un modèle physique plus
fin. Le dépôt compile déjà du Rust en wasm (`build.ps1`).

## Contraintes

- **Garde le caractère de chaque moteur.** Le glouglou du V8 croisé, le
  grondement du boxer, le « brap » des rotatifs et le hurlement de la F1
  doivent se reconnaître. Seule l'agressivité doit partir, pas la
  personnalité.
- **Compatibilité des recettes** : les moteurs créés dans l'atelier sont
  enregistrés sur le serveur (`/api/effets`). Les curseurs existants gardent
  leur sens (tu peux changer leur effet interne, pas les supprimer). Si un
  curseur devient inutile, garde-le lisible et documente-le.
- **Les sons déjà générés ne changent pas tout seuls** (fichiers stockés).
  Prévois et documente la régénération des moteurs publiés, par exemple un
  champ `versionSon` pour repérer ceux à régénérer.
- **Performance téléphone** : le worklet tourne en direct dans l'atelier.
  Budget : moins de 25 % d'un quantum de 128 échantillons sur un Galaxy A54.
  Mesure-le (temps de `process`), ne le suppose pas.
- Le worklet reste un fichier autonome, sans `import`.
- Pas de nouvelle dépendance d'exécution. Une petite dépendance de **dev**
  pour l'analyse est acceptable si elle est justifiée.

## Critères d'acceptation

À ajuster une fois la référence mesurée, mais vise :

- Indice de stridence (2-6 kHz / 80-1 000 Hz) en baisse d'**au moins
  8 dB** sur le son `continu` de chaque moteur d'usine (Howler compris,
  même s'il reste le plus brillant).
- Plus aucun produit de repliement au-dessus de -60 dB dans le test de
  balayage.
- Plus aucun pic tonal isolé au-dessus de 3 kHz, plus fort que -24 dB
  par rapport au fondamental.
- Les 4 sons de chaque moteur à ±1 LU de leur cible, true peak ≤ -1 dBTP.
- Aucun clic aux raccords de boucle (`froid`, `continu`) ni à la fin des
  sons ponctuels.
- Avant/après écoutés **sur le Galaxy A54** (adb, voir `CLAUDE.md`) et au
  casque sur ordinateur.
- `npm run build`, `npm run test:engine` et les tests UI touchés passent.

## Livrables

1. Les changements, en petits commits lisibles (mesure, puis chaque
   correction).
2. Le banc de mesure dans `web/tests/` et une commande `npm run test:son`.
3. Un tableau avant/après par moteur (stridence, centroïde, LUFS,
   true peak).
4. Les WAV avant/après des 13 moteurs pour l'écoute, hors du dépôt, avec le
   chemin.
5. Ce qui n'a pas marché, et la piste suivante si un moteur reste trop
   brillant.
