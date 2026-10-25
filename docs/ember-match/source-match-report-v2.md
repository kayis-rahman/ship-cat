# Ember still-match gate - refinement 2

**Still not accepted. Walk, turn, jump and USDZ export remain intentionally gated.**

## What changed

A fresh Shipcat-only Blender scene was created via the approved operator using an explicit `import bpy`. The scene is saved at `../shipcat-fox.blend`, never in the Ironveil trailer file. The v2 F-01 still is `F-01-v2-still.png`.

The revised model has a coherent upright fox silhouette: warm amber body/head/haunches, cream chest ruff and muzzle, rose inner ears, large green eyes, black paws, a continuous single tail with cream tip, and exactly four explicit leg chains. Its `Ember_Rig` has independently named `front_left`, `front_right`, `rear_left`, and `rear_right` bones, plus spine, head and tail.

## F-01 comparison result

It is an improvement over the first detached-parenting blockout but **does not meet the captain's 90-100 percent visual-match threshold**. Specific remaining differences from the approved F-01:

- The target has dense, soft, directionally groomed fur and nuanced amber-to-russet face shading. V2 is smooth procedural geometry with flat stylized material.
- Target proportions are a three-quarter, elegant fox with a narrower tapered muzzle, naturally asymmetric standing legs and a larger soft chest ruff. V2 is an intentionally simplified frontal toy-like blockout.
- The target's face has expressive almond green eyes, eyelids, catchlights and whiskers; V2 has vertical oval eyes and no eyelids, catchlights or whiskers.
- Target tail is a fluffy, curved, partly occluded rear silhouette; V2 tail is a smooth horizontal capsule.
- Target has a photographic warm rim/key-light treatment and black-background crop. V2's EEVEE lighting is only a neutral approximation.

The new model satisfies the logical anatomy count but the captain's visual gate remains unpassed. It is not valid evidence for a walk-animation start.

## Evidence

MCP save response: `shipcat-fox.blend`; eight rig bones reported: root, four legs, spine, head, tail; 33 mesh objects. Rendered `F-01-v2-still.png` at 512x512 in Blender EEVEE. The prior complete per-frame target comparisons and 50% overlays remain in this directory; they are rejected and must be regenerated only after a materially closer model is available.

## Headless calibration baseline

At the captain's direction, Blender was verified and run headlessly at `/opt/homebrew/bin/blender` (`Blender 5.2.2 LTS`). `build_reference_calibration.py` produced `F-01-reference-calibration.png` and `shipcat-fox-reference-calibration.blend` from the approved F-01 image. This render is pixel-faithful because it is a deliberately tagged `REFERENCE_ONLY_F01_CALIBRATION_PLATE`, not because it is a valid 3D model. It establishes the camera/crop/background target for subsequent geometry iteration and must not be counted as a 3D approval or used in the product.

## Headless rig build check

The existing deterministic rig builder was also run headlessly against the accepted turnaround set. It successfully wrote `headless-build-preview/Ember.usdc` (558,009 bytes), reported 11 bones (two ears, one tail chain, four leg bones), 25 meshes and animated frame range 1-96 at 24 fps. Its `front.png`, `side.png` and `rear.png` prove the pipeline works but fail the F-01 image-match gate: the front preview is a low-detail toy-like primitive rather than the approved furry fox. It must not be promoted as the matching completed model.
