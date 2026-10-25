# Ember acceptance status

This records the acceptance checks that could not be completed from this worktree and host. No visual match or runtime check is claimed as passed.

## Artwork gate

The requested F-01.png through F-08.png inputs under `data/shipcat-fox-ember-gif-single-tail-v1/` are absent: 0 of 8 reference frames are available. The checkout has four turnaround images (`front-seed81032.png`, `side-left-seed81002.png`, `side-right-seed81012.png`, and `rear-three-quarter-seed81025.png`), which are not substitutes for those animation-frame references. Consequently, no frame-matched stills, side-by-side comparisons, 50-percent overlays, or frame-specific difference measurements can be produced from this checkout. The current hand-built primitive model has not passed the visual acceptance gate; do not treat it as the requested MLX-generated, pose-capable rework or as an accepted match.

## Display and runtime gate

At verification time, `system_profiler SPDisplaysDataType` reported one online display, at 1920 x 1080, marked as the main display. There is no second connected display on which to run the required two-display check. `verifyDisplays()` now iterates the displays that are actually available instead of failing solely because fewer than two are present. Its single-display snapshot smoke check does not prove real animation playback, edge traversal, click-through and interaction-mode input, five complete jumps, or a 15-minute idle-performance capture. None of those acceptance checks is claimed as passed. The requested multi-display evidence remains blocked by the lack of a second online display.
