# Son moteur : mesures avant / après

Mission : `PROMPT-SON.md`. Banc : `npm run test:son` (`tests/skidmania-son/mesurer.mjs`).
Référence « avant » : `creation/son/moteur-worklet-reference.js` (le générateur de
Skidball tel quel, hasard à graine) et la finition d'origine (crête à 0,85,
douceur 0,25, grain 0,3). Mesures brutes : `tests/skidmania-son/avant.json` et
`apres.json`.

WAV d'écoute (hors dépôt) : `Documents\skidmania-son-ecoute\reference\` et
`...\v2\` : pour chaque moteur, les 4 sons, le tour de piste et le balayage de
régime.

## Tableau (son `continu`)

Stridence = énergie 2-6 kHz / 80-1 000 Hz, en dB. Centroïde en Hz.

| Moteur | Strid. avant | Strid. après | Baisse | Centr. avant | Centr. après | LUFS avant | LUFS après | TP avant | TP après | Strid. ×1,28 | Pic >3 kHz | Charge |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Kestrel | -43.7 | -57.7 | 14.0 | 141 | 142 | -6.7 | -16.0 | -2.1 | -10.7 | -44.6 | — | 3 % |
| Typhoon | -26.2 | -41.3 | 15.2 | 244 | 214 | -10.6 | -16.0 | -5.0 | -10.0 | -39.3 | — | 3,7 % |
| Mirage | -27.1 | -39.7 | 12.7 | 502 | 294 | -11.3 | -16.0 | -2.0 | -9.1 | -26.6 | -57.2 | 3,2 % |
| Grizzly | -31.4 | -41.4 | 10.0 | 201 | 178 | -6.8 | -16.0 | -2.1 | -9.5 | -34.1 | — | 3,1 % |
| Mammoth | -37.6 | -46.6 | 9.0 | 234 | 237 | -9.6 | -16.0 | -2.4 | -9.5 | -37.2 | -78.8 | 4,0 % |
| Raptor | -24.4 | -36.2 | 11.7 | 537 | 336 | -13.0 | -16.0 | -6.1 | -10.7 | -32.6 | -60.4 | 3,8 % |
| Banshee | -24.6 | -39.6 | 15.0 | 696 | 424 | -13.4 | -16.0 | -5.1 | -9.5 | -32.4 | -53.9 | 4,6 % |
| Leviathan | -34.5 | -42.5 | 8.1 | 485 | 464 | -9.8 | -16.0 | -4.3 | -11.4 | -33.8 | -60.6 | 4,3 % |
| Cobra | -34.9 | -46.2 | 11.3 | 187 | 176 | -6.6 | -16.0 | -1.7 | -10.6 | -38.0 | — | 3,2 % |
| Cyclone | -32.0 | -42.2 | 10.2 | 162 | 164 | -5.3 | -16.0 | -1.6 | -10.2 | -35.1 | -67.9 | 3,1 % |
| Hydra | -16.7 | -38.1 | 21.4 | 565 | 481 | -15.2 | -16.0 | -4.8 | -10.5 | -32.1 | — | 4,6 % |
| Howler | 2.6 | -22.3 | 24.9 | 1739 | 872 | -11.0 | -16.0 | -5.8 | -9.0 | 12.0 | -29.7 | 4,2 % |
| Hornet | -35.2 | -45.7 | 10.5 | 180 | 168 | -8.4 | -16.0 | -2.6 | -8.5 | -40.5 | — | 3,0 % |

« — » : aucun pic tonal isolé au-dessus de 3 kHz. Charge : temps de rendu
rapporté au temps réel, sur ce PC (même part d'un quantum de 128 échantillons
en direct).

Critères tenus sur les 13 moteurs : stridence du continu en baisse de 8 dB ou
plus ; aucune composante descendante au-dessus de -60 dB dans le balayage ;
aucun pic tonal isolé au-dessus de 3 kHz à plus de -24 dB du fondamental ;
chaque son à ±1 LU de sa cible (démarrage -17, froid -19, continu -16,
décélération -18 LUFS), true peak ≤ -1 dBTP ; aucun clic aux raccords de
boucle ni à la fin des sons ponctuels.

## Ce que chaque étape a apporté (baisse de stridence du continu)

Mesuré après chaque étape. La finition v2 (sonie, de-esser, douceur 0,4,
grain 0,45) était en place dès la première mesure de la v2.

| Étape | Effet mesuré |
|---|---|
| 1. Mordant : dérivée sous 2 pôles à 1,5 kHz | Howler +7,9 dB, Hydra +4,7 ; les autres -1 à +2,6 |
| 1 bis. Front de bouffée raidi par le mordant | **Pire** : Banshee -5,8 dB, Mirage -4,9. Abandonné. |
| 2-3. Saturation ADAA asymétrique, front plancher 0,4 ms | Howler +11,6 ; peu d'effet ailleurs |
| 4-5. Bruits roses et bruns, sons purs filtrés et plafonnés | Typhoon +5,4, Hydra +8,7, Howler +12,7 |
| 6-7. Silencieux qui suit la charge (24 dB/oct), guide d'onde fractionnaire à perte sur 2 pôles | Kestrel +10,1, Howler +22,1 ; V8/V10 encore à +1 / +2 |
| 6 bis. Saturation déplacée avant le silencieux | +3 à +5 dB partout (Kestrel +13,1, Cyclone +9,8) |
| 8. Fondamental d'allumage et harmoniques 2-3 | tous au-dessus de 8 dB (Leviathan 8,1 à Howler 24,9) |

## Ce qui n'a pas marché, ou pas comme prévu

- **Raidir le front de la bouffée** pour le mordant (piste suggérée par le
  prompt) ajoute de l'aigu au lieu d'en retirer : un front plus court est plus
  large bande. Le mordant passe donc seulement par la dérivée filtrée.
- **Le repliement attendu ne s'est pas montré.** Le premier détecteur trouvait
  des « composantes qui descendent » chez Mammoth et Hydra ; c'étaient des
  faux positifs (le suivi sautait d'une harmonique à sa voisine quand l'une
  s'éteignait en sortant d'une résonance de la ligne). Le détecteur corrigé,
  validé sur des signaux de test, ne trouve rien au-dessus de -60 dB, ni avant
  ni après. L'ADAA et le calage fractionnaire des bouffées restent, comme
  garantie.
- **Le « fondamental » de Howler** : à 9 500 tr/min, un V10 allume à 792 Hz ;
  le premier mesureur le cherchait sous 500 Hz et prenait la 4e harmonique
  pour un pic isolé. La recherche va maintenant jusqu'à 1,2 kHz.
- **La mise en route à ±1 LU** a demandé deux tours gain + limiteur : le
  limiteur retire un peu de sonie, le second tour la rend.

## Ce qui reste

- **Howler à 1,28** : sa boucle `continu` remontée de 4 demi-tons repasse à
  +12 dB de stridence (elle était à +18 avant). C'est le seul moteur au-dessus
  de 0 dB : ses harmoniques d'allumage (792, 1 584, 2 376 Hz…) entrent dans la
  bande 2-6 kHz dès qu'on accélère la lecture. Piste suivante : pour un moteur
  à zone rouge au-delà de 12 000 tr/min, générer le continu un peu plus bas
  (0,4 de la zone rouge au lieu de 0,5) et/ou plafonner le `playbackRate` à
  1,15 pour ce moteur. Dans Skid Mania, le moteur par défaut est Raptor (V8),
  qui reste à -32,6 dB à 1,28.
- **Écoute** : pas d'appareil Android branché sur cette machine (pas d'adb), et
  aucune écoute au casque ici. Les mesures disent que la stridence est partie et
  que la sonie est égale ; elles ne disent pas que le glouglou du V8 croisé ou le
  « brap » des rotatifs sont intacts. **À écouter** : les WAV avant/après sont
  côte à côte dans `Documents\skidmania-son-ecoute`.
- **Budget téléphone** : la charge mesurée ici (3 à 4,7 % sur PC) est un rendu
  hors ligne, pas un `process` mesuré sur Galaxy A54. Elle a augmenté d'environ
  1,5 point avec la v2 (silencieux recalculé tous les 64 échantillons, Lagrange,
  ADAA). Un téléphone milieu de gamme est souvent 4 à 6 fois plus lent qu'un
  PC : on resterait sous 25 %, mais c'est à confirmer sur l'appareil.

## Si cela ne suffit pas (non implémenté)

Porter le cœur du générateur (bouffées, ligne, saturation) en Rust compilé en
wasm, appelé depuis le worklet par un tampon partagé, comme le moteur de jeu de
Skid Mania (`voidbelt-skidmania/`). Gain attendu : 2 à 4 fois plus rapide que le
JS sur téléphone, ce qui paie un suréchantillonnage ×2 de toute la ligne (le
peigne et la saturation travailleraient à 96 kHz) et un modèle de ligne plus fin
(deux tubes, collecteur en Y). Coût : 2 à 3 jours, un worklet qui charge du wasm
(possible, `WebAssembly.instantiate` dans le worklet avec les octets passés par
`processorOptions`), et le banc à faire tourner sur les deux versions pour
vérifier qu'elles sonnent pareil.
