"""Small lofting helpers for building stylised game characters in Blender.

Limbs are separate tapered tubes that simply overlap at the joints. For a
character seen at 3-8m on a phone this reads identically to a welded body and
avoids the blobby joins the Skin modifier produces.
"""
import bmesh
import bpy
import math
from mathutils import Vector, Matrix


def _ring(bm, centre, rx, ry, seg, basis=None, squash_front=1.0):
    verts = []
    for i in range(seg):
        a = (i / seg) * math.tau
        x, y = math.sin(a) * rx, -math.cos(a) * ry
        if y < 0:
            y *= squash_front
        p = Vector((x, y, 0.0))
        if basis is not None:
            p = basis @ p
        verts.append(bm.verts.new(centre + p))
    return verts


def _bridge(bm, a, b):
    n = len(a)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((a[i], a[j], b[j], b[i]))


def _cap(bm, ring, up=True):
    f = bm.faces.new(ring if up else list(reversed(ring)))
    return f


def loft(name, sections, seg=16, cap_start=True, cap_end=True, squash_front=1.0):
    """sections: [(Vector centre, rx, ry), ...] bridged in order."""
    me = bpy.data.meshes.new(name)
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    bm = bmesh.new()
    rings = []
    for centre, rx, ry in sections:
        rings.append(_ring(bm, Vector(centre), rx, ry, seg, squash_front=squash_front))
    for a, b in zip(rings, rings[1:]):
        _bridge(bm, a, b)
    if cap_start:
        _cap(bm, rings[0], up=False)
    if cap_end:
        _cap(bm, rings[-1], up=True)
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    return ob


def tube(name, points, radii, seg=12, cap=True):
    """Tapered tube through a polyline, rings oriented to the local direction."""
    me = bpy.data.meshes.new(name)
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    bm = bmesh.new()
    pts = [Vector(p) for p in points]
    rings = []
    for i, p in enumerate(pts):
        if i == 0:
            d = (pts[1] - pts[0])
        elif i == len(pts) - 1:
            d = (pts[-1] - pts[-2])
        else:
            d = (pts[i + 1] - pts[i - 1])
        d.normalize()
        basis = d.to_track_quat('Z', 'Y').to_matrix()
        r = radii[i]
        rx, ry = (r, r) if not isinstance(r, (tuple, list)) else r
        rings.append(_ring(bm, p, rx, ry, seg, basis=basis))
    for a, b in zip(rings, rings[1:]):
        _bridge(bm, a, b)
    if cap:
        _cap(bm, rings[0], up=False)
        _cap(bm, rings[-1], up=True)
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    return ob


def sphere(name, radius=1.0, seg=20, rings=14):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=rings, radius=radius)
    ob = bpy.context.active_object
    ob.name = name
    return ob


def box(name, size, location=(0, 0, 0), rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1)
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = size
    ob.rotation_euler = rotation
    ob.location = location
    bpy.ops.object.transform_apply(scale=True, rotation=True, location=True)
    return ob


def deform(ob, fn):
    """Apply fn(Vector) -> Vector to every vertex in object space."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    for v in bm.verts:
        v.co = fn(v.co)
    bm.normal_update()
    bm.to_mesh(ob.data)
    bm.free()


def smooth(ob, levels=1):
    bpy.context.view_layer.objects.active = ob
    if levels:
        m = ob.modifiers.new("Subsurf", 'SUBSURF')
        m.levels = m.render_levels = levels
        bpy.ops.object.modifier_apply(modifier="Subsurf")
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.shade_smooth()


def join(name, objs):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    ob = bpy.context.active_object
    ob.name = name
    return ob


def mirror_x(ob):
    """Duplicate across X, for building one side then mirroring."""
    dup = ob.copy()
    dup.data = ob.data.copy()
    bpy.context.collection.objects.link(dup)
    dup.scale.x = -1
    bpy.context.view_layer.objects.active = dup
    bpy.ops.object.select_all(action='DESELECT')
    dup.select_set(True)
    bpy.ops.object.transform_apply(scale=True)
    bpy.ops.object.editmode_toggle()
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.flip_normals()
    bpy.ops.object.editmode_toggle()
    return dup
