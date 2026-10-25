# Ember acceptance status

This records the acceptance checks that could not be completed from this worktree and host. No visual match or runtime check is claimed as passed.

## Artwork gate

The F-01.png through F-08.png references and prior per-frame stills, side-by-sides, 50-percent overlays, and rejection reports were available at the host paths supplied by the task supervisor and have been copied into `docs/ember-match/`. The comparison report records the prior blockout's specific qualitative differences per frame. Those Blender stills are historical outputs from an earlier blockout, not renders of the current bundled USDZ, and the reports provide no numeric similarity score. They are rejected evidence, not acceptance. The current hand-built primitive model has not passed the visual gate and is not the requested MLX-generated, pose-capable replacement. See `docs/ember-match/MATCH-REPORT.md` for the comparison record and explicit limitations.

## Display and runtime gate

At verification time, `system_profiler SPDisplaysDataType` reported one online display, at 1920 x 1080, marked as the main display. There is no second connected display on which to run the required two-display check. `verifyDisplays()` now iterates the displays that are actually available instead of failing solely because fewer than two are present. Its single-display snapshot smoke check does not prove real animation playback, edge traversal, click-through and interaction-mode input, five complete jumps, or a 15-minute idle-performance capture. None of those acceptance checks is claimed as passed. The requested multi-display evidence remains blocked by the lack of a second online display.
