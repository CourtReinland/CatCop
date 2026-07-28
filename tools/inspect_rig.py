"""Dump the Kenney rig's rest pose so the new body can be built around it."""
import bpy, sys, json, os

argv = sys.argv[sys.argv.index("--") + 1:]
fbx_path = argv[0]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=fbx_path)

arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
meshes = [o for o in bpy.data.objects if o.type == 'MESH']

# Bone rest positions in ARMATURE space.
bones = {}
for b in arm.data.bones:
    bones[b.name] = {
        "head": [round(v, 4) for v in b.head_local],
        "tail": [round(v, 4) for v in b.tail_local],
        "parent": b.parent.name if b.parent else None,
    }

info = {
    "armature": {"name": arm.name, "scale": list(arm.scale), "matrix": [list(r) for r in arm.matrix_world]},
    "meshes": [{"name": m.name, "verts": len(m.data.vertices), "polys": len(m.data.polygons),
                "dims": [round(v, 3) for v in m.dimensions]} for m in meshes],
    "bone_count": len(bones),
    "bones": bones,
}
out = argv[1]
with open(out, "w") as f:
    json.dump(info, f, indent=1)
print("WROTE", out)
