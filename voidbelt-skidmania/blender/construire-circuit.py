"""Construit le circuit de Skid Mania a partir du kit route.blend.

blender -b route.blend -P construire-circuit.py -- <piste.json> <sortie.glb>

Le .blend est la source : rien n'y est nomme en dur, on peut le retoucher
librement et le serveur reconstruit le circuit a l'enregistrement.

- Tout mesh qui porte un modificateur Curve est un module (bitume, vibreur,
  muret...) : sa tranche, Miroir et Solidify compris, est recopiee et
  deformee le long des reperes ecrits par `cargo run --bin piste`. On ne se
  sert pas du Curve lui-meme : sa torsion ne tomberait pas exactement sur
  les reperes de la physique ; la route vue est celle ou la voiture roule.
- Le module nomme ROUTE (ou dont un materiau commence par BITUME) est la
  route. Le jeu donne la face interieure des murs (`half_width`, 10 m) ; le
  bitume s'etire juste assez pour que le muret du kit y tombe, vibreurs et
  murets gardent leur largeur et glissent d'autant vers l'exterieur.
- Textures : un module qui a ses UV (le vibreur) les garde, repetees a
  chaque tranche comme le ferait l'Array. Un module sans UV (la route) en
  recoit en metres, une tuile tous les `TUILE` m. Les images sont lues dans
  `textures/` a cote du .blend quand elles s'y trouvent : le circuit ne
  depend pas du dossier d'ou elles ont ete importees.
- Les trous du trace (`trous` dans le JSON) restent vides : ni route, ni
  muret, ni pilier. La voiture y vole.
- Tout autre objet visible (deco, arche, panneaux) est pose tel quel au
  depart : l'origine du .blend tombe sur la ligne de depart, +X dans le sens
  de la course, +Y a gauche, Z en haut.
"""
import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

args = sys.argv[sys.argv.index("--") + 1:]
data = json.load(open(args[0]))
out = args[1]

STEP = data["step"]
# Face interieure des murs, depuis le centre (m) : le kit est pose pour que
# ses murets tombent la. La largeur du bitume s'en deduit.
MUR = data["half_width"]
START = data.get("start", 0.0)
# Trous du trace (debut, fin) : ni route, ni muret, ni pilier au-dessus.
TROUS = data.get("trous", [])


def dans_trou(s0, s1):
    return any(s1 > a and s0 < b for a, b in TROUS)
MODULE = 2.0
# Taille d'une tuile de texture sur un module sans UV, en metres.
TUILE = 2.5


def blender(v):
    """three.js (y en haut) vers Blender (z en haut) ; l'export glTF refera
    la conversion inverse."""
    return Vector((v[0], -v[2], v[1]))


FR = [(blender(f[0:3]), blender(f[3:6]), blender(f[6:9])) for f in data["frames"]]
LENGTH = (len(FR) - 1) * STEP


def frame_at(s):
    x = max(0.0, min(s / STEP, len(FR) - 1.0001))
    i = int(x)
    k = x - i
    a, b = FR[i], FR[i + 1]
    return tuple(a[j].lerp(b[j], k) for j in range(3))


def is_module(o):
    return o.type == "MESH" and any(m.type == "CURVE" for m in o.modifiers)


def is_road(o):
    return "ROUTE" in o.name.upper() or any(
        s.material and s.material.name.startswith("BITUME") for s in o.material_slots)


def module_slice(obj):
    """La tranche de 2 m du module, Miroir et Solidify compris, sans Array
    ni Curve, et simplifiee : les faces coplanaires d'un meme materiau sont
    fondues."""
    for m in obj.modifiers:
        if m.type in ("ARRAY", "CURVE"):
            m.show_viewport = False
    dg = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(dg)
    bm = bmesh.new()
    bm.from_mesh(ev.to_mesh())
    ev.to_mesh_clear()
    uv = bm.loops.layers.uv.active
    bmesh.ops.dissolve_limit(bm, angle_limit=0.001, verts=bm.verts[:], edges=bm.edges[:],
                             delimit={"MATERIAL", "UV"} if uv else {"MATERIAL"})
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bm.verts.index_update()
    verts = [v.co.copy() for v in bm.verts]
    # UV par coin de face, quand le module en a
    faces = [([v.index for v in f.verts], f.material_index,
              [l[uv].uv.copy() for l in f.loops] if uv else None) for f in bm.faces]
    bm.free()
    return verts, faces


def _normal(verts, idx):
    a, b, c = (verts[i] for i in idx[:3])
    return (b - a).cross(c - a).normalized()


SLICES = {o.name: module_slice(o) for o in bpy.data.objects if is_module(o)}
ROADS = [o for o in bpy.data.objects if is_module(o) and is_road(o)]
if not ROADS:
    raise SystemExit("route.blend : aucun module avec un materiau BITUME")
# Demi-largeur du bitume dans le kit, mesuree plutot que supposee.
KIT_HW = max(abs(v.y) for v in SLICES[ROADS[0].name][0])
# Le muret du kit : le module qui va le plus loin du centre. Sa face
# interieure est son point le plus proche du centre.
_MURET = max(SLICES.values(), key=lambda sl: max(abs(v.y) for v in sl[0]))
KIT_MUR = min(abs(v.y) for v in _MURET[0])
# Vibreurs et murets gardent leur largeur : seul le bitume s'etire, juste
# assez pour que la face interieure du muret tombe sur MUR.
HW = MUR - (KIT_MUR - KIT_HW)
print("kit : bitume %.2f, muret a %.2f -> bitume %.2f, muret a %.2f" % (KIT_HW, KIT_MUR, HW, MUR))


def widen(y, road):
    """Le bitume s'etire, le reste glisse vers l'exterieur."""
    if road:
        return y * HW / KIT_HW
    return y + math.copysign(HW - KIT_HW, y)


def sweep(src):
    verts, faces = SLICES[src.name]
    road = src in ROADS
    kit_uv = faces and faces[0][2] is not None
    # Un module a motif (UV a lui, ou plusieurs materiaux en long) garde
    # son pas ; un module uni s'etire sur 4 m sans que ca se voie.
    stretch = 1.0 if kit_uv or (not road and len(src.material_slots) > 1) else 2.0
    piece = MODULE * stretch
    if not road:
        # posees sur la dalle, leurs faces du dessous ne se voient jamais
        faces = [f for f in faces if _normal(verts, f[0]).z > -0.5]
    n = int(LENGTH // piece)
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    for k in range(n):
        s0 = k * piece
        if dans_trou(s0, s0 + piece):
            continue
        vs = []
        for co in verts:
            s = s0 + co.x * stretch
            p, r, u = frame_at(s)
            lat = widen(co.y, road)
            # +y du kit = gauche ; r = droite de la route
            vs.append((bm.verts.new(p - r * lat + u * co.z), lat, s))
        for idx, mat, kuv in faces:
            try:
                f = bm.faces.new([vs[i][0] for i in idx])
            except ValueError:
                continue
            f.material_index = mat
            f.smooth = True
            for c, (loop, i) in enumerate(zip(f.loops, idx)):
                loop[uv].uv = kuv[c] if kuv else (vs[i][1] / TUILE, vs[i][2] / TUILE)
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=0.002)
    me = bpy.data.meshes.new(src.name)
    bm.to_mesh(me)
    bm.free()
    for slot in src.material_slots:
        me.materials.append(slot.material)
    ob = bpy.data.objects.new(src.name.split(" - ")[0], me)
    bpy.context.scene.collection.objects.link(ob)
    print("module", src.name, len(me.vertices), "sommets")
    return ob


def start_matrix():
    """Repere du kit pose sur la ligne de depart."""
    p, r, u = frame_at(START)
    fwd = u.cross(r).normalized()
    left = -r
    m = Matrix.Identity(4)
    for i in range(3):
        m[i][0], m[i][1], m[i][2], m[i][3] = fwd[i], left[i], u[i], p[i]
    return m


def place_at_start(objs):
    """Les objets qui ne suivent pas la piste, poses au depart. Leurs
    modificateurs sont appliques par l'export."""
    m = start_matrix()
    for o in objs:
        if o.parent is None:
            o.matrix_world = m @ o.matrix_world
        print("decor", o.name)
    return objs


def pillars(mat):
    """Piliers de beton sous la route, la ou elle est a l'endroit et ou rien
    ne passe en dessous."""
    bm = bmesh.new()
    pts = [f[0] for f in FR]
    s = 60.0
    count = 0
    while s < LENGTH - 20:
        p, r, u = frame_at(s)
        s += 55.0
        if u.z < 0.97 or dans_trou(s - 55.0 - 3.0, s - 55.0 + 3.0):
            continue
        top = p - u * 0.3
        below = any(
            q.z < top.z - 3 and math.hypot(q.x - top.x, q.y - top.y) < 16
            for q in pts[::2]
        )
        if below:
            continue
        geom = bmesh.ops.create_cube(bm, size=1.0)["verts"]
        h = top.z
        for v in geom:
            v.co = Vector((top.x + v.co.x * 2.2, top.y + v.co.y * 2.2, (v.co.z + 0.5) * h))
        count += 1
    me = bpy.data.meshes.new("Piliers")
    bm.to_mesh(me)
    bm.free()
    if mat:
        me.materials.append(mat)
    ob = bpy.data.objects.new("Piliers", me)
    bpy.context.scene.collection.objects.link(ob)
    print("piliers", count)
    return ob


def decor_objects():
    """Ce qui se voit dans le .blend sans etre un module : ni la courbe que
    suivent les modules, ni les vides, cameras et lumieres."""
    traces = {m.object for o in bpy.data.objects for m in o.modifiers
              if m.type == "CURVE" and m.object}
    keep = {"MESH", "CURVE", "SURFACE", "FONT", "META"}
    return [o for o in bpy.data.objects
            if o.type in keep and not is_module(o) and o not in traces
            and not o.hide_render and not o.hide_get()]


def concrete():
    """Materiau des piliers : le beton de la dalle s'il existe encore."""
    for s in ROADS[0].material_slots:
        if s.material and not s.material.name.startswith("BITUME"):
            return s.material
    return bpy.data.materials.get("Bord de dalle beton")


def local_images():
    """Pointe chaque image sur sa copie de `textures/`, si elle existe."""
    dossier = os.path.join(os.path.dirname(bpy.data.filepath), "textures")
    for img in bpy.data.images:
        if not img.filepath:
            continue
        nom = os.path.basename(bpy.path.abspath(img.filepath).replace("\\", "/"))
        local = os.path.join(dossier, nom)
        if os.path.isfile(local):
            img.filepath = local
            img.reload()
        print("image", img.name, "->", img.filepath, tuple(img.size))


local_images()
modules = [o for o in bpy.data.objects if is_module(o)]
decor = place_at_start(decor_objects())
made = [sweep(o) for o in modules]
made.append(pillars(concrete()))
made += decor

for o in list(bpy.data.objects):
    if o not in made and not any(o in d.children_recursive for d in decor):
        bpy.data.objects.remove(o)

bpy.ops.object.select_all(action="DESELECT")
for o in made:
    o.select_set(True)
    for c in o.children_recursive:
        c.select_set(True)
bpy.context.view_layer.objects.active = made[0]
swept = [o for o in made[:len(modules) + 1]]
with bpy.context.temp_override(selected_editable_objects=swept, selected_objects=swept):
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(35))
# Textures en JPEG : Cloudflare Pages refuse les fichiers de plus de 25 Mio,
# et la carte de relief convertie de l'EXR pesait a elle seule 4,8 Mo en PNG.
bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", use_selection=True,
                          export_yup=True, export_apply=True,
                          export_image_format="JPEG", export_image_quality=88)
print("ecrit", out)
