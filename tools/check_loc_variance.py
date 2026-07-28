"""Are the clips' location tracks animated, or constant baked bind offsets?

Constant => the rest pose can be re-proportioned as long as we rewrite those
constants to match, and the motion (all in the rotation tracks) survives intact.
"""
import bpy, sys, json

argv = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=argv[0])

report = {}
for action in bpy.data.actions:
    per_bone = {}
    for fc in action.fcurves:
        if not fc.data_path.endswith('location') or '["' not in fc.data_path:
            continue
        bone = fc.data_path.split('"')[1]
        vals = [kp.co[1] for kp in fc.keyframe_points]
        if not vals:
            continue
        spread = max(vals) - min(vals)
        per_bone.setdefault(bone, 0.0)
        per_bone[bone] = max(per_bone[bone], spread)
    moving = {b: round(s, 5) for b, s in per_bone.items() if s > 1e-4}
    report[action.name] = {
        "bones_with_loc_tracks": len(per_bone),
        "bones_whose_loc_actually_moves": len(moving),
        "movers": dict(sorted(moving.items(), key=lambda kv: -kv[1])[:10]),
    }
print(json.dumps(report, indent=1))
