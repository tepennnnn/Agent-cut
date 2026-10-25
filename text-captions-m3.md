# Phase M3 — timed titles and caption styling

Build: `text-captions-m3-2026-10-19`. This increment implements M3-01 through M3-04. Automatic transcription, transcript correction and speech-derived caption generation remain M4; editorial recipes remain M5. No model or font is downloaded or redistributed.

## Using the editor

Restart Agent Cut and reconnect its Codex MCP connection to load this build. Check the build/data-root diagnostics under **Connect to Codex**. Existing projects retain their schema and content. A v1 project needs the existing reviewed, backed-up track upgrade before using the v2 text controls; this increment does not migrate user projects.

The track workspace now includes **Titles & captions**. Add a timed title, edit its text/timing/stack index, choose a preset or customize its style. Edit caption text/timing directly, set sequence caption defaults, or override/reset an individual cue. Four original static presets are supplied: clean, emphasis, headline and lower third. Font/size/color/background/alignment/position/width/safe-margin/padding controls use the same typed operations as Codex.

Titles paint above video and adjustments, in explicit bottom-to-top order, then captions paint above titles. Titles and captions belong to the sequence, separately from media-track locks. Their intervals must fit within the media duration. Title/caption edits persist, can be previewed as candidate plans, and undo/redo exactly. Plain SRT/VTT export omits titles and styling and explicitly reports that omission; imports remain plain timed text.

Range-cut controls offer **retain absolute caption times** or **retime** and a separate title policy. Retain may reject if the shortened sequence would leave text outside its duration. Retime clips removed portions; a ripple joins surviving portions of the same cue, while a non-ripple removal splits crossing text into fresh IDs around the gap. Inserting a gap splits crossing text and shifts later text. Styles are preserved. Styled-text range edits require explicit policies, including insert/overwrite placement. `regenerate_draft` explicitly rejects until the later speech phase; it never invents a transcript. Ordinary clip trims/moves/transitions retain absolute text timing; coordinate any desired text changes in the same reviewed operation batch.

## Model and tools

The additive v2 model contains optional sequence `captionStyle`, optional cue `style`, and optional `graphics[]` of literal timed text. A graphic contains `id`, `text`, rational `start/end`, `style` and contiguous zero-based `order`. Limits: 1,000 UTF-16 text units/item, 200 graphics and the existing 500 non-overlapping captions. Invalid control bytes, malformed Unicode, unknown style fields and external/path-based font choices reject. Legacy projects with no new fields remain compatible; legacy flattening refuses styled text rather than discarding it.

Four shared operation contracts are added: `graphic_text` (create/update/reorder), `graphic_delete`, `sequence_caption_style`, and `sequence_text_retime`. `sequence_caption` accepts a style override or `clearStyle`. Cut/gap/insert/overwrite contracts accept caption/title timing policies. All mutation identity/revision/plan guards remain unchanged. `project_read` supports `view: window, detail: text` for bounded, revision-bound title/caption reads, selected text IDs and caption defaults. Summary counts include captions and graphics. Fetch exact schemas with `timeline_operations`.

`editor_info.text` lists local font availability, SHA-256 identities, presets, coordinates and limits. There are still 34 MCP tools; compact discovery remains within 24 KiB. The UI captures the selected font digest in styles; agent callers can do the same. Render metadata and persisted job requests snapshot actual local font identities. Changed pinned fonts or changed fonts during retry reject; preview caches include font identity.

## Font and layout contract

Only enumerated local fonts are used: sans, sans bold and serif (Arial, Arial Bold and Times New Roman on Windows; the corresponding enumerated DejaVu files on Linux). Font paths are not accepted from text operations. Missing selected fonts use the approved local sans fallback with a visible warning; if no approved font exists, rendering fails with a local repair message. Unsupported glyphs are reported in preview/job metadata, and the UI displays warnings. Font coverage and complex-script shaping depend on the installed font/encoder; the verified Unicode cases include accented Latin, Greek and Cyrillic, not a promise of every script or emoji.

Style colors are literal `#RRGGBBAA`. `x/y/width` are canvas fractions; `size`, `safeMargin` and `padding` are fractions of canvas height. Defaults place white captions in the lower region with dark translucent backing and a minimum 5% height-relative safe margin. Wrapping uses the selected local TrueType advance metrics. Text preserves explicit line breaks, wraps long words, and may shrink to fit up to twelve safe-area lines, down to 1.2% of reference canvas height. Text that still cannot fit rejects rather than truncating. Layout is calculated against the sequence's reference canvas before draft scaling, keeping line breaks stable between previews and exports. Drawtext receives local text files with expression expansion disabled; text is never interpreted as markup or filter code.

Titles work inside ordinary live nested sequence sources in full composition, including font provenance. Structural selection nesting/expansion of styled sequences rejects explicitly because flattening would change text coordinates/default inheritance. The M2 bounded nested-source preview restriction remains: use the explicit full composed controls for nested media.

## Verification and evidence

Focused tests cover strict schemas, bad colors/fonts/Unicode, bounds, state persistence and exact undo; explicit cut/gap policies; plain SRT/VTT round trips and omission metadata; local fallback, missing glyphs, overflow and frozen-font retry guards. Real encoding tests verify safe text bounds in landscape/portrait/square, native-range/full pixels, title order, captions above titles, and text in live nested sources. A real stdio MCP test exercises candidate preview without mutation, reviewed application, bounded text reads, plain export and exact undo on synthetic media.

The browser regression uses actual Store/Renderer on synthetic footage with external requests blocked. It verifies manual title creation against the shared typed operation, local font digests, caption editing/presets/overrides/reset, portrait composed preview, explicit cut policies, deletion confirmation and undo. All previous browser workstreams remain checked. The full source and extracted-package results, code/project hashes and benchmark measurements are recorded in `../capcut-roadmap/m3-completion.json`. A portrait UI proof is `../premiere-phase1/text-workspace-ui-proof.png`; standalone composed examples and timings are in the roadmap folder.

Live loopback HTTP and creation of a physical junction fixture remain sandbox-limited checks, visibly skipped rather than counted as passes. User-host activation, real-footage acceptance and any approved migration remain M6 checks. User footage, project files and configuration are not changed by these synthetic checks or code-only promotion.
