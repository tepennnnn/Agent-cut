# Story Studio — offline narration, images and subtitles

Build: `chatterbox-local-2026-10-25` · 39 MCP tools.

## Open it

Restart Agent Cut using your usual `start.cmd`, then select **Story Studio** in the editor header. Its URL is the editor's printed loopback URL followed by `/story`. Reconnect the existing Agent Cut MCP connection once to discover `story_sync`; do not register a second server.

## Make a story

1. Enter a title and select portrait (720×1280), landscape (1280×720) or square (1080×1080), all at 30 fps.
2. Paste a script or import a UTF-8 `.txt`/`.md` file. Separate scenes with blank lines. Optional `Scene 1:` labels are omitted from speech.
3. Select an installed Windows voice and rate, then **Generate narration & sync scenes**. On the tested PC, Microsoft David Desktop and Microsoft Zira Desktop are available in English.
4. Assign a PNG/JPG/WebP to each scene. **Add images in order** sorts filenames numerically; use `01.png`, `02.png`, etc. Individual images can be replaced. Images fit inside the canvas with padding, preserving their proportions.
5. Optionally change image end times and save. This changes image timing; the generated narration and captions retain their audio timing.
6. **Compose preview** and watch the actual image, audio and subtitle composition. **Export reviewed MP4** saves a protected export without changing the editor timeline. Save WAV narration and SRT subtitles separately when needed.
7. Optionally **Add story to editor as a new sequence**. This preserves existing sequences, saves a recovery backup and makes one undoable project change. Legacy projects require the explicit sequence-upgrade checkbox. Nothing migrates merely by generating, previewing or exporting a story.

Saved drafts can be resumed from the header selector. Changing a script or voice and generating again creates a new draft. Changing image assignments or timing invalidates the reviewed preview, so compose it again before export/apply.

## Timing and limits

The local Windows SAPI engine generates short speech phrases, up to nine words each. Actual PCM lengths determine each caption and scene interval; no words-per-minute estimate is used. Speech phrases are synthesized separately, so pauses/prosody differ from a single uninterrupted neural narration. Captions are phrase-based, not word alignment or animated karaoke.

Windows TTS uses existing Windows voices with no API key or provider call. Optional [local Chatterbox](chatterbox-local.md) adds downloaded-once Nano/Turbo models and imported voice references; generation stays offline. It does not generate images, animate characters, or reproduce the reference video's animation. Languages and voice quality depend on installed SAPI voices. Windows TTS requires Windows; the optional Chatterbox worker uses its configured Python runtime. FFmpeg requirements are unchanged.

Limits: 12,000 script characters, 60 scenes, 500 caption phrases, 20 minutes of generated narration; PNG/JPG/WebP up to 20 MB and 24 million decoded pixels. Use multiple stories for larger projects. Images are normalized to a bounded PNG and encoded into owned still-video sources that existing timeline tools can edit. Original uploads are not required after import.

## Codex workflow

Read `project_read view=summary` first. Call `story_sync` with `expectedProjectId`:

- `voices` → installed voice IDs; `generate` → owned job; poll `render_status` for `storyId`.
- `list` / `read` → saved drafts and their own revisions, scenes and captions.
- `image` with an absolute local PNG/JPG/WebP path → image ID.
- `update` with `storyId`, `expectedStoryRevision`, one `imageIds` entry per scene (null for unassigned), and optional ascending `boundaries` → updated draft. Boundaries omit the fixed start/end.
- `preview` requires both project and story revisions. Poll `render_status`, then review its actual MP4. It returns `review.planId` and `review.jobId`.
- `export` requires `storyId`, `expectedStoryRevision`, `confirmPlanId` from review. It exports that frozen story, even if another editor sequence is selected later.
- `apply` requires the base project revision and `confirmPlanId`. Set `allowMigration:true` only with user authorization for a legacy project's identified upgrade. It returns the retained project, new sequence ID and recovery backup.

`job_control` supports status/cancel/retry for generation, preview and export. Retrying completed narration creates a new draft instead of overwriting image assignments in an existing one. Stale story revisions, stale project apply, missing images and changed frozen media reject before a timeline commit. Sources and fonts use the editor's existing fingerprint checks.

Example instruction: “Use Agent Cut Story Studio. Generate offline English narration from this script, with a blank line between scenes. Assign the images in C:\Stories\Episode01 in numbered order. Compose a portrait preview and export an MP4 after I review it. Keep my current editor sequence.”

## Verification

See `story-verification.json` for the current run. Real Windows speech generation and real FFmpeg composition/export are tested on isolated data, including preservation of a nonempty legacy edit, explicit backup/apply, exact undo, draft reload and safe narration retry.

Desktop/mobile browser acceptance exercises the actual compact MCP server over stdio. Browser HTTP requests are intercepted and forwarded to those real tools because this session blocks loopback TCP clients. Generation, per-scene/batch images, null assignments, preview, export, reload and mobile overflow checks passed with zero external browser requests and no page errors. Live TCP authentication/ranges and already-open host activation require a normal desktop restart; a screenshot alone is not evidence of that activation.

Caption style can be changed before generation or on a saved story. Choose a preset, Save story changes, then Compose preview. 26 captions.js styles are available alongside Clean/Emphasis, with an animated sample and offline local fonts. Word-level animation uses estimated timing within measured phrase boundaries. MP4 preserves animation; SRT contains only text and cue times. See animated-captions.md.

Scene transition and Duration control image blends around existing scene boundaries. Narration, subtitle timestamps and final duration remain unchanged. Select Cut for straight cuts; shorter scenes may require a shorter transition. WGFX choices are adapted recipes with disclosed differences from Adobe rendering. Save story changes, then Compose preview after changing a transition. See wgfx-transitions.md.

Search transitions filters the 257 scene-transition choices without changing the selected preset. FFmpeg entries use native rendering; GL entries use original shaders in a headless local Chrome/Edge process. No media is uploaded. Save and compose again after changing a preset. See transition-library.md.

Scene Images now adds subscription-assisted image prompts, reusable visual profiles, reference-image packs, explicit variation approval and scene-ID imports. See [Scene Images workflow and MCP contracts](story-images.md). Generation runs in your selected external service or through an explicit request to Codex; Agent Cut itself never uploads references or calls a generation API.

New narration now generates complete sentences instead of restarting TTS every nine words. Captions remain short, balanced groups with estimated timing inside measured sentences. Existing saved stories and frozen legacy jobs keep their previous timing. See [sentence generation, limits and comparison](sentence-narration.md).

Caption font is now independent of caption animation. Ten bundled typefaces plus the three existing system fonts are available, with a live sample. Existing stories keep their current font by default. Select a font, save story changes, then compose a new preview. See [font choices, offline assets and usage](caption-fonts.md).

Narration / Replace & resync now prepares a reviewed audio/timing replacement with explicit apply and backup/undo. An optional offline English acoustic aligner supplies word timing for animated captions. Proportional estimates remain separately labeled. See [replacement, word alignment, setup and limits](narration-resync.md).

Scene Workshop adds seven image motion presets, fit/fill and focal positioning, reviewed single-scene/sentence narration regeneration, reviewed image replacement and pre-export quality checks. See [Scene Workshop workflow and limits](story-workshop.md). Installation preserves saved stories and existing editor sequences; restart Agent Cut to load the new build.

Video Prompts & Clips now adds Flow, Dola/Seedance and Meta prompt packs, silent clip imports by scene filename, reviewed replacement and undo, plus actual transition samples. See [video workflow and limits](video-workspace.md). Provider generation stays external and manual; footage can now replace still-image scenes inside the story draft.
