"""Fait la planche des panneaux de virage a partir du GIF anime.

python planche-fleche.py

Un GIF ne s'anime pas comme texture dans three.js : on range une image sur
deux du GIF dans une grille (`COLS` x `COLS`), que `panneaux.js` fait
defiler. Le GIF a un fond uni (pas de transparence) : ce fond devient
transparent dans la planche, avec un bord adouci, pour qu'on ne voie que
la fleche. Si la grille ou la cadence changent, reporter les valeurs en haut
de panneaux.js (IMAGES, COLONNES, CADENCE).
"""
import os

from PIL import Image

ICI = os.path.dirname(os.path.abspath(__file__))
CIRCUIT = os.path.join(ICI, "..", "..", "public", "skidmania", "assets", "Circuit")
SOURCE = os.path.join(CIRCUIT, "virage_fleche.gif")
SORTIE = os.path.join(CIRCUIT, "virage_fleche.webp")
COLS = 5
TAILLE = 256
PAS = 2
# Fond du GIF, et ecarts de couleur entre lesquels on passe du transparent
# a l'opaque.
FOND = (20, 24, 32)
TRANSPARENT, OPAQUE = 14.0, 48.0


def detourer(img):
    """Le fond devient transparent, selon l'ecart de couleur au fond."""
    rgba = img.convert("RGBA")
    px = rgba.load()
    for y in range(rgba.height):
        for x in range(rgba.width):
            r, g, b, _ = px[x, y]
            d = ((r - FOND[0]) ** 2 + (g - FOND[1]) ** 2 + (b - FOND[2]) ** 2) ** 0.5
            a = min(1.0, max(0.0, (d - TRANSPARENT) / (OPAQUE - TRANSPARENT)))
            px[x, y] = (r, g, b, round(a * 255))
    return rgba

gif = Image.open(SOURCE)
images = list(range(0, gif.n_frames, PAS))[: COLS * COLS]
planche = Image.new("RGBA", (COLS * TAILLE, COLS * TAILLE), (0, 0, 0, 0))
for k, i in enumerate(images):
    gif.seek(i)
    img = detourer(gif.convert("RGB")).resize((TAILLE, TAILLE), Image.LANCZOS)
    planche.paste(img, ((k % COLS) * TAILLE, (k // COLS) * TAILLE))
planche.save(SORTIE, quality=90, method=6)
duree = gif.info.get("duration", 40) * PAS
print(f"{SORTIE} : {len(images)} images, {duree} ms chacune, {os.path.getsize(SORTIE) // 1024} Ko")
