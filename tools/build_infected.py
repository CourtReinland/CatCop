"""Build the CatCop "infected" character.

The shipped Kenney `characterMedium` rig is 3.7 heads tall — chibi proportions
baked into the skeleton, which is why the in-game bodies read as blobs no matter
how the mesh is detailed. Both animation clips turned out to be purely
rotational (every deform bone's location track is a constant zero), so the rest
pose can be re-proportioned to a fashion-model 8-head figure and the run/idle
cycles still play correctly.

This script:
  1. imports the original rig,
  2. re-proportions the skeleton to ~8 heads,
  3. builds a new body + tuxedo + hair mesh around it,
  4. binds with automatic weights,
  5. imports the Run/Idle clips onto the new rig,
  6. exports a single GLB containing mesh, skeleton and both clips.

Run headless:
  blender --background --factory-startup --python tools/build_infected.py -- \
      <src_dir> <out.glb> [--preview out.png]
"""
import bpy
import bmesh
import math
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mathutils import Vector

# --- Proportions -------------------------------------------------------------
# All heights are fractions of total figure height H, in the rig's Z-up space.
H = 3.70

L = {
    "ground":    0.000,
    "toe":       0.018,
    "ankle":     0.046,
    "knee":      0.270,
    "hip":       0.492,
    "waist":     0.575,
    "chest":     0.660,
    "upperchest": 0.722,
    "shoulder":  0.805,
    "neck":      0.822,
    "headbase":  0.866,   # base of skull
    "crown":     1.000,
}
z = {k: v * H for k, v in L.items()}

# Widths (half-widths, in rig units)
# Half-widths / segment lengths in rig units, from standard figure ratios:
# biacromial breadth ~0.245H, arm span ~1.0H, upper arm 0.174H, forearm 0.146H.
W = {
    "hip_joint":   0.195,
    "shoulder_joint": 0.330,   # deltoid centre; +radius lands the acromion at 0.245H/2
    "upperarm":    0.640,
    "forearm":     0.500,
    "hand":        0.300,
}
R = {                       # radii
    "hip":      0.285, "hip_d":   0.180,
    "waist":    0.250, "waist_d": 0.162,
    "chest":    0.330, "chest_d": 0.205,
    "uchest":   0.360, "uchest_d": 0.215,
    "shoulder": 0.300, "shoulder_d": 0.215,
    "thigh":    0.170, "knee":    0.120, "calf": 0.130, "ankle": 0.072,
    "deltoid":  0.125, "elbow":   0.090, "wrist": 0.058,
    "neck":     0.115,
}


def log(*a):
    print("[build]", *a, flush=True)


# --- 1. Re-proportion the skeleton ------------------------------------------
def reproportion(arm_obj):
    """Rewrite the rest pose to an 8-head figure.

    Chains are handled individually: a naive global Z remap would drag the
    T-posed arms up to neck height, since they sit at chest Z in the source.
    """
    bpy.context.view_layer.objects.active = arm_obj
    bpy.ops.object.mode_set(mode='EDIT')
    eb = arm_obj.data.edit_bones

    # A bone's roll defines its local axes, and the clips' rotation curves are
    # expressed in that local space. Moving head/tail makes Blender recompute
    # roll, which silently re-interprets every keyframe — the arms stop coming
    # down out of the T-pose. Capture the rolls and restore them afterwards.
    original_rolls = {b.name: b.roll for b in eb}

    def get(n):
        return eb.get(n)

    # --- spine chain: set explicit joint heights, keep X/Y
    spine_chain = [
        ("Hips", z["hip"]),
        ("Spine", z["waist"]),
        ("Chest", z["chest"]),
        ("UpperChest", z["upperchest"]),
        ("Neck", z["neck"]),
        ("Head", z["headbase"]),
    ]
    for name, nz in spine_chain:
        b = get(name)
        if b:
            b.head = Vector((b.head.x, b.head.y, nz))
    # tails follow the next joint up
    for i, (name, _) in enumerate(spine_chain):
        b = get(name)
        if not b:
            continue
        if i + 1 < len(spine_chain):
            nxt = get(spine_chain[i + 1][0])
            if nxt:
                b.tail = Vector((nxt.head.x, nxt.head.y, nxt.head.z))
    head = get("Head")
    head_end = get("Head_end")
    if head:
        head.tail = Vector((head.head.x, head.head.y, z["crown"]))
    if head_end:
        head_end.head = Vector((head.tail.x, head.tail.y, head.tail.z))
        head_end.tail = Vector((head.tail.x, head.tail.y, head.tail.z + 0.25))

    # --- legs
    for side, sx in (("Left", 1), ("Right", -1)):
        up = get(f"{side}UpLeg")
        lo = get(f"{side}Leg")
        ft = get(f"{side}Foot")
        to = get(f"{side}Toes")
        te = get(f"{side}Toes_end")
        if not all([up, lo, ft]):
            continue
        hipx = sx * W["hip_joint"]
        up.head = Vector((hipx, 0.0, z["hip"]))
        up.tail = Vector((hipx * 1.05, 0.01, z["knee"]))
        lo.head = up.tail.copy()
        lo.tail = Vector((hipx * 1.08, 0.03, z["ankle"]))
        ft.head = lo.tail.copy()
        ft.tail = Vector((hipx * 1.08, -0.16, z["toe"]))
        if to:
            to.head = ft.tail.copy()
            to.tail = Vector((hipx * 1.08, -0.34, z["toe"] * 0.7))
        if te:
            te.head = to.tail.copy() if to else ft.tail.copy()
            te.tail = te.head + Vector((0, -0.12, 0))

    # --- arms: laid out along X in the T-pose, at shoulder height
    for side, sx in (("Left", 1), ("Right", -1)):
        sh = get(f"{side}Shoulder")
        ua = get(f"{side}Arm")
        fa = get(f"{side}ForeArm")
        hd = get(f"{side}Hand")
        if not all([sh, ua, fa, hd]):
            continue
        sy = 0.01
        sh.head = Vector((sx * 0.075, sy, z["shoulder"] + 0.03))
        sh.tail = Vector((sx * W["shoulder_joint"], sy, z["shoulder"]))
        ua.head = sh.tail.copy()
        ua.tail = Vector((sx * (W["shoulder_joint"] + W["upperarm"]), sy, z["shoulder"] - 0.03))
        fa.head = ua.tail.copy()
        fa.tail = Vector((sx * (W["shoulder_joint"] + W["upperarm"] + W["forearm"]), sy, z["shoulder"] - 0.06))
        hd.head = fa.tail.copy()
        hd.tail = Vector((sx * (W["shoulder_joint"] + W["upperarm"] + W["forearm"] + W["hand"] * 0.35),
                          sy, z["shoulder"] - 0.07))

        # fingers/thumbs trail off the hand so auto-weights stay sane
        wrist = hd.head
        span = W["hand"]
        for fname, off, length in (
            (f"{side}HandIndex1", 0.05, span * 0.30),
            (f"{side}HandThumb1", -0.06, span * 0.22),
        ):
            chain = [b for b in eb if b.name.startswith(fname[:-1])]
            chain.sort(key=lambda b: b.name)
            cursor = Vector((wrist.x + sx * span * 0.32, wrist.y + off, wrist.z))
            for seg in chain:
                seg.head = cursor.copy()
                cursor = cursor + Vector((sx * length, 0, 0))
                seg.tail = cursor.copy()

    # --- IK / control bones: park them on their targets so nothing looks broken
    for side, sx in (("Left", 1), ("Right", -1)):
        ft = get(f"{side}Foot")
        kn = get(f"{side}Leg")
        for nm, ref in ((f"{side}FootCtrl", ft), (f"{side}FootIK", ft),
                        (f"{side}FootRollCtrl", ft), (f"{side}HeelRoll", ft),
                        (f"{side}ToeRoll", ft), (f"{side}KneeCtrl", kn)):
            b = get(nm)
            if b and ref:
                d = b.tail - b.head
                b.head = ref.head.copy()
                b.tail = b.head + (d if d.length > 1e-5 else Vector((0, 0, 0.1)))
        for nm in (f"{side}KneeCtrl_end", f"{side}FootRollCtrl_end", f"{side}FootIK_end"):
            b = get(nm)
            par = get(nm.replace("_end", ""))
            if b and par:
                b.head = par.tail.copy()
                b.tail = b.head + Vector((0, 0, 0.08))
    hipsctrl = get("HipsCtrl")
    hips = get("Hips")
    if hipsctrl and hips:
        hipsctrl.head = Vector((0, 0, z["hip"]))
        hipsctrl.tail = Vector((0, 0, z["hip"] + 0.12))

    restored = 0
    for name, roll in original_rolls.items():
        b = get(name)
        if b is not None and abs(b.roll - roll) > 1e-6:
            b.roll = roll
            restored += 1

    bpy.ops.object.mode_set(mode='OBJECT')
    log(f"re-proportioned: crown={z['crown']:.2f} head_len={z['crown']-z['headbase']:.2f} "
        f"heads={H/(z['crown']-z['headbase']):.2f}, {restored} bone rolls restored")


def clear_pose(arm):
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='POSE')
    bpy.ops.pose.select_all(action='SELECT')
    bpy.ops.pose.transforms_clear()
    bpy.ops.object.mode_set(mode='OBJECT')
    arm.data.pose_position = 'REST'
    bpy.context.view_layer.update()
    log("pose cleared to rest")


# --- 2. Body, suit and head --------------------------------------------------
import meshlib as ml   # noqa: E402


PART_BONE = {
    "hair": "Head",
    "shirt": "UpperChest",
    "lapel": "UpperChest",
    "shoeL": "LeftFoot",
    "shoeR": "RightFoot",
}


def tag_part(ob, tag):
    """Stamp every vertex with a marker group; survives the join."""
    vg = ob.vertex_groups.new(name=f"__part_{tag}")
    vg.add([v.index for v in ob.data.vertices], 1.0, 'REPLACE')
    return ob


def build_character():
    """Lean male in a torn tuxedo, built from lofted tubes and rings.

    Returns (skin_parts, cloth_parts) so the legs render as trousers rather than
    bare skin.
    """
    parts = []
    cloth = []
    hip, waist = z["hip"], z["waist"]
    chest, uch = z["chest"], z["upperchest"]
    shoulder, neck = z["shoulder"], z["neck"]
    headb, crown = z["headbase"], z["crown"]
    head_len = crown - headb

    # --- torso: wide shoulders, narrow waist, flat front-to-back
    torso = ml.loft("Torso", [
        ((0, 0.00, hip - 0.16), R["hip"] * 0.86, R["hip_d"] * 0.90),
        ((0, 0.00, hip + 0.04), R["hip"], R["hip_d"]),
        ((0, 0.01, waist), R["waist"], R["waist_d"]),
        ((0, 0.01, waist + 0.16), R["waist"] * 1.10, R["waist_d"] * 1.08),
        ((0, 0.01, chest), R["chest"], R["chest_d"]),
        ((0, 0.01, uch), R["uchest"], R["uchest_d"]),
        ((0, 0.01, shoulder - 0.02), R["shoulder"], R["shoulder_d"]),
        ((0, 0.01, shoulder + 0.07), R["shoulder"] * 0.55, R["shoulder_d"] * 0.72),
    ], seg=20)
    parts.append(torso)

    parts.append(ml.tube("Neck", [(0, 0.005, neck - 0.13), (0, -0.010, headb + 0.05)],
                         [R["neck"] * 1.25, R["neck"] * 0.92], seg=14))

    # --- head: tall cranium, tapered jaw, no beak
    head = ml.sphere("Head", 1.0, seg=24, rings=16)

    def head_shape(v):
        t = (v.z + 1) * 0.5                       # 0 chin .. 1 crown
        taper = 0.74 + 0.26 * min(1.0, t * 1.9)   # jaw narrower than cranium
        v = v.copy()
        v.x *= taper
        v.y *= taper
        if t < 0.30:                              # soften the jaw to a rounded chin
            k = (0.30 - t) / 0.30
            v.x *= 1 - 0.22 * k
            v.y *= 1 - 0.08 * k
        return v
    ml.deform(head, head_shape)
    head.scale = (head_len * 0.335, head_len * 0.385, head_len * 0.505)
    head.location = (0, -0.015, headb + head_len * 0.505)
    bpy.ops.object.transform_apply(scale=True, location=True)
    parts.append(head)

    # --- hair: cap plus swept spikes
    cap = ml.sphere("HairCap", 1.0, seg=22, rings=14)
    ml.deform(cap, lambda v: v)
    bm_keep = []
    import bmesh as _bm
    b = _bm.new()
    b.from_mesh(cap.data)
    for v in list(b.verts):
        if v.co.z < -0.30:
            b.verts.remove(v)
    b.to_mesh(cap.data)
    b.free()
    cap.scale = (head_len * 0.362, head_len * 0.408, head_len * 0.40)
    cap.location = (0, -0.020, headb + head_len * 0.625)
    bpy.ops.object.transform_apply(scale=True, location=True)
    hair = [cap]
    for (ax, ay, az, rot, ln, rad) in [
        (0.00, 0.16, 0.90, (0.95, 0, 0.00), 1.35, 0.115),
        (-0.16, 0.13, 0.86, (0.80, 0, 0.35), 1.20, 0.100),
        (0.17, 0.12, 0.84, (0.75, 0, -0.40), 1.15, 0.098),
        (-0.28, 0.02, 0.74, (0.30, 0, 0.75), 1.05, 0.090),
        (0.29, 0.01, 0.72, (0.28, 0, -0.80), 1.00, 0.088),
        (-0.22, -0.14, 0.66, (-0.55, 0, 0.55), 0.95, 0.082),
        (0.23, -0.15, 0.64, (-0.60, 0, -0.55), 0.92, 0.080),
        (0.00, -0.20, 0.70, (-0.85, 0, 0.05), 1.00, 0.090),
    ]:
        bpy.ops.mesh.primitive_cone_add(vertices=8, radius1=head_len * rad,
                                        radius2=head_len * 0.012,
                                        depth=head_len * 0.52 * ln)
        s = bpy.context.active_object
        s.rotation_euler = rot
        s.location = (ax * head_len, ay * head_len - 0.012, headb + head_len * az)
        bpy.ops.object.transform_apply(rotation=True, location=True)
        hair.append(s)
    hair_ob = ml.join("Hair", hair)
    tag_part(hair_ob, "hair")
    parts.append(hair_ob)

    sj, ua, fa, hl = (W["shoulder_joint"], W["upperarm"], W["forearm"], W["hand"])
    for sx in (1, -1):
        # --- arm: deltoid -> elbow -> wrist, properly tapered
        arm = ml.tube(f"Arm{sx}", [
            (sx * sj * 0.72, 0.01, shoulder + 0.015),
            (sx * (sj + ua * 0.5), 0.01, shoulder - 0.012),
            (sx * (sj + ua), 0.01, shoulder - 0.030),
            (sx * (sj + ua + fa * 0.55), 0.012, shoulder - 0.046),
            (sx * (sj + ua + fa), 0.012, shoulder - 0.060),
        ], [R["deltoid"], R["elbow"] * 1.12, R["elbow"], R["wrist"] * 1.18, R["wrist"]], seg=12)
        parts.append(arm)
        # hand: flattened mitt
        hand = ml.sphere(f"Hand{sx}", 1.0, seg=12, rings=8)
        hand.scale = (hl * 0.52, 0.058, 0.078)
        hand.location = (sx * (sj + ua + fa + hl * 0.40), 0.012, shoulder - 0.066)
        bpy.ops.object.transform_apply(scale=True, location=True)
        parts.append(hand)

        # --- leg: hip -> knee -> ankle
        hx = W["hip_joint"]
        leg = ml.tube(f"Leg{sx}", [
            (sx * hx, 0.005, hip + 0.02),
            (sx * hx * 1.02, 0.012, (hip + z["knee"]) * 0.5),
            (sx * hx * 1.05, 0.015, z["knee"]),
            (sx * hx * 1.06, 0.020, (z["knee"] + z["ankle"]) * 0.5),
            (sx * hx * 1.07, 0.028, z["ankle"] * 0.55),
        ], [R["thigh"], R["thigh"] * 0.82, R["knee"], R["calf"], R["ankle"]], seg=12)
        cloth.append(leg)
        # shoe
        shoe = ml.box(f"Shoe{sx}", (0.185, 0.440, 0.150),
                      (sx * hx * 1.07, -0.095, 0.075))

        parts.append(shoe)

    body = ml.join("Body", parts)
    ml.smooth(body, levels=1)
    trousers = ml.join("Trousers", cloth)
    ml.smooth(trousers, levels=1)
    return body, trousers


def build_suit():
    """Tuxedo jacket: closed shell with a V opening over the chest, plus tails."""
    hip, waist = z["hip"], z["waist"]
    chest, uch = z["chest"], z["upperchest"]
    shoulder = z["shoulder"]
    parts = []

    P = 0.028   # how far the jacket stands off the body
    jacket = ml.loft("Jacket", [
        ((0, 0.01, hip - 0.20), R["hip"] * 0.90 + P, R["hip_d"] * 0.92 + P),
        ((0, 0.01, hip + 0.02), R["hip"] * 0.97 + P, R["hip_d"] * 0.98 + P),
        ((0, 0.01, waist), R["waist"] + P, R["waist_d"] + P),
        ((0, 0.01, waist + 0.16), R["waist"] * 1.10 + P, R["waist_d"] * 1.08 + P),
        ((0, 0.01, chest), R["chest"] + P, R["chest_d"] + P),
        ((0, 0.01, uch), R["uchest"] + P, R["uchest_d"] + P),
        ((0, 0.01, shoulder - 0.01), R["shoulder"] + P * 3.4, R["shoulder_d"] + P * 1.4),
        ((0, 0.01, shoulder + 0.07), R["shoulder"] * 0.60 + P, R["shoulder_d"] * 0.78 + P),
    ], seg=20)
    parts.append(jacket)

    # Cut the chest open: delete front-facing faces between waist and collar.
    import bmesh as _bm
    b = _bm.new()
    b.from_mesh(jacket.data)
    b.faces.ensure_lookup_table()
    doomed = []
    for f in b.faces:
        c = f.calc_center_median()
        if c.y < -0.10 and waist + 0.10 < c.z < shoulder + 0.02 and abs(c.x) < 0.20:
            doomed.append(f)
    _bm.ops.delete(b, geom=doomed, context='FACES')
    b.to_mesh(jacket.data)
    b.free()

    sol = jacket.modifiers.new("Solid", 'SOLIDIFY')
    sol.thickness = 0.026
    sol.offset = 1.0
    bpy.context.view_layer.objects.active = jacket
    bpy.ops.object.modifier_apply(modifier="Solid")

    # Peaked lapels framing the opening.
    for sx in (1, -1):
        lp = tag_part(ml.box(f"Lapel{sx}", (0.078, 0.024, 0.34),
                    (sx * 0.158, -0.198, chest + 0.12),
                    (0.06, sx * 0.20, sx * 0.10)), "lapel")
        parts.append(lp)

    # Sleeves over the upper arms only — the forearms are bare and torn.
    sj, ua = W["shoulder_joint"], W["upperarm"]
    for sx in (1, -1):
        fa_ = W["forearm"]
        sl = ml.tube(f"Sleeve{sx}", [
            (sx * sj * 0.55, 0.01, shoulder + 0.038),
            (sx * (sj + ua * 0.45), 0.01, shoulder - 0.010),
            (sx * (sj + ua), 0.01, shoulder - 0.030),
            (sx * (sj + ua + fa_ * 0.60), 0.012, shoulder - 0.048),
            (sx * (sj + ua + fa_ * 0.94), 0.012, shoulder - 0.058),
        ], [R["deltoid"] * 1.26, R["elbow"] * 1.24, R["elbow"] * 1.16,
            R["wrist"] * 1.34, R["wrist"] * 1.20], seg=12, cap=False)
        parts.append(sl)

    suit = ml.join("Suit", parts)
    ml.smooth(suit, levels=1)
    return suit


def build_shirt():
    """A real shirt panel filling the open V, with collar wings and a tie.

    Without this the jacket's solidified lining shows through the opening and
    reads as a recessed armour bib.
    """
    chest, uch, waist = z["chest"], z["upperchest"], z["waist"]
    parts = []
    Q = 0.012   # just proud of the skin, well inside the jacket shell
    panel = ml.loft("ShirtPanel", [
        ((0, 0.012, waist + 0.10), R["waist"] + Q, R["waist_d"] + Q),
        ((0, 0.012, chest), R["chest"] + Q, R["chest_d"] + Q),
        ((0, 0.012, uch), R["uchest"] + Q, R["uchest_d"] + Q),
        ((0, 0.012, z["shoulder"] - 0.02), R["shoulder"] + Q, R["shoulder_d"] + Q),
    ], seg=20, cap_start=False, cap_end=False)
    # keep only the front strip
    import bmesh as _bm
    b = _bm.new()
    b.from_mesh(panel.data)
    doomed = [f for f in b.faces
              if not (f.calc_center_median().y < -0.04 and abs(f.calc_center_median().x) < 0.19)]
    _bm.ops.delete(b, geom=doomed, context='FACES')
    b.to_mesh(panel.data)
    b.free()
    parts.append(panel)

    parts.append(ml.box("Tie", (0.052, 0.018, 0.230), (0, -0.212, chest + 0.020), (0.04, 0, 0)))
    for sx in (1, -1):
        parts.append(ml.box(f"Collar{sx}", (0.062, 0.018, 0.090),
                            (sx * 0.086, -0.188, uch + 0.070),
                            (0.14, sx * 0.26, sx * 0.22)))
    return tag_part(ml.join("Shirt", parts), "shirt")


# --- Materials ---------------------------------------------------------------
def mat(name, colour, rough=0.6, metal=0.0, emit=None, emit_strength=1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*colour, 1)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if emit:
        bsdf.inputs["Emission Color"].default_value = (*emit, 1)
        bsdf.inputs["Emission Strength"].default_value = emit_strength
    return m


def main():
    argv = sys.argv[sys.argv.index("--") + 1:]
    src_dir, out_glb = argv[0], argv[1]
    preview = None
    if "--preview" in argv:
        preview = argv[argv.index("--preview") + 1]

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=f"{src_dir}/infected.fbx")
    arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    for o in [o for o in bpy.data.objects if o.type == 'MESH']:
        bpy.data.objects.remove(o, do_unlink=True)
    arm.name = "InfectedRig"

    # The source FBX ships with a pose applied (both thighs rotated ~21 degrees
    # inward, plus foot controls). Left in place it deforms the new mesh at bind
    # time and the legs converge. Clear to rest first.
    clear_pose(arm)
    reproportion(arm)

    body, trousers = build_character()
    suit = ml.join("SuitAll", [build_suit(), trousers])
    shirt = build_shirt()

    skin_m = mat("Skin", (0.72, 0.58, 0.56), rough=0.55)
    hair_m = mat("Hair", (0.03, 0.025, 0.045), rough=0.35)
    suit_m = mat("Suit", (0.035, 0.03, 0.05), rough=0.45, metal=0.15)
    shirt_m = mat("Shirt", (0.80, 0.78, 0.82), rough=0.7)
    for ob, m in ((body, skin_m), (suit, suit_m), (shirt, shirt_m)):
        ob.data.materials.append(m)
    _ = hair_m

    # Join everything into one skinned mesh.
    bpy.ops.object.select_all(action='DESELECT')
    for ob in (body, suit, shirt):
        ob.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.join()
    character = bpy.context.active_object
    character.name = "Infected"

    # Bind to the re-proportioned skeleton.
    bpy.ops.object.select_all(action='DESELECT')
    character.select_set(True)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')
    fixed, forced = weld_weights(character, arm)
    log(f"bound: {len(character.vertex_groups)} vertex groups, "
        f"{len(character.data.polygons)} polys, "
        f"{forced} verts hard-weighted, {fixed} orphans rescued")

    if preview:
        render_preview(preview, arm, character)

    # Bring the clips over onto this rig.
    arm.data.pose_position = 'POSE'
    import_clips(arm, src_dir)

    bpy.ops.object.select_all(action='DESELECT')
    character.select_set(True)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.export_scene.gltf(
        filepath=out_glb, export_format='GLB', use_selection=True,
        export_animations=True, export_skins=True, export_apply=False,
        export_yup=True,
    )
    log("wrote", out_glb)


def weld_weights(character, arm):
    """Blender's heat-based automatic weights leave loose accessory geometry
    (hair spikes, lapels, shoes) either unweighted or bound to a far-away bone,
    which flings it across the level once the clips play. Tagged parts get
    pinned to a single bone, and any remaining orphan vertex is bound to its
    nearest bone."""
    from mathutils import Vector as V
    me = character.data
    vgs = character.vertex_groups

    def ensure(name):
        return vgs.get(name) or vgs.new(name=name)

    forced = 0
    for tag, bone in PART_BONE.items():
        src = vgs.get(f"__part_{tag}")
        if not src or bone not in arm.data.bones:
            continue
        idxs = []
        for v in me.vertices:
            if any(g.group == src.index and g.weight > 0.5 for g in v.groups):
                idxs.append(v.index)
        if not idxs:
            continue
        for vg in list(vgs):
            if vg.name.startswith("__part_"):
                continue
            vg.remove(idxs)
        ensure(bone).add(idxs, 1.0, 'REPLACE')
        forced += len(idxs)

    for vg in list(vgs):
        if vg.name.startswith("__part_"):
            vgs.remove(vg)

    # Orphan rescue: bind to the closest bone segment.
    inv = character.matrix_world.inverted()
    segs = []
    for b in arm.data.bones:
        segs.append((b.name,
                     inv @ (arm.matrix_world @ b.head_local),
                     inv @ (arm.matrix_world @ b.tail_local)))

    def seg_dist(p, a, b):
        ab = b - a
        d = ab.length_squared
        if d < 1e-9:
            return (p - a).length
        t = max(0.0, min(1.0, (p - a).dot(ab) / d))
        return (p - (a + ab * t)).length

    fixed = 0
    for v in me.vertices:
        if sum(g.weight for g in v.groups) > 1e-4:
            continue
        best, bd = None, 1e18
        for name, h, t in segs:
            dd = seg_dist(v.co, h, t)
            if dd < bd:
                bd, best = dd, name
        if best:
            ensure(best).add([v.index], 1.0, 'REPLACE')
            fixed += 1
    return fixed, forced


def import_clips(arm, src_dir):
    """Pull Run/Idle onto the new rig; rotation-only clips transfer as-is."""
    wanted = {"run.fbx": "Run", "idle.fbx": "Idle"}
    if not arm.animation_data:
        arm.animation_data_create()
    tracks = []
    for fname, want in wanted.items():
        before = set(bpy.data.actions.keys())
        try:
            bpy.ops.import_scene.fbx(filepath=f"{src_dir}/{fname}",
                                     ignore_leaf_bones=False, automatic_bone_orientation=False)
        except Exception as exc:  # noqa: BLE001
            log("clip import failed", fname, exc)
            continue
        new_actions = [bpy.data.actions[k] for k in set(bpy.data.actions.keys()) - before]
        # Longest new action is the cycle; the other is a one-frame targeting pose.
        chosen = None
        for a in new_actions:
            if want.lower() in a.name.lower() and "targeting" not in a.name.lower():
                chosen = a
                break
        if chosen is None and new_actions:
            chosen = max(new_actions, key=lambda a: a.frame_range[1] - a.frame_range[0])
        if chosen:
            chosen.name = want
            chosen.use_fake_user = True
            tracks.append(chosen)
            log(f"clip {want}: {chosen.name} frames {chosen.frame_range[:]}")
        # drop the imported rig/mesh, keep only the action
        for o in [o for o in bpy.data.objects if o is not arm and o.type in {'ARMATURE', 'MESH', 'EMPTY'}]:
            if o.name.startswith(("Armature", "Root")) or o.type == 'EMPTY':
                bpy.data.objects.remove(o, do_unlink=True)

    # Drop everything that is not a real cycle so the GLB carries exactly two clips.
    for a in list(bpy.data.actions):
        if a not in tracks:
            a.use_fake_user = False
            bpy.data.actions.remove(a)
    for a in tracks:
        nla = arm.animation_data.nla_tracks.new()
        nla.name = a.name
        nla.strips.new(a.name, int(a.frame_range[0]), a)
    log(f"attached {len(tracks)} clips")


def render_preview(path, arm, character):
    """Orthographic front + side + 3/4, tiled — the only way to judge silhouette."""
    import os
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.show_cavity = True
    scene.display.shading.show_object_outline = False
    scene.render.resolution_x, scene.render.resolution_y = 520, 900
    scene.world = bpy.data.worlds.new("W")
    scene.world.color = (0.06, 0.06, 0.08)

    arm.hide_render = True
    tgt = bpy.data.objects.new("Tgt", None)
    bpy.context.collection.objects.link(tgt)
    tgt.location = (0, 0, H * 0.52)

    shots = []
    views = [
        ("front", (0, -12, H * 0.52), True),
        ("side", (12, 0, H * 0.52), True),
        ("hero", (4.6, -7.4, H * 0.66), False),
    ]
    base, ext = os.path.splitext(path)
    for name, loc, ortho in views:
        bpy.ops.object.camera_add(location=loc)
        cam = bpy.context.active_object
        if ortho:
            cam.data.type = 'ORTHO'
            cam.data.ortho_scale = H * 1.12
        else:
            cam.data.lens = 62
        c = cam.constraints.new('TRACK_TO')
        c.target = tgt
        scene.camera = cam
        f = f"{base}_{name}{ext}"
        scene.render.filepath = f
        bpy.ops.render.render(write_still=True)
        shots.append(f)
        bpy.data.objects.remove(cam, do_unlink=True)
    arm.hide_render = False
    log("previews ->", ", ".join(os.path.basename(s) for s in shots))


if __name__ == "__main__":
    main()
