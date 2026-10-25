# Agent editing recipes M5 — 2026-10-19

Build `agent-recipes-m5-2026-10-19` adds source-evidenced opening, excerpt, highlight, pause-cut and montage candidates. **Generation saves a plan; it never applies an edit.** Review the explanation, source evidence, timing/policy warnings and a composed candidate before using the existing guarded apply/undo tools. User projects are not migrated, analyzed or edited by deployment. Phase evidence is recorded in `../capcut-roadmap/m5-completion.json`.

## Using the controls

In **Offline speech & transcripts**, open a completed or imported transcript. **Plan opening from passage** selects an existing video item starting at timeline zero and a transcript segment. It removes the prefix before that passage across all tracks, retaining linked audio and the chosen caption/title timing policy. It rounds the cut down to the sequence frame grid to preserve the first syllable. An opening already at zero is a no-change error. The passage is explicitly chosen; it is not automatically ranked as strongest.

**Plan transcript highlight** selects an existing forward video item and contiguous passages from the currently displayed transcript page. Choose a target length, aspect and dissolve duration. The candidate creates a new sequence with draft captions, preserving the original sequence. MCP can select up to twelve excerpts from multiple sources, each with its transcript revision and ordered contiguous segment IDs. Selected ranges are never silently stretched, repeated or dropped to meet the target. The default target is 30 seconds; output outside the requested target is disclosed. Short source material remains short.

In **Agent edit plans → Plan montage**, explicitly choose three sources, their order and source in/out points, optional title and optional local music/gain/fades/ducking. Repeating a selected source repeats that range deliberately; there is no automatic repetition to fill time. MCP accepts 1–12 selected video ranges. Music must contain enough audio for the entire result: it is trimmed to the requested assembled duration and is never looped/stretched. Ducking uses the linked source audio track, with an explicit -30 dB threshold, ratio 4, 20 ms attack and 250 ms release. It is signal-driven, not speech recognition or beat matching.

**Measure source pauses** analyzes a selected original source range of at most 120 seconds using local FFmpeg. Select a -70 to -5 dB threshold and a 0.1–20 second minimum interval. The job shares the media queue and supports cancellation/retry/restart handling. **Review measured pauses** chooses a completed measurement, matching timeline item, selected measured intervals, source padding and caption/title policies. Only the selected low-level intervals are removed, in descending timeline order, with all tracks/linked media rippling together. The default 0.12-second source padding is retained on both ends; frame rounding stays inside the measured interval. Low level does not establish speech pauses, filler words, emotion or meaning. Empty measurements do not invent cuts.

Every review has **Preview edit candidate**, **Apply edit candidate** and discard/close controls. Application requires confirmation; destructive cuts also use the saved plan's destructive confirmation guard. A single undo restores the whole prior timeline. Applied reviews carry the application revision and cannot be applied again. Composed candidate stills retain the existing 120-second sequence limit; ordinary full composition remains available separately.

## MCP contract

One new tool, `edit_recipe`, exposes closed selected contracts progressively:

| Action | Arguments/result |
|---|---|
| `contracts` | `kind=opening/excerpt/highlight/pause_cut/montage/pause_analyze`; exact closed `request` schema and limits |
| `plan` | Current `expectedProjectId`, `expectedRevision`, `kind` and validated `request`; frozen plan ID, complete selected source evidence, explanation, operations and proposed duration |
| `pause_analyze` | Explicit asset/source bounds, threshold and minimum interval in `request`; owned job, poll `render_status` |
| `pause_read` | `evidenceId` from a completed measurement; at most 100 measured source intervals, source digest/settings and semantic limitation |

Supply project identity for every call. A plan response is capped at 60 KB of complete review; exceeding it rejects rather than truncates source evidence. Requests are capped at 32 KiB, plans at 200 ordinary operations, assembly at 120 seconds, and source binding at 30 original sources. Fetch fewer excerpts when limits are exceeded.

Use `timeline_plan_preview` with the returned plan ID, base revision and returned candidate sequence ID. Use `timeline_plan_apply` only after the requested editorial intent/review authorizes it. Prefix/pause cuts require `confirmPlanId=planId`. Existing `timeline_undo` restores the previous project with a new revision. The selected evidence/request/explanation are persisted and returned as `recipeReview` by `timeline_plan_read`. New recipe plan envelopes checksum-bind that provenance; missing/corrupt bindings reject reading/preview/application. Legacy/manual saved plan envelopes remain readable. A corrected transcript does not silently rewrite a frozen candidate; create a new plan to include later corrections.

## Timing, captions and source preservation

Opening/pause cuts support ordinary forward items and positive speed curves through the actual inverse source mapping. Existing effects, automation, linked partners, captions and graphics follow the shared range-removal implementation. Every affected track participates; locked tracks or unsupported transition/adjustment combinations reject instead of silently skipping content. Caption/title policy is explicitly `retain` or `retime`. Retained absolute text must still fit the resulting sequence; an invalid retained cue rejects. Cut-time automatic caption regeneration remains separate from atomic range operations.

Excerpt/highlight reconstruction supports unprocessed forward constant-speed video items with matching linked audio. Static effects, keyframes, source masks, reverse/holds, speed curves, solo/muted/processed tracks, active adjustments and independently processed/trimmed linked audio reject, so processing is not silently flattened. Advanced manual editing remains available. Montage works on original local assets. New assemblies use fit framing and optional aspect presets; there is no automatic subject tracking/reframe. Only selected source clips and explicitly requested recipe text/music enter the new sequence; existing layers/markers/annotations remain in their original sequence.

Draft captions use transcript source coordinates and selected passage IDs. Constant-speed trims/offsets map to timeline time. Whole selected passages must fit retained source bounds. Dissolve joins use the existing overlap/crossfade implementation; caption intervals meet at each dissolve midpoint. The whole segment text remains even when its displayed interval is clipped at a join; timestamps are coarse and require review. There is no word alignment guarantee. `omit` explicitly creates no captions in a new montage. Existing captions in other sequences are preserved.

Recipes reference original managed media and persist full content hashes for all used sources, including all rippled sources for prefix/pause cuts. Source changes after evidence reads reject generation; source changes after planning reject candidate preview/application. Relink/project revision changes also invalidate the saved plan. Pause measurements are keyed by full content/decoder digest/range/settings, reused without repeating analysis, and retain at most 100 records/100 intervals per record. Canceled/incomplete measurements are not readable. Measurements and plan provenance survive preview-output eviction and contain no executable content.

## Compatibility seam

`sequence_create`, `track_add` and `item_add` now accept optional `newId`: a unique lowercase 64-character SHA256 string. It permits a normal atomic operation plan to reference newly created objects later in the same batch. Omitted IDs retain the original deterministic allocator. Existing/cross-kind/duplicate IDs reject; schema and runtime validation stay closed. This adds no project schema version or implicit migration. Recipe compilers derive these IDs deterministically from the project/revision, request and evidence; final operation execution still goes through the normal engine.

All other operations, rendering, confirmation, stale-state and undo behavior are shared. The regression runner limits concurrency to two test files to avoid CPU oversubscription of existing FFmpeg tests. No runtime dependency, model installation, online asset source, cloud AI call or in-app LLM was added.

## Verification scope

Tests exercise stable dependent IDs, strict contracts, explicit transcript ranges, linked A/V, caption joins, title/music/fades/ducking, measured pause coordinates/padding/cache, source changes before preview/apply, stale revisions, required destructive confirmation and exact undo. Both creator journeys compose candidate and committed frames and export portrait/landscape video with audio. Browser interactions use real engine/services on isolated synthetic projects through intercepted HTTP; real stdio exercises the actual MCP envelopes. Neither closes the separate live user-host gate. The narrated acceptance fixture muxes locally synthesized speech with color clips and imports the prior real local-ASR SRT for that same narration; it is not a human-speech accuracy or editorial-quality benchmark. Manual real-footage testing remains deferred to M6 at the user's request.


Phase checks: 127 regression checks ran with **124 passed, zero failed/canceled, three explicit skips** (sandbox live HTTP/junction fixtures and optional real-ASR fixture; real ASR was separately verified in M4). Six recipe groups and eight real-stdio groups passed, including persisted/corrupt evidence checks and both creator journeys. Full browser regression and recipe controls passed with zero page errors. The narrated fixture produced a 24.020-second portrait highlight with six draft captions/two dissolves and an 11.600-second landscape montage; both included selected title/music/ducking, candidate/committed proof, export with audio and exact undo. The completion report records final extracted-package checks and hashes. User-host activation and deferred real-footage testing remain M6.
