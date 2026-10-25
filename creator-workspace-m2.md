# Creator workspace — Phase M2

Build: `creator-workspace-m2-2026-10-19`. This increment completes M2-01 through M2-05 and the M1-04 job foundation. It does not implement M3 titles/styles, M4 speech, or the final M6 host acceptance.

## Use

Run this folder's `start.cmd` with its existing data/configuration. Restart an older Agent Cut runtime and reconnect its Codex MCP connection to load the new build/tools. Open **Connect to Codex** to check the build and data root.

The new creator timeline uses v2 sequence tracks. A saved v1 project stays v1. Choose **Review track upgrade**, inspect its proposal, and explicitly activate it if desired; activation saves a recovery backup and is undoable. No user project was migrated by this increment.

- Click a clip to select; Ctrl/Shift click adds/removes selections. Move/lift/duplicate automatically include linked audio and grouped partners, with every affected track lock checked. Drag the center to move, or the first/last eight pixels to trim. Arrow keys nudge one sequence frame; S splits the focused clip at the playhead. Numeric move/trim and the Split button remain available.
- **Snap moves to frames** rounds drag offsets to the sequence frame grid. Zoom changes pixels per second. Invalid source handles, negative starts and unsupported same-track collisions reject the whole edit.
- **Copy clips** remembers the selection and a digest. **Paste clips** places independent copies at the playhead in the same project/sequence. If the copied source selection changes, copy again. **Duplicate clips** starts after the selected interval. Both allocate fresh item/link/group IDs, rebind companions, and preserve internal transitions. Include both transition sides when moving/lifting. Captions stay unchanged by default; MCP `items_duplicate.includeCaptions=true` copies fully contained cues and rejects crossing cues.
- **Simple inspector** exposes move, trim, basic effects and framing. **Advanced inspector** retains the previous tools. Aspect presets provide landscape, portrait and square; **Fit source**, **Fill canvas** and **Manual framing** use the existing transform operations and remain undoable. Extreme aspect ratios that require scale above the existing 4× limit reject explicitly.
- **Show source thumbnail / waveform** analyzes at most 120 source seconds, labels source coordinates and SHA-256, and shows original-source imagery/audio before timeline processing. It is not composed proof or speech recognition.
- Play composes a five-second local window, normally 640 pixels on its long edge at 15 fps. Windows advance through the timeline; composed stills are also bounded. Use the explicit **Full composed playback / frame** controls for native full-sequence composition when needed. Export retains native settings or the chosen export options.
- **Local jobs & cache** shows persisted status, cancellation, explicit retry and preview-cache clearing. Original media, backups and user exports are protected from preview eviction.

## MCP additions

`draft_start` accepts guarded project/revision, sequence and a range of at most ten seconds (`quality: draft | native`); poll `render_status`. `frame_preview.draft=true` requests a bounded still; the compatible default remains native. `job_control` supports list/status/cancel/retry/purge. `media_overview` returns bounded source imagery/waveforms. `project_lock_recovery` first inspects, then requires the reviewed revision and confirmation digest to recover a proven-dead owner, saving exact project bytes as a backup. Closed operation contracts add `items_move`, `items_lift` and `items_duplicate`. Fetch exact schemas with `timeline_operations`.

Jobs freeze requests and source file identities (managed filename, size and modification time). Retry creates a new attempt and refuses changed files. Completed jobs survive restart. Unfinished jobs become interrupted; a live or unverifiable previous coordinator/worker PID blocks retry/eviction. PID reuse is handled conservatively by refusal. Cancellation affects only recorded owned workers; no process-name killing is used.

Preview cache keeps four unpinned terminal jobs within 2 GiB, with a 512 MiB per-preview output budget. A retained-preview index survives bounded history loading. Read leases protect active image extraction and HTTP streams; clearing a pinned/active/foreign-owned output rejects. Nested intermediates live under their parent output directory. A serialized cleanup runs after release. Job metadata/history and user exports are not part of this preview-output quota. One heavy queue belongs to each runtime; use one runtime per data profile rather than forcing independent ports. Existing project mutation locks still serialize writers across processes.

Owned worker RSS is sampled once per second (default budget 2.5 GiB), with a 512 MiB system-free-memory guard. Short workers can finish between samples. Polling cannot prevent brief overshoot. Coordinator RSS is measured in the benchmark. No dependencies, speech models or media were downloaded.

## Supported preview limits

Bounded composition preserves original clip-local effect, automation, fade and transition clocks while seeking/culling intersecting items. Stateful audio processors get up to ten seconds of warmup; this is not a promise of sample-identical output after arbitrary filter history. Native boundary tests compare moving frames and audio RMS with full renders, including masks, captions, adjustments, reverse, hold and positive ramps. Draft scaling/frame-rate reduction remains explicitly lower quality than export.

Nested source items intersecting a draft range return an explicit unsupported error. Full native composition/export supports the existing nesting depth/recursion limits; no slow full render is silently substituted for a draft. Source-curve trims require clearing the curve first. Copy/paste is limited to the original project/sequence and a source selection that has not changed.

## Evidence

The roadmap folder contains `m2-benchmarks.json`, `m2-completion.json` and phase status. Full tests, real stdio tool calls, headless browser interactions using real Store/Renderer and an extracted-package suite verify this increment on synthetic media. Browser external requests were aborted. User project bytes/configuration are checked during code-only promotion.

Three baseline observations: cold five-second draft median 2.327 s (worst 2.333 s); bounded still median 0.537 s (worst 0.537 s); warm identical still median 0.074 s. Landscape export 20.548 s and portrait 31.233 s remain within the frozen 25% regression limits. The maximum of three observations is not a percentile.

Host acceptance remains explicit: the sandbox blocks live loopback HTTP and creation of a physical junction fixture, so those checks are skipped with reasons, not counted as passes. The connected user profile was read at revision 14 on the preceding build; it was not edited, migrated or restarted. Activating and testing this build in that live client remains a user-host/M6 check.
