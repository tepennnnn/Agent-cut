# Smooth time remapping — 2026-10-18

## Delivered behavior

V2 items support a positive, continuous playback-speed curve. Each point contains clip-local playback `time` and `speed`; speeds interpolate linearly, and integrating the curve gives source position. This implements actual ramps rather than constant-rate segments with abrupt jumps.

`item_speed_curve` accepts `sequenceId`, `itemId`, `points`, and optional `linked` (default true). It keeps the retained source range and timeline start, sets the base speed to 1, and takes its timeline duration from the final point. The integral must equal the retained source span within 1e-8 seconds. The reviewed plan shows any resulting duration change; overlaps, stranded automation/annotations, invalid links, and locked affected tracks reject atomically. Clear with `item_speed_curve_clear`; this restores constant speed 1 over the same source range, potentially changing duration. Clearing an item without a curve is a no-op. Store revision/identity guards, deterministic plans and undo/redo apply.

The inspector's **Speed curve** dialog accepts JSON points. For four retained source seconds, a valid smooth ramp is `[{"time":0,"speed":0.5},{"time":4,"speed":1.5}]`. The **Include linked media** option controls linked audio; disabling it intentionally allows independent timing. **Clear speed curve** restores constant speed 1. Invalid curves produce an error without changing the project.

Video rendering analytically inverts the integrated rate curve in FFmpeg timestamps, then applies timeline-local effects, automation, composition and transitions. Output samples existing decoded frames at the sequence frame rate; it does not generate optical-flow frames. Linked stereo audio uses the same timing integral, with bounded offline windowed-sinc resampling. **Audio pitch follows speed**. Item audio processing, gain/volume automation, fades and track mixing follow resampling. Pitch-preserving variable-rate audio remains open.

Split/razor, insertion cuts and range fragments slice curves and retain source continuity. Slip preserves the curve while shifting source bounds. Move/lift, masks, effects, automation and nested sources continue to use their existing contracts. Source/timecode inspection maps in both directions using the curve. Source trim, constant rate stretch, roll and slide reject participating remapped items until curves are cleared. Reverse and freeze cannot coexist with a curve. Isolated audio loudness analysis rejects remapped items rather than reporting measurements from unremapped audio. Legacy flattening rejects curves explicitly.

## Bounds and evidence

Project/render curves allow 2–32 points, speeds 0.25–4, up to 60 retained source seconds and 120 playback seconds per item. Playback times start at zero and strictly increase. The audio decoder emits 48 kHz stereo float PCM; decoded source storage is capped around 23 MB, while output is written in chunks. This is an application buffer bound, not a hard FFmpeg process-memory bound. Temporary source/output PCM stays in the job export directory; cache cleanup and cancellation remain open.

`time-remap-tests.mjs` verifies analytic integration/inverse round trips, cut preservation, invalid inputs, linked edits/locks, source matches, split/range/gap slicing, deterministic plans, undo/redo and real FFmpeg output. A synthetic red-to-blue cut at source second 1 and a short audio pulse at source seconds 1–1.2 move to matching playback positions. Real linked split rendering and the 32-point rendering boundary also pass. Browser verification uses intercepted HTTP with the real Store/Renderer and synthetic media; it covers the curve dialog, composed frame, clear and undo with zero page errors. See `time-remap-ui-proof.png` and `v2-ui-test-results.json`.

Release verification records the final full-suite and extracted-package counts. One live loopback HTTP check remains skipped because the sandbox denies client TCP connections. No live-host connectivity or native Adobe runtime equivalence is claimed. Static `cmd.clip.speed` evidence identifies a command surface, not Premiere ramp semantics; this increment defines Agent Cut's own scoped contract.

## Deployment and remaining scope

The release synchronizes code to both existing extracted app folders while preserving their configurations and project-file hashes. It does not migrate or edit saved user projects, restart a running editor, or change MCP settings. Restart the intended editor folder and reconnect its MCP connection to load this build; `editor_info` reports `time-remapping-2026-10-18`.

The scoped smooth-ramp increment is implemented. The original workstreams remain open: pitch-preserving ramps, broader source-edit semantics, advanced interpolation/reverse/hold combinations, selection-to-nest/unnest, lossless/transparent nesting, richer effects/audio/color/text, media/multicam/export/productivity and native-runtime/final acceptance obligations.
