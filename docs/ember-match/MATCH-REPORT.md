# Ember F-01..F-08 comparison record

**Gate: REJECTED. The current bundled USDZ is an unaccepted hand-authored prototype, not the MLX-generated replacement.** The comparisons below are reused historical Blender outputs from the earlier blockout pass. They are useful evidence of why that blockout failed, but are not renders of the current `App/Assets/Ember/Ember.usdz`; this report does not claim that the current asset has been frame-matched.

## Evidence files

- `references/F-01.png` through `references/F-08.png`: approved reference frames copied from the provided host reference set.
- `stills/F-01-still.png` through `stills/F-08-still.png`: prior Blender blockout stills.
- For each frame, `stills/F-XX-side-by-side.png` is the prior target/still comparison and `stills/F-XX-overlay-50.png` is its 50-percent blend.
- `source-match-report.md` and `source-match-report-v2.md` preserve the source reports verbatim.

The source report records the stills as 512x512 EEVEE Blender renders for its F-01 v2 evidence; it provides no numeric similarity score, mask-overlap score, or per-frame pixel-difference values. No such quantitative score is inferred here. It describes those prior stills as rejected, and says walk, turn, jump and USDZ export remained gated at that stage.

## Per-frame review

Each result below refers to the supplied prior side-by-side and 50-percent overlay, not a new render of the current USDZ. All eight prior comparisons are rejected.

| Frame | Result | Recorded visible differences |
|---|---|---|
| F-01 | Reject | Primitive smooth blockout instead of soft-furred amber Ember; oversized/rearward-occluded head; eyes low and narrow instead of large upright green eyes; tail cropped on the left; four legs read as detached dark ovals; chest ruff, silhouette, proportions, pose, crop and lighting do not match. |
| F-02 | Reject | Same primitive geometry and crop mismatch as F-01; the small idle variation does not reproduce this frame's distinct expression and pose. |
| F-03 | Reject | Same geometry and crop mismatch as F-01; tail silhouette does not match the target's full fluffy tail. |
| F-04 | Reject | Same geometry and crop mismatch as F-01; target amber glow and soft fur are absent. |
| F-05 | Reject | Same geometry and crop mismatch as F-01; face, paws and chest marking fail the overlay comparison. |
| F-06 | Reject | Same geometry and crop mismatch as F-01; body and tail pose have no accepted correspondence. |
| F-07 | Reject | Same geometry and crop mismatch as F-01; ear, facial and lighting silhouettes fail the overlay comparison. |
| F-08 | Reject | Same geometry and crop mismatch as F-01; body and paw placement and crop fail the overlay comparison. |

## Disposition

The previous comparison assets are preserved as a rejected historical baseline, not approval evidence for the current USDZ. The current builder uses hand-authored sphere/cone geometry and is not MLX-generated. The captain's requested pose-capable MLX rework and current-asset F-01..F-08 comparison remain outstanding; do not call the current model accepted or use these historical stills to imply it passed. Acceptance remains with the captain.

## Runtime acceptance

The current prototype remains integrated in the app as explicitly unaccepted prototype work, per the recorded direction. Two-display playback, edge traversal, click-through and interaction-mode input, five complete jumps, load-error capture, and a 15-minute idle-performance capture remain unverified. The host check recorded one online 1920 x 1080 main display, so the second-display portion could not be performed. `docs/EMBER-ACCEPTANCE-STATUS.md` records this limitation; the one-display snapshot smoke check is not a substitute for these runtime acceptance checks.
