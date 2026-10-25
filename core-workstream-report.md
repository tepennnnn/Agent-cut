# Agent Cut v2 core editing workstream — 2026-10-17

## Delivered scope

The approved incremental sequence/track architecture now supports an end-to-end local workflow: explicit backed-up migration, sequence/track management, source-range placement, core editing, native overlap dissolves, annotations, composed frame and continuous playback, export, plans and undo/redo. User video projects were not migrated or edited. This closes the **v2 core editing delivery increment**, not the full original Premiere-parity request or the entire timeline feature checklist.

The implementation extends Store, the shared operation registry and existing encoder filters. Pure commands live in sequence-edits.mjs/sequence-operations.mjs; persistence remains in Store. Heavy composition runs in FFmpeg child processes. No network fetching, remote AI integration, dependency download or Adobe code/assets was added.

## Contracts and traceability

Every operation is callable through timeline_plan/edit and saved-plan tools, uses sequence/item/track IDs, rejects malformed fields, validates the entire batch, and commits as one undo step. IDs are deterministic within a plan. See operation-contracts-v2.json for exact types/required fields. The table below is an Agent Cut contract, not a claim of measured Premiere 22 behavior.

| Feature / contract | Defaults and semantics | Code | Verification |
|---|---|---|---|
| project_rename / sequence_settings | Title 1–120; sequence/track names 1–80; even canvas 160–3840 × 160–2160; rational fps 12–60 | sequence-edits.mjs | controls/annotations test |
| item_add | sourceIn 0, sourceOut asset duration, speed 1 (0.25–4), volume 1 (0–2); explicit destination/time; linked audio on a new track unless disabled/existing destination supplied | sequence-operations.mjs | placement and insert/overwrite tests; browser library placement |
| Insert/overwrite/three-point | mode place/insert/overwrite; insert splits crossing media and moves destination/targeted/sync-locked tracks; overwrite cuts intersecting destination and linked media, without downstream ripple; timelineOut replaces sourceOut for three-point derivation | sequence-edits.mjs | linked fragments/locks test |
| Trim / rate / slip | Trim fixes timeline start and changes source bounds/duration; rate preserves source bounds; slip shifts source bounds without changing duration; linked defaults true | sequence-edits.mjs | boundary/handle/linked tests; browser trim/undo |
| Split / razor | Absolute sequence cut; minimum 0.01 source seconds per side; razor targets track groups once, optionally all tracks; linked audio references survive splitting | sequence-edits.mjs | source continuity and razor tests; stdio split-then-dissolve regression |
| Roll / slide | Require adjacent neighbors and sufficient source handles; roll adjusts shared cut; slide preserves selected source/duration and adjusts neighbors; linked defaults true | sequence-edits.mjs | conservation/handles tests |
| Move/lift/nudge | Explicit destination/start, matching media kind; linked defaults true; lift leaves a gap; frame nudge uses sequence timebase | sequence-operations.mjs; ui/v2-ui.js | lock/collision/undo tests; browser move/lift |
| Range lift/extract/ripple delete | start inclusive/end exclusive; ripple defaults true; targeted/sync-locked track scope or explicit IDs; split fragments preserve source mapping; ripple maps captions, markers and export range | sequence-edits.mjs | split/source/annotation/lock tests |
| Cross-dissolve | Adjacent outgoing video item; 0 removes, >0 through 2 sec; duration must leave non-overlapping content; shifts suffix plus linked audio; alpha blend and linked audio crossfade in native renderer | sequence-edits.mjs; sequence-renderer.mjs | add/update/remove test; real red/blue mixed pixel test; browser and stdio |
| Track controls/reorder | Lock/mute/solo/target/sync lock; bottom-to-top order; locks protect affected content | sequence-operations.mjs; sequence-edits.mjs | control/lock tests; browser track workflow |
| Effects/volume | Shared transform/crop/opacity/basic-color/fade schema; merge effects by default, replace optional; effects linked false, volume linked true | sequence-edits.mjs; existing filters | bounds tests; existing real FFmpeg effects fixtures |
| Captions/markers/range | Literal text and explicit sequence times; update existing IDs or create; delete/clear explicit; SRT import supports v2 | sequence-edits.mjs; engine.mjs | annotation and undoable SRT tests |
| Timecode/match-frame | Read-only sequence_inspect returns source matches/reverse matches, frame index and rational frame time; HH:MM:SS:FF; drop-frame labels only 30000/1001 or 60000/1001 | timecode.mjs | fractional/drop-boundary tests; stdio source match |
| Playback | render_start preview:true freezes revision, ignores export range, caches by current revision; browser discards stale playback; encoder work asynchronous | engine.mjs; ui/composed-playback.js | real rendered browser playback/pause |
| Plans/recovery | Guards project/revision/plan; destructive v2 direct edits and saved destructive plans require confirmPlanId; migration/restore require reviewed confirmation and safety backups | Store; operations.mjs | deterministic plans, reopen, undo/redo, fault tests, browser recovery |

Empty sequences can be created, edited and recovered; rendering requires media. Same-track overlaps reject except validated dissolve pairs. Source handles, speed, volume, effects, caption/range bounds, track locks and project caps are validated before commit. Invalid, stale or unconfirmed edits leave persisted project/history unchanged. Native render caps active items at 64; project caps remain 64 sequences/tracks, 1000 items per track and two hours.

## Evidence and practical limits

The installed Premiere target remains 22.0.0.169. Static REA command inventories support the names of editing features. The REA evidence ledger still marks runtime behavior unknown. No Adobe runtime obligation is marked verified by these Agent Cut tests. traceability-index.json maps supported command names to these scoped contracts while preserving that uncertainty.

Browser verification uses intercepted HTTP with real Store/Renderer and synthetic scratch media; it is not a live server connection. The stdio protocol test starts the real server and calls schemas, migration, split/dissolve, source match, stale render rejection and undo. A live loopback authorization/range check remains sandbox-blocked. No running user server was restarted or disconnected.

Structural insert/overwrite/range edits reject sequences with transitions. Source edits reject attached transitions; remove them, make the edit and reapply. Trim/move/rate/dissolve keep annotations at absolute times and may reject if annotations would exceed the new end. Overlap dissolves use existing media and shorten the sequence; centered handle transitions and audio-only transition editing are not implemented. The browser may need a full local render before continuous playback; it remains responsive and allows editing while waiting. Jobs/previews are session-local and files remain on disk; automatic cache eviction and crash-left lock recovery UX remain open.

## Still open in the original request

Native nesting and multicam, time remapping/reverse/freeze, alternate transition types/alignment, keyframes/interpolation/masks/blends/adjustment layers, advanced color/scopes/LUTs, audio routing/processors/meters, motion graphics/transcription/VTT, bins/proxies/relink, advanced codecs/HDR/queue, copy/paste/groups/workspaces, full per-feature Premiere runtime comparisons and live deployment verification remain unfinished. These are retained in remaining-work.md; they have not been relabeled complete or silently deferred. V1 direct destructive calls retain compatibility behavior; the agent must still verify authorization.

## Loading the build

Code is synchronized to the existing extracted copy, preserving its data folder. The new portable ZIP contains an explicit allowlist of app code, contracts, tests and documentation, with SHA-256 manifest; it contains no footage, saved projects, exports, recovery snapshots, dependency binaries or session tokens. Preserve data and config.local.json during upgrades. Stop the old app and restart/reconnect MCP to load new code/schemas. Migration of a real project still requires explicit authorization after reviewing its preview.

## Final validation

`npm test`: 42 tests, 41 passed, zero failed, one sandbox-blocked live TCP check skipped. Browser workflow: passed, zero page errors, synthetic scratch footage and intercepted HTTP with real Store/Renderer. Current build includes stdio split/dissolve and source-match coverage. See core-verification.json and v2-ui-test-results.json.
