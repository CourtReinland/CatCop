"""Report which channels the run/idle clips actually animate.

If they are rotation-only, the rest pose can be re-proportioned freely and the
animation still works. Location tracks on non-root bones would pin the skeleton
back to its original proportions.
"""
import bpy, sys, json
from collections import Counter

argv = sys.argv[sys.argv.index("--") + 1:]
out = {}
for path in argv[:-1]:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=path)
    for action in bpy.data.actions:
        chans = Counter()
        bones_with_loc = set()
        for fc in action.fcurves:
            dp = fc.data_path
            prop = dp.rsplit('.', 1)[-1]
            chans[prop] += 1
            if prop == 'location' and '["' in dp:
                bones_with_loc.add(dp.split('"')[1])
        out.setdefault(path.split('/')[-1], {})[action.name] = {
            "frames": [round(v) for v in action.frame_range],
            "channels": dict(chans),
            "bones_with_location": sorted(bones_with_loc),
        }
with open(argv[-1], "w") as f:
    json.dump(out, f, indent=1)
print("OK")
