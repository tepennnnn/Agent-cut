# Agent Cut: audio, media, productivity, export and subtitles — 2026-10-17

This delivery extends the existing v2 model and renderer. It does **not** complete the full Premiere parity request. Original Premiere 22.0.0.169 runtime obligations remain unverified. The native REA inventory and ledger retain their existing Evidence IDs and unknowns; Agent Cut output tests are evidence of Agent Cut behavior, not Premiere equivalence.

## Shared command and persistence contract

New timeline commands use the same operation schemas, deterministic plan IDs/allocated IDs, revision/project guards, atomic commit, save/replay, and undo/redo as existing commands. Read `project_read` first. Validate with `timeline_plan`, then apply with the current `expectedRevision`, `expectedProjectId` and `expectedPlanId`. Bin deletion and attribute replacement are destructive and require the reviewed `confirmPlanId`. Every write checks the complete proposed project before committing; locked affected tracks reject the whole batch. Source files remain immutable managed copies.

`timeline_operations` is the authoritative schema registry. `operation-contracts-v2.json` is regenerated from it. There are 29 MCP tools in this build. No app network service, model API, source upload, remote import or dependency download was added.

## Audio

`item_audio` and `track_audio` set or merge a processor object; `replace:true` replaces it and `{}` resets it. Item volume/keyframes run before processors; item fades run after them. Track processors run after the track mix. The existing final master limiter remains in place.

| Processor | Scope, default and limits |
|---|---|
| Gain | 0 dB; -60 to +24 dB |
| Stereo balance | 0 center; -1 left to +1 right; attenuates the opposite channel, not a constant-power pan law |
| Channel mapping | stereo, left duplicated, right duplicated, or averaged mono duplicated to stereo |
| High/low pass | 0 off; high-pass 0–1000 Hz; low-pass 0–20000 Hz; enabled high-pass must be below low-pass |
| EQ | Low shelf 100 Hz, mid bell 1 kHz/Q1, high shelf 3 kHz; each -24 to +24 dB |
| Compressor | Optional; default threshold -18 dB, ratio 3, attack 20 ms, release 250 ms, makeup 0 dB; ranges -60–0 dB, 1–20, .01–2000 ms, .01–9000 ms, 0–24 dB |
| Noise reduction | 0 off; up to 50 dB FFT reduction; no learned noise profile |
| Dehum | 0 off, 50 or 60 Hz; notches at fundamental and two harmonics, Q10, -30 dB |
| Deess | 0 off to 1 intensity; fixed filter settings |
| Limiter | Optional -20–0 dB ceiling |

`item_audio_preset` provides neutral/dialogue/music/sfx/ambience processor presets. These are Agent Cut defaults and replace processors; they do not detect or classify speech. Manual processor edits clear the category label. They are not Premiere Essential Sound presets.

`track_ducking` selects another audio track, threshold/ratio/attack/release. Defaults are -30 dB/4/20 ms/250 ms. Omit the sidechain ID to clear. Control uses the other track's processed **pre-duck** mix, so reciprocal selections cannot form a feedback graph. Muted, absent or empty control contributions bypass ducking. Independent track timing is preserved using full-duration silence anchors for processed mixes. Submix/bus routing, surround mapping, automation recording and plugins remain outside this increment.

`audio_analyze` measures an isolated audio item with local FFmpeg: RMS/sample peak, true peak, gated integrated LUFS and loudness range. It excludes linked transition fades, track/master processing, mute/solo and other items. A requested target -36 to -5 LUFS returns a **proposed** bounded gain operation without changing the revision. The gain estimate can be affected by nonlinear processors and must be rendered and measured again; it is not a broadcast normalization guarantee. Silence/insufficient gated program returns no integrated value/suggestion.

UI: item processors/reset/preset, track mixer/ducking, audio fade controls and measured meters. Evidence: `audio-tests.mjs` measures real rendered gain, stereo balance, channel mapping, EQ, filters, dynamics, hum attenuation, delayed timing and sidechain reduction. `audio-ui-proof.png` is synthetic footage with real measured values.

## Media organization, availability and relinking

`bin_add`, `bin_update`, `bin_delete` manage up to 100 flat bins with 1–80 character names. Deleting a bin clears assignments and retains all media. `asset_update` sets display name, bin, six optional color labels, notes (2000 characters) and up to 20 tags (1–40 characters); tags deduplicate. Source ID/path/content are unaffected. `media_find` requires all case-insensitive query words to match combined name/bin/label/notes/tags; it does not analyze video or speech. UI provides bin filtering, metadata editing and search.

`media_status` checks managed file availability and returns online/offline/unreadable per asset. `media_relink_preview` validates an absolute supported local replacement, hashes its content, probes it, and checks **all sequences'** retained source handles/kinds. It does not copy or commit. `media_relink` requires project/revision, expected plan ID and confirmed plan ID; it checks the source again, copies exclusively into content-addressed managed storage, verifies copied digest/metadata, saves a recovery metadata backup and commits once. A changed source, stale plan, too-short source or incompatible media kind rejects. Existing managed files cannot be overwritten. Undo/redo changes the reference while retaining both sources; failed owned copies are removed. Metadata labels/notes/names and asset IDs persist.

Limits: supported local formats match import, regular files under 4 GB, duration up to two hours; no UNC/URL imports. Proxies, consolidation/transcoding, nested/smart bins and automatic source discovery remain open. Slow hashing/probing runs asynchronously but holds the project write lock during relink review/application. A replacement is not guaranteed perceptually equivalent just because its duration/kind validates.

Evidence: `library-tests.mjs`, `media-management-tests.mjs`, `library-ui-proof.png`. These cover unknown references, search, deterministic plans, persistence/undo, offline recovery, confirmation/revision/content changes, real copied bytes, metadata retention and rejected incompatible handles.

## Groups and attributes

`item_group` groups 2–200 selected IDs and expands linked/existing grouped media. Moves/lifts include the transitive linked/group closure unless `linked:false`; every affected track lock is enforced. Trims/slips/rolls/splits retain their prior linked-only selection semantics. `item_ungroup` clears the group and preserves A/V link identity. Group membership is capped at 200; excessive or overly complex graphs reject. Moving to another track moves the selected item to that destination and shifts other members in their existing tracks.

`item_attributes` selectively copies effects, keyframes, audio processors, mask, blend mode and/or volume from an existing source to specified targets. Missing source attributes clear target values. Source ranges, media identity, placement and grouping are untouched. Incompatible target kinds, duration-stranded keyframes and locks reject atomically; values are not retimed. UI offers copy/selective paste and grouping checkboxes. Clipboard scope is the current project and sequence, and uses the source's current attributes at paste time. Tests cover group movement/lift/lock closure, ungroup identity, source-edit independence, selective replacement, clearing and incompatible paste.

## Export and queue

`render_start` accepts `options` and `queue:true`. It freezes the current project/revision and starts or enqueues up to 20 pending jobs. Jobs execute serially; failure does not stop following jobs. Session-local `render_status` and the UI report queued/rendering/complete/failed. Queue state does not survive server restart. Export does not mutate timeline revisions. Playback preview retains sequence settings and ignores export range; it rejects custom options.

Options: sequence/web720/web1080/master presets; H.264/HEVC MP4 or ProRes 422 MOV; paired even dimensions 160–3840 by 160–2160; paired frame-rate numerator/denominator (1–60000/1–1001, resulting 12–60 fps); CRF 0–51 or video bitrate 100–100000 kbps; AAC 64–320 kbps. Default is H.264/CRF20/AAC192. ProRes uses fixed 422 profile/PCM and rejects CRF/video bitrate. Resizing preserves image aspect with padding. Unsupported options reject before creating a job. Exports honor the active sequence's range.

**Quality scope:** the existing composition pipeline produces an H.264 intermediate. Custom output transcodes that composition; ProRes/Master is a converted output, not lossless source mastering. This build does not implement HDR, color-managed mastering, source-resolution mezzanine composition, persistent queue, cancellation, arbitrary codecs or a general preview-cache manager. Installed local FFmpeg must contain requested encoders; failures are surfaced on the job.

Evidence: `export-tests.mjs` verifies validators, frozen revisions, queue continuation after failure and real H.264/HEVC/ProRes dimensions/rate/codec/range. `export-ui-proof.png` and browser checks verify a real custom output from the dialog.

## Plain subtitles

`subtitle_import` adds `format:srt|vtt`, default SRT. Plain VTT supports WEBVTT header, optional cue identifiers, hours or minute timestamps, multiline text and skipped NOTE blocks. Settings/styles/regions reject instead of silently disappearing. Up to 500 cues/500 KB input/1000 characters per cue, positive cue intervals within two hours and the sequence duration. Import is one undoable revision. UI asks before replacing captions.

`subtitle_export` returns literal sorted SRT/VTT text without writing files or changing the revision; UI downloads it locally. Plain text and timing round-trip to milliseconds; style/layout metadata is outside scope. No transcription, templates, rich graphics or translation is added. Evidence: `subtitle-tests.mjs`, real stdio tool calls and VTT browser import.

## Verification and outstanding work

The final release verification JSON records exact unit/integration, browser, extracted-package smoke and unchanged-project hashes. Browser uses intercepted local HTTP with real Store/Renderer and synthetic assets, not a live TCP connection. Real stdio MCP discovery/read-only/edit tests run against the actual server. One live loopback client check is sandbox-skipped. Actual Codex host reconnection and native Premiere runtime equivalence remain unverified.

The complete original request still requires the items in `remaining-work.md`: native specifications/runtime evidence; nesting/time remap/reverse/freeze and richer transitions; general effect stacks/mattes/tracking/advanced color; rich graphics/transcription decisions; proxies/consolidation; multicam; true mastering/HDR/cache/cancellation; broader productivity and final acceptance. These are not marked complete or silently deferred by this release.
