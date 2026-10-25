# Advanced timeline: freeze frames — 2026-10-18

## Delivered contract

Two v2 typed commands extend the existing model without migrating saved projects:

- `item_freeze(sequenceId,itemId,sourceTime)` holds a video source frame across the item's existing timeline duration.
- `item_freeze_clear(sequenceId,itemId)` restores normal source playback.

`sourceTime` is absolute source seconds. The encoder selects the first decoded frame at or after that requested time; this is not a source-frame-index or nearest-frame guarantee. Source time must be finite, nonnegative, and leave at least 0.1 seconds in the asset. Very short/end-of-file holds outside this guard reject. Unknown IDs, audio targets, malformed model fields and locked video tracks reject atomically. Decode failures remain explicit render errors.

The model adds optional video-only `frameHold:{sourceTime}`. The original source in/out, speed, placement, duration, link identities, effects and audio are preserved. Clearing the hold restores the original playback parameters. Audio continues unchanged; muting audio is a separate existing edit. Only the selected video track needs to be writable.

All mutations use existing deterministic plans, revision/project guards, batch validation, serialization, undo/redo and persistence. The legacy render adapter rejects held items, routing them to native v2 composition. The native renderer seeks the hold point, retains one decoded frame, and pads before effects/automation. It does not buffer the entire source clip. Video effects, masks, fades, opacity animation and track composition continue over the held image.

Split copies the same absolute hold point to each resulting video item, preserving held-image continuity. Trimming/slipping changes retained source bounds but does not implicitly move the selected hold point. Rate edits change duration using the existing speed bounds. Source relinking still validates the retained source range and the hold point. This increment does not insert new hold segments or extend a clip to arbitrary duration.

`sequence_inspect` reports the requested held source time instead of advancing through the source. Reverse match for that requested time returns the held item's start plus its full `timelineRange`; unrelated source times do not match the held video. Audio match results retain normal behavior. Returned `sourceSampling` describes the sampling limitation explicitly.

The video inspector provides Freeze frame, held-source time, Resume source playback, lock handling and a visible held-frame/audio explanation. Controls call the same typed operations as agents.

## Evidence and limits

`freeze-tests.mjs` covers bounds, unknown kinds/locks, deterministic plans, unchanged A/V source state, adapter rejection, atomic undo/redo, source matching, real moving-source output, held image at two different timeline times, unchanged measured audio, continued opacity animation and split rendering. The browser workflow tests hold/clear/undo and a real composed preview, saving `freeze-ui-proof.png`. The release JSON records final whole-suite and extracted-package smoke counts.

Premiere static command identity `cmd.clip.videooptions.frameholdoptions` is retained in the existing native REA inventory (`ev_30cfbf9145dd0979d6841be74d445ea028494dce8c4a1c907b9c83a38d9949a3`). This is a scoped common-feature adaptation, not verified Premiere 22.0.0.169 behavior. Add Frame Hold and Insert Frame Hold Segment variants, native defaults/parameters, deinterlacing and runtime equivalence remain open. No native REA unknown is marked resolved by these Agent Cut tests.

Reverse playback, speed ramps/time remapping, nesting, richer transitions/alignment and structural editing through transitions/adjustments remain in the advanced timeline workstream. This delivery does not close that workstream or the full original request.

## Planning estimate

Rough engineering effort, assuming one full-time engineer and continued access to the required native runtime:

| Remaining area | Estimated hours |
|---|---:|
| Version-pinned specification/runtime evidence | 8–20+, dependent on access and coverage |
| Advanced timeline workstream | 20–40 |
| Media/proxies/multicam | 30–60 |
| Advanced effects/color/graphics/audio | 80–160 |
| Export/mastering and productivity | 30–60 |
| Final integration, regressions and acceptance | 20–40 |

Rounded full-backlog planning range: **200–400+ engineering hours**, approximately **5–10+ full-time weeks**. This is not a guaranteed wall-clock completion date or unattended background execution promise. Feature specifications are incomplete, work overlaps, and runtime verification or scope changes can move the estimate substantially. The current scoped freeze-frame implementation is delivered separately from this estimate.
