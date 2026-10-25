# Adjustment-layer increment — 2026-10-17

Contract agentcut.effects.adjustment.v1. Static REA inventory contains cmd.file.new.adjustmentlayer (Adjustment Layer); this supports feature identity, not installed Premiere runtime semantics/defaults. The clip adjustment-layer toggle command is not implemented by this increment. Premiere obligation premiere22.effects-keyframes remains runtime-unverified.

## Scope and model

An adjustment layer is an ordinary v2 video track with role adjustment, no media items, and optional timed adjustment spans. Each span stores id, name, rational start/end and values. It is metadata, not a fake video asset or rendered intermediate file. Span timing must fit the existing media-derived sequence duration; adjustment layers do not extend it. A track supports at most 32 non-overlapping spans. Each span supports brightness [-0.5,0.5], contrast [0.5,2] and saturation [0,2], defaulting to 0/1/1. All other effect fields reject. This first increment is static basic color correction, not a general adjustment-effect stack.

- adjustment_layer_add(sequenceId,name,start,end,values,index?) atomically adds one dedicated video track and its span. Default position is the top of the stack; index is an explicit bottom-to-top insertion index. Generated track/span IDs are deterministic in a plan. Names are 1–80 characters; spans are at least 0.01 seconds, start inclusive/end exclusive.
- adjustment_update(sequenceId,trackId,adjustmentId,name?,start?,end?,values?) edits explicit fields; values merge with existing correction values.
- adjustment_delete(sequenceId,trackId,adjustmentId) removes one span, leaving its track. Deletion is classified destructive and requires reviewed confirmation on direct v2 edits/saved plans. Whole-track deletion also treats correction spans as populated content.

The shared registry/Store supplies atomic validation, identity/revision/plan guards, no-op detection, persistence and undo/redo. Locks protect updates/deletion; media placement/movement into a dedicated adjustment track rejects. sequence_clear clears corrections as well as media. No migration is performed on startup or any real user project.

## Composition and interactions

The native compositor applies each active span after its track's contribution and before higher video tracks. Thus lower video is corrected while higher video is unaffected. Overlapping corrections on different tracks compose in stack order. Mute suppresses a layer and its corrections; solo retains existing media-kind semantics (soloing an adjustment track also hides non-solo video tracks). There is no special solo dependency expansion. Corrections apply to the composed background, including black gaps, and do not affect audio or final captions. They share preview/export rendering. Active media items plus correction spans count toward the native 64-contribution render limit.

Insert/range edits currently reject participating adjustment layers. For an intentionally fixed correction, explicitly disable targeting/sync-lock or exclude its track, then review timing; corrections do not silently ripple. Media edits that shorten the sequence below a correction end reject unless the correction is updated/deleted in the same batch. Masking, animated corrections, strength blending, LUTs, arbitrary filters, effect stacks and general per-clip conversion to adjustment layers remain open.

## UI and verification

The toolbar's Add adjustment layer creates the track/span in one reversible command. Purple span controls open the shared correction form; track locks disable editing, Delete correction uses reviewed confirmation, and standard track controls manage mute/reorder/delete.

adjustment-tests.mjs covers invalid bounds/properties/indices, locks, populated-track deletion, media-destination guards, structural edit limits, clear, defaults/merge, deterministic plans, reopen and undo/redo. Real FFmpeg checks verify the correction interval, lower-only scope, track reordering, mute behavior, composed preview and unchanged audible audio. Browser testing covers add/preview/edit, locks, delete and undo with synthetic media and intercepted HTTP plus real Store/Renderer. It is not live HTTP client deployment verification.

The full suite reports 59 tests: 58 passed, zero failed, one sandbox-blocked live HTTP client check skipped. Browser workflow passed with zero page errors. adjustment-ui-proof.png uses synthetic scratch footage, not the user's video. No original runtime evidence was upgraded to verified. Saved user projects are untouched and user processes are not restarted; restart Agent Cut/reconnect MCP to load new code. The full original request remains open.
