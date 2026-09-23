// Prompt du gabarit standard, tel qu'il a ete ecrit et valide. Les cotes
// sont celles du gabarit d'origine (1672 x 941) converties en 1920 x 1080 ;
// a moins d'un pixel pres, ce sont celles de `Gabarit.jpg`.

export const PROMPT_STANDARD = `Crée un stade complet en 1920 × 1080 pixels, en vue strictement verticale du dessus, sans perspective ni inclinaison. Respecte la géométrie suivante, convertie depuis le gabarit de 1672 × 941 pixels. Les coordonnées ont pour origine le coin supérieur gauche de l’image.

Terrain — limites de la hitbox du muret

Élément	Dimensions en pixels
Bord gauche	x = 198,66
Bord droit	x = 1720,19
Bord haut	y = 143,46
Bord bas	y = 899,81
Largeur	1521,53
Hauteur	756,34
Centre	x = 959,43 ; y = 521,64
Rayon des coins	95,31 horizontalement ; 95,26 verticalement

Le terrain forme un rectangle horizontal aux quatre coins arrondis. Conserve sa position légèrement au-dessus du centre de l’image.

Cages et poteaux

Deux cages identiques se font face, centrées à y = 521,64, sur les côtés gauche et droit. Leurs ouvertures sont tournées vers le terrain.

Élément	Dimensions en pixels
Demi-ouverture	98,70
Ouverture totale	197,41
Limite haute de l’ouverture	y = 422,94
Limite basse de l’ouverture	y = 620,34
Profondeur du filet	86,12
Cage gauche	de x = 112,54 à x = 198,66
Cage droite	de x = 1720,19 à x = 1806,32
Rayon d’arrondi des poteaux	environ 8,04
Surépaisseur côté bouche	environ 2,30
Rayon total côté bouche	environ 10,33

Chaque cage comprend deux poteaux reliés par une barre transversale, ainsi qu’un filet au fond, sur les côtés et au-dessus. L’entrée reste ouverte. La partie arrondie des poteaux côté bouche affleure la limite du mur sans la dépasser.

Contour et marquages

Le contour suit les limites du terrain, ses quatre arrondis et les renfoncements des cages. Son épaisseur est de 1,15 pixel, correspondant au trait de 1 pixel du gabarit initial. Le trait est entièrement tracé vers l’intérieur : son bord extérieur correspond exactement à la hitbox du mur.

Une ligne de but traverse chaque ouverture dans le prolongement du mur, à x = 198,66 et x = 1720,19. Ces lignes sont uniquement des marquages au sol et ne ferment pas les entrées.

Place la ligne médiane à x = 959,43, le cercle central autour de (959,43 ; 521,64) et les surfaces de réparation symétriquement devant les cages.

Arène

L’arène entoure le terrain et les cages dans l’espace extérieur au contour. Les tribunes suivent leur forme sur les quatre côtés et peuvent se développer sur plusieurs niveaux, sans empiéter sur le terrain ni masquer les buts.

Conserve exactement ces dimensions, ces positions et ce cadrage pour toutes les variantes. Ne recadre pas et ne redimensionne pas le terrain pour faire davantage de place à l’arène.`;
