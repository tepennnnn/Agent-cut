# Advanced timeline: reverse playback and transition types — 2026-10-18

This increment continues the existing timeline workstream. It does not complete nesting, time remapping, native Premiere runtime verification or the full original request. Saved projects are not migrated or edited by delivery.

## Reverse contract

`timeline_edit` adds `item_reverse(sequenceId,itemId,enabled,linked?)`. `enabled:true` stores optional `reverse:true`; false removes it. Linked A/V reverses together by default; `linked:false` changes only the selected media item. Group selection retains the existing source-edit policy: links expand, arbitrary groups do not. Every affected track lock is enforced. Existing source bounds, placement, duration, speed, keyframes, effects, masks and metadata remain in place. Clear a freeze-frame hold before enabling reverse; the two modes cannot coexist on one video item. Unsupported flags, limits, kinds or handles fail the whole batch.

Plans, IDs, revision/identity guards, save/replay, commit, persistence and undo/redo use the shared command layer. The legacy adapter refuses reverse items, ensuring native rendering. Video/audio inspectors provide Reverse playback and Forward playback with the existing linked-media toggle. `sequence_inspect` maps source lookup backward; video positions describe the resampled source grid, not exact original VFR/frame-index identity. Audio positions account for the reversed 48 kHz sample endpoint.

Source slicing now uses playback direction: a reversed playback subinterval `[from,to]` retains `[sourceOut-to*speed, sourceOut-from*speed]`. Split, insertion, overwrite/range cuts and linked fragments use that mapping. Roll/slide adjust the opposite source handle for reversed neighbors. Slip remains a signed shift of both source handles; explicit trim retains supplied source bounds; rate keeps the existing constant-speed rules. Keyframe slicing remains in playback-local time. Cuts not aligned to the sampled frame grid may resample boundary frames; arbitrary cuts are not promised byte-identical.

### Bounded rendering and sampling

Video first normalizes the retained source into a local FFV1/NUT file on a grid of `sequence fps / speed`. It then reverses bounded frame batches, concatenates batches in reverse order, and rebuilds timestamps from frame index. Normalization prevents chunk-local source seeks from losing frames; rebuilt timestamps prevent fractional-rate concat rounding from dropping frames during final composition. Output effects/automation and constant speed apply after source reversal.

Limits: at most 60 retained **source** seconds per reversed item; actual source dimensions must be known and contain at most 3840×2160 pixels; at most 256 batches. Batch sizing uses a conservative 16 bytes per source pixel and a 256 MiB frame-batch estimate. This bounds reverse-filter batches, **not total FFmpeg process RSS**. Slow motion increases sample count and can exceed the batch cap. Video source metadata/bounds are reprobed before preparation. Each preprocessing encoder invocation has a 120-second timeout. Jobs report failures rather than silently falling back to forward playback.

Audio is converted to 48 kHz stereo before `areverse`, keeping the buffered source interval bounded independently of original channel count/sample rate. Existing volume/processor/fade automation runs afterward. This is stereo playback, not arbitrary source-channel/surround preservation. The common 60-source-second limit applies to audio too.

All preparation is local and asynchronous. FFV1 intermediates remain in the render job's exports directory; high-resolution reversals can use substantial disk space and encoding time. Cleanup/cache management remains open. The pipeline is SDR/8-bit; source-level HDR/bit-depth mastering and original codec/frame-byte preservation are not claimed. Source media files are never overwritten.

## Transition contract

`sequence_transition(sequenceId,itemId,seconds,kind?)` now accepts:

| Kind | Video behavior |
|---|---|
| cross_dissolve | Existing incoming alpha fade across the overlap |
| dip_black / dip_white | Outgoing image fades to the color during the first half; incoming image becomes visible at midpoint and fades from that color during the second half |
| wipe_left_to_right / wipe_right_to_left | Incoming alpha reveals horizontally in the named direction |
| wipe_top_to_bottom / wipe_bottom_to_top | Incoming alpha reveals vertically in the named direction |

Omitted kind preserves an existing transition's kind, or defaults to cross dissolve for a new transition. Zero seconds removes it and restores overlap timing. Duration remains greater than zero through 2 seconds, leaving at least .01 seconds of non-overlapping media on each item. Clips must be adjacent on the same video track. A kind update keeps the transition ID and overlap timing; duration changes shift the outgoing track's suffix and linked audio as before. All types use the existing linear audio crossfade over the full overlap.

Effects are local to these video items. Dips affect their RGB while retaining normal item/track alpha composition; they are not a global sequence fade through all tracks. Wipes multiply incoming alpha. Captions remain composed afterward. Source masks and non-normal blend modes on transition-attached items reject consistently. Independent masked/blended tracks above or below continue to compose normally. The inspector's **Transition** button replaces the former Dissolve button and offers readable type names.

Alignment remains the existing outgoing-suffix overlap model (`legacy-overlap`), not source-handle-centered or arbitrary in/out alignment. Default-transition preferences, morph cut, arbitrary transition plugins and structural edits through transitions/adjustment layers remain open. Non-dissolve transitions always use the native renderer.

## Verification and traceability

`reverse-tests.mjs` verifies deterministic plans, linked/single-item selection, locks/bounds/budgets, freeze conflict, reset/undo/redo, source lookup, reversed split/insert/range/roll/slide mapping, real multi-batch video/audio order, slow playback and split continuity. A changing-gray reference checks every frame at 30000/1001: the lossless intermediate must equal the exact reversed normalized frame array, including chunk seams. Final H.264 comparison allows small encoding/color-rounding error and checks frame count.

`transition-tests.mjs` validates all kinds, updates/removal/timing, invalid parameters and adapter rejection. Real renders verify black/white midpoint values, each wipe direction's revealed/covered halves, and clean images before/after transitions. The expanded browser workflow exercises linked reverse/forward/undo, composed frames, wipe selection/preview/undo and zero page errors. Proof screenshots: reverse-ui-proof.png and transition-ui-proof.png. transition-render-proof.png presents six synthetic midpoint renders with labels. Final whole-suite, extracted-package smoke, code-copy integrity and unchanged-project hashes are recorded in reverse-transitions-2026-10-18-release.json.

The native REA inventory remains `ev_30cfbf9145dd0979d6841be74d445ea028494dce8c4a1c907b9c83a38d9949a3`; its original runtime obligations remain unknown. Existing static identities `cmd.clip.speed` and `cmd.timeline.setttransitionduration` map to scoped adapters, not verified factory parameters/native behavior. No unsupported REA ID or specific dip/wipe command identity is invented. These are Agent Cut implementation/output proofs, not Premiere equivalence proofs.

## Still pending

The next major timeline implementations are nesting and speed ramps/time remapping, followed by richer transition alignment and structural edits through transitions/adjustment layers. The broader backlog remains in remaining-work.md. The earlier 200–400+ engineering-hour estimate remains a rough planning range, not a completion date or a promise to execute between chat turns.
