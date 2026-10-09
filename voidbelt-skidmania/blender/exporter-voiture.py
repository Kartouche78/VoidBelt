"""Exporte la Koenigsegg en GLB pour le jeu.

blender -b <Koenigsegg.blend> -P exporter-voiture.py -- <sortie.glb>

A l'echelle reelle (4,3 m), l'avant vers +Z de three.js (-Y de Blender),
les roues posees a y = 0, chaque roue en objet separe (FL, FR, RL, RR) avec
son origine sur l'axe, pour que le jeu puisse les faire tourner et braquer.
"""
import bpy
import sys
from mathutils import Matrix, Vector

out = sys.argv[sys.argv.index("--") + 1]
LENGTH = 4.3
WHEELS = ("FL", "FR", "RL", "RR")

for o in list(bpy.data.objects):
    if o.type != "MESH":
        bpy.data.objects.remove(o)

meshes = [o for o in bpy.data.objects if o.type == "MESH"]
for o in meshes:
    W = o.matrix_world.copy()
    o.parent = None
    o.matrix_world = W
for o in meshes:
    o.data = o.data.copy()
    o.data.transform(o.matrix_world)
    o.matrix_world = Matrix.Identity(4)

# Quelques sommets parasites trainent loin sur le cote de la carrosserie.
body = bpy.data.objects["Body"]
import bmesh
bm = bmesh.new()
bm.from_mesh(body.data)
stray = [v for v in bm.verts if v.co.x > 10.0 or v.co.x < -10.0]
bmesh.ops.delete(bm, geom=stray, context="VERTS")
bm.to_mesh(body.data)
bm.free()
print("sommets parasites retires :", len(stray))

pts = [v.co for o in meshes for v in o.data.vertices]
lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
k = LENGTH / (hi.y - lo.y)
off = Vector((-(lo.x + hi.x) / 2, -(lo.y + hi.y) / 2, -lo.z))
M = Matrix.Scale(k, 4) @ Matrix.Translation(off)
for o in meshes:
    o.data.transform(M)
print("echelle", round(k, 4), "taille", [round((hi[i] - lo[i]) * k, 2) for i in range(3)])

for name in WHEELS:
    w = bpy.data.objects[name]
    vs = [v.co for v in w.data.vertices]
    c = Vector(((min(v.x for v in vs) + max(v.x for v in vs)) / 2,
                (min(v.y for v in vs) + max(v.y for v in vs)) / 2,
                (min(v.z for v in vs) + max(v.z for v in vs)) / 2))
    w.data.transform(Matrix.Translation(-c))
    w.location = c
    print("roue", name, [round(x, 3) for x in c])

bpy.ops.object.select_all(action="DESELECT")
for o in meshes:
    o.select_set(True)
bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", use_selection=True,
                          export_yup=True, export_apply=True)
print("ecrit", out)
