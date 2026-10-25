# Ember F-01 to F-08 still-match gate

**Status: not accepted. Animation has not begun.**

Generated Blender stills are at `F-01-still.png` through `F-08-still.png`. Each target-to-still side-by-side is `F-XX-side-by-side.png`; each exact 50 percent blend is `F-XX-overlay-50.png`. Target source: `../shipcat-fox-ember-gif-single-tail-v1/F-01.png` through `F-08.png`.

| Target | Result | Specific mismatch |
|---|---|---|
| F-01 | Reject | The render is a primitive blockout, not the approved soft-furred amber Ember. Head is oversized and reads rearward/occluded; eyes are low and narrow rather than large upright green eyes; tail is cropped at left; four legs appear as detached dark ovals. Crop, lighting, pose, chest ruff, proportions and silhouette do not match. |
| F-02 | Reject | Same geometry/crop mismatch as F-01. The intended idle variation is too small to reproduce the approved frame's distinct expression and pose. |
| F-03 | Reject | Same geometry/crop mismatch as F-01; single-tail silhouette does not match the target's full fluffy tail. |
| F-04 | Reject | Same geometry/crop mismatch as F-01; amber glow and soft fur are absent. |
| F-05 | Reject | Same geometry/crop mismatch as F-01; face, paws and chest marking fail overlay. |
| F-06 | Reject | Same geometry/crop mismatch as F-01; no accepted correspondence for body and tail pose. |
| F-07 | Reject | Same geometry/crop mismatch as F-01; ear, facial and lighting silhouette fail overlay. |
| F-08 | Reject | Same geometry/crop mismatch as F-01; body/paw placement and crop fail overlay. |

## Anatomy inventory

The saved `shipcat-fox.blend` has `Ember_Rig` bones `leg_FrontLeft`, `leg_FrontRight`, `leg_RearLeft`, and `leg_RearRight`, plus `tail`, `head`, `neck`, `spine`, and `root`. Mesh inventory deliberately contains exactly two `Ember_Ear_*` objects and one `Ember_Tail (single)` object (with its white tip). The blockout satisfies the requested logical anatomy inventory but not the visual approval gate.

## Evidence

- MCP scene reset succeeded via `import bpy; bpy.ops.wm.read_homefile(use_empty=True, use_factory_startup=True)`.
- MCP saved `/Users/kayisrahman/.treehouse/firstmate-b8697d/9/firstmate/data/shipcat-fox-desktop-walk-plan-v1/shipcat-fox.blend` with 27 Ember collection objects, 2 ears, 1 tail, 4 articulated leg bones.
- Still renders used Blender EEVEE at 512x512. No walk, turn or jump animation was created or rendered.
