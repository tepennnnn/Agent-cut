# Advanced timeline: live nested sequence sources — 2026-10-18

This increment adds bounded nesting to the existing v2 model, command layer, renderer and UI. It does not automatically migrate or edit any saved user project. Time remapping and full original-version parity remain unfinished.

## Contract

`sequence_nest(sequenceId,sourceSequenceId,trackId,time,includeAudio?)` places an existing nonempty source sequence on a parent video track. It creates or reuses a library asset with `kind:sequence`, a source sequence ID and derived duration/canvas metadata. There is no source file path. The parent gets a normal media item and, by default, linked stereo audio on a new audio track. `includeAudio:false` omits that companion. Normal item effects, source trim, movement, split, constant speed, freeze and bounded reverse apply to the rendered source. This is placement of a whole existing source sequence; it does not convert an arbitrary selection of parent items into a new child sequence.

The graph permits at most four sequence levels and rejects self/indirect cycles. All references must exist; source duration must be at least .01 timeline seconds; track/kind/lock/source/timeline limits still apply. Cached virtual-source metadata is derived from child tracks after an edit batch, then validated. Changes to child dimensions/duration refresh that metadata. Existing parent source ranges remain explicit: a longer child does not automatically extend a parent clip; a shorter child that strands retained parent source ranges rejects the batch. Child and parent trims can be repaired together in one atomic batch. Child edits are live references and affect every use in the next render.

`asset_remove(assetId)` removes an **unused library reference**, not its source file or source sequence. All uses across all sequences must be lifted first. It is destructive and requires the reviewed plan confirmation; undo restores the reference. Managed media remains on disk for undo/history. Remove unused virtual assets before clearing their source sequence; an empty referenced source is invalid.

Both commands use deterministic plans/allocated IDs, project/revision guards, the shared schema registry, complete-project validation, atomic persistence and undo/redo. No data folder migration or separate state store was added.

## Rendering

Nesting freezes all sequences/assets with the parent render's project revision. The child is rendered once per unique source sequence within that job and reused by its video/audio contributions. The child's saved export range is ignored; its full program duration supplies the source. The parent's own export range still governs final output. Deeper references use the same job-local cache. Besides the existing 64 active contributions per individual sequence, nested rendering caps the total at 256 active contributions across unique rendered sequences. Failure is explicit; no recursive loop or silent flatten-to-another-source fallback is allowed.

**Scope and quality:** the child is an opaque SDR H.264/AAC composition with black gaps and stereo audio. Parent/child transparency is not preserved. Captions/effects/mixing inside the child are baked into that source; parent effects/captions apply afterward. Each nesting level can add another lossy encode and another master-limiter stage. This is not lossless/HDR mastering, a multichannel/submix bus, or a source-effect passthrough graph. Derived intermediate files remain in exports directories; cache cleanup remains open.

The legacy adapter refuses projects containing sequence sources and routes them to native composition. File-only operations cannot reinterpret a sequence as a local path. `media_status` reports virtual sources as sequence references and checks real file assets separately. Relinking a sequence asset rejects with guidance to edit the source sequence. Isolated `audio_analyze` on a nested item rejects; open its source sequence and measure the underlying audio items directly. Silence detection similarly requires an original file asset.

## Manual controls

The timeline toolbar adds **Nest sequence**, with source sequence, destination video track, parent start and linked-audio controls. The inspector adds **Open source sequence** for nested items. The library identifies sequence sources, hides file relinking for them, and provides **Remove unused asset** with the same reviewed destructive policy. Existing sequence picker, track controls and undo remain shared typed operations. Lower-track scroll position is preserved during inspector refresh, keeping selected nested clips visible. Library counts identify sources, including virtual sequence references.

## Evidence

`nesting-tests.mjs` covers references, cycles/depth, locks, cached metadata, invalid child shortening, atomic child/parent repair, removal of unused references, deterministic plans, persistence/reopen and undo/redo. Real FFmpeg tests prove child video/audio output, live child-effect propagation, full child duration despite its saved export range, shared child render caching, nested reverse, three rendering levels and the total-contribution limit.

The browser workflow exercises the nesting dialog, linked child placement, a real composed frame, opening the source sequence, undoing navigation/nesting and removing/restoring unused library media. `nesting-ui-proof.png` uses synthetic footage. The release verification records whole-suite/browser/extracted-package checks and unchanged saved-project hashes. One live TCP client test remains sandbox-skipped; actual host reconnection is separate from protocol tests.

Native REA inventory/ledger evidence and their original-runtime unknowns remain unchanged. This is a scoped Agent Cut implementation and test record, not proof of Premiere 22 factory defaults or full nesting semantics. Native selection-to-nest behavior, transparency, mastering and automation equivalence remain open.

## Remaining timeline work

Time remapping/speed ramps, selection-to-nest/unnest, richer transition alignment/defaults, structural editing through transitions/adjustment layers, and original-runtime comparisons remain open. The complete backlog is still tracked in remaining-work.md; this increment does not mark that backlog complete.
