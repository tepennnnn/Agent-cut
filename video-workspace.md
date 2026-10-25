# Video Prompts & Clips and transition samples

Restart Agent Cut to load build `video-workspace-2026-10-25`. Both Affiliate Studio and Story Studio have **Video Prompts & Clips**. Existing stories and image approvals are not changed by installation.

## Make the prompts

In Affiliate Studio, save a campaign, then choose Google Flow, Dola / Seedance 2.0 or Meta AI. Adjust camera direction, lighting, look, product continuity and additional direction. Build video prompts produces a scene-by-scene pack using the script and scene roles. Before TTS generation, timings use your desired duration. After generation, the pack includes measured scene coverage, exact scene IDs and `scene-001.mp4`, `scene-002.mp4` filenames. The affiliate panel uses the campaign's latest generated draft; earlier drafts can be opened directly in Story Studio.

Copy a scene prompt or download the JSON pack. You can edit an individual prompt before copying or downloading it. Rebuilding or changing the global direction replaces the in-memory prompt edits; download the edited pack to retain them. Campaign direction is saved when you build prompts. Story Studio direction is remembered locally in that browser for the selected story. Narration, captions and the editor sequence are untouched by prompt building.

Flow prompts include subject, visual action, camera start/end, lighting, product continuity, framing, silent-audio instructions and manual reference guidance. Dola prompts avoid assuming that every Seedance reference feature is exposed in your app. Meta prompts use a more compact image-animation form. These are local prompt templates; Codex can refine them using the existing MCP actions. They are not provider APIs, factual research or a guarantee of generator output.

Attach the actual product or approved scene image in the external app. Story prompt packs also list saved character/style reference paths when present. Prefer a clean product reference for accurate geometry. Provider lengths, available models and reference modes must be selected in your own provider UI. No media is uploaded by Agent Cut and no account credits are spent by these controls. Generated providers may still return audio despite the prompt; import removes it.

Guidance checked on 2026-10-25: [Google Flow](https://support.google.com/flow/answer/16353334?hl=en), [Seedance 2.0](https://seed.bytedance.com/en/seedance2_0), [Meta Vibes](https://ai.meta.com/vibes/). Flow's instructions describe subject/action/environment/lighting/style and ingredients/start/end frames; Seedance describes multimodal references, while Dola controls may vary. Meta offers video generation/image animation. No fixed duration or resolution entitlement is assumed.

## Import and review footage

Generate narration first to enable imports for real scene IDs. Import one clip for the selected scene or a batch named `scene-001.mp4`, `scene-002.mov`, etc. All batch names are validated before uploading. A successful partial batch import is retained locally if a later upload fails; the saved story still stays unchanged.

MP4/MOV/M4V/WebM inputs must be local, 0.1–120 seconds, at most 300 MB and at most 24 megapixels. Files are copied into the owned media namespace and normalized to silent H.264, 30 fps, with the long edge bounded to 1920 pixels. Original external files remain intact. Imported clip IDs are staged locally per story in that browser; they are not automatically approved.

Choose a source in point, Fill (crop) or Fit (bars), and what happens if the clip is short: Hold final frame or Loop. Loops are limited to 15 seconds of remaining source and a 768 MiB decoded-frame estimate to bound memory. Footage is not automatically sped up or slowed down. Longer clips are trimmed for scene coverage, including transition overlap handles; short clips hold or loop for those handles too.

Prepare clip preview creates a private candidate with the current narration and captions. Review it, then click Apply reviewed clip change. If another scene lacks both an image and a video, review shows the selected silent clip only and clearly labels that limitation; complete the remaining visuals for a full composition. Applying preserves narration, caption timestamps, scene boundaries and fallback image assignments. The current scene uses video until you preview/apply Return to image or explicitly replace its image. Image pan/zoom controls apply to still-image scenes, not video footage.

Undo latest scene change restores the latest compatible Workshop change with integrity/source checks. Later conflicting edits reject restoration. Replacing narration keeps video assignments, so review any hold/loop warnings after timing changes. Original/imported video bytes and render inputs are checked before reviewed apply/export. These edits affect a story draft; adding it to the editor timeline remains a separate reviewed action.

## Preview transitions

Story Studio and Affiliate Studio now show an actual rendered sample below their transition controls. Choose a style and duration: a visible sample updates after a short debounce. Preview transition starts/replays it. Samples use two local test images at 320×180 and 30 fps; they demonstrate the renderer and selected overlap duration, not your story content. Cut is a straight join. All 257 transition choices remain available, including adapted WGFX, native FFmpeg and original GL shaders. GL samples require the existing local Chrome/Edge runtime.

First rendering may take a few seconds. No story save or timeline mutation occurs. Six completed transition samples have a separate 128 MiB cache; browsing transitions does not evict ordinary reviewed story previews. Expired samples can be rendered again. Compose your story to review how a transition looks with your actual footage, framing and captions. WGFX presets retain their existing adaptation disclosure.

## Agent tools

Top-level tool count remains 39. Through `story_sync`:

- `affiliate_video_settings` saves `affiliateOptions.videoSettings` with campaign identity/revision guards. `affiliate_video_prompts` builds campaign prompts, optionally using a generated `affiliateOptions.storyId` belonging to that campaign.
- `video_prompt_pack` uses `storyId` and `creatorOptions.videoSettings`, offset and limit (at most 20 scenes per page).
- `video_import` uses an absolute local `path`. `video_read` uses `creatorOptions.clipId`.
- `creator_video_prepare` requires fresh story revision and `creatorOptions.sceneId`, clipId, sourceIn, clipFit and endMode. `clearVideo:true` stages a return to an existing fallback image. Poll the owned job, inspect `creator_plan`, then use `creator_apply` with its plan ID. `creator_undo` restores the latest scene change.
- `transition_sample` uses existing transitionKind/transitionSeconds fields. Poll `render_status` for its sample MP4.

Use `project_read view=summary` first. Read `affiliate_contract` and `creator_contract` for fields and guards. Unknown option keys, invalid clip ranges, changed media, stale plans and mismatched projects reject.
