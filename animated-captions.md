# Animated captions with captions.js

Agent Cut bundles captions.js 1.10.0 (MIT), Konva 10.9.0 and skia-canvas 3.0.8 locally. No hosted caption server, online font request, API key or cloud transcription is used. The captions.js `renderFrame` implementation is used directly; the browser sample and Node/FFmpeg burn-in share its preset definitions.

## Select a style

Story Studio → Caption style offers 26 captions.js presets plus the existing Clean and Emphasis captions. The sample animates immediately. For an existing story, choose a style, click Save story changes, then Compose preview. Style changes invalidate previous previews/exports until recomposed. Narration need not be regenerated.

The main v2 editor offers the same 26 presets under Titles & captions → Caption preset, alongside its four static presets. Choose Clean or Reset caption defaults to return to static captions. Changes participate in plan/commit/undo. Existing projects and saved stories default to their existing appearance; installation does not change a project.

## Timing and fonts

Existing TTS output has measured phrase boundaries, not measured word alignment. Animated word times are proportional estimates within each cue. The UI and output manifest disclose this limitation. The feature does not claim frame-accurate spoken-word alignment. Scene and narration timing are unchanged.

Preset movement and colors are retained. Original Google Fonts are replaced with approved local Sans Bold or Serif fonts; fonts are served only from the authenticated loopback editor and registered with the same local files in Skia. These are local-font adaptations, not exact replicas of the upstream typography. Font hashes participate in frozen-input validation. Per-cue static typography is retained in the project and becomes effective again when animation is disabled. Plain SRT/VTT includes text/timing, not animation.

Composed previews and exports burn in the animation through the same native v2 render path, including range/draft offsets and nested sequence sources. Titles retain the existing text render path. A second local encode adds animation while retaining the composed audio. This increases rendering time. The existing resource/cancel/cache controls apply; no uncompressed frame sequence is left on disk.

## MCP

- `story_sync action=caption_styles expectedProjectId=...`: enumerate style IDs.
- `story_sync action=generate ... captionStyle="motion:karaoke"`: choose during narration creation.
- `story_sync action=update ... captionStyle="motion:focus-box"`: update an existing draft, with its latest expectedStoryRevision and current imageIds; review is invalidated.
- `sequence_caption_style` operation: `values: {}`, `replace: true`, `motion: "motion:cinema"`. `motion: "none"` or an omitted motion resets to static captions. Read the exact operation contract first. Project identity/revision and normal review safeguards apply.

The project stores only a validated preset ID in `sequence.captionMotion`; arbitrary CSS, scripts, fonts, URLs and provider settings are not accepted. No new top-level MCP tool is added.

## Installation / development

Use the usual start.cmd after restarting Agent Cut. Existing processes must be restarted to load the new build. Reconnect its MCP entry if the old host/session remains attached. Node dependencies are pinned in package-lock.json; native skia-canvas is required for animated exports. Development rebuild: `npm run build:captions`. The checked-in browser bundle is self-contained; the app does not use a CDN.

Upstream: https://github.com/maskin25/captions.js . See THIRD-PARTY-CAPTIONS.md for licenses. Verification evidence is in captions-verification.json and the adjacent agent-cut-captions-demo output directory.
