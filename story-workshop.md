# Scene Workshop

Open Story Studio, load a saved story, then use **Scene Workshop**. Changes here affect that story draft. Your existing editor sequence changes only through the separate reviewed sequence apply action.

## Motion and framing

Choose a scene and preview Still, Zoom in, Zoom out, Pan left, Pan right, Pan up or Pan down. Fill crops the image to the canvas; Fit retains the whole image. Click the source preview or adjust horizontal/vertical focus to position the subject, then adjust zoom and motion strength. These are manual focal controls, not automatic subject tracking. Save the selected scene or copy its settings to all scenes. Compose preview renders the actual moving images with captions and narration. The canvas sample demonstrates a five-second movement; exported motion spans the scene duration.

## Replace selected narration

Choose Whole scene or one sentence. Keep its text to regenerate delivery, or edit that selected text. Generate a candidate, listen/watch, then explicitly apply it. Preparation does not change the saved story. Other audio spans are retained; later scene and subtitle times shift by the exact duration difference. Existing images, caption style and font are preserved. The saved local voice is used; the MCP contract also accepts a different configured voice, engine or rate.

Sentence selection requires script text to match the current subtitle text and boundaries to coincide with cue boundaries. Ambiguous selections reject rather than cutting through a shared subtitle. Replacement text is limited to 4,000 characters, the full story to 12,000 characters, 500 captions and 20 minutes. Optional local English word alignment runs on replacement segments up to 120 seconds. Estimated timing remains explicitly labeled when acoustic alignment is unavailable; low-score candidates require listening and acknowledgement before apply.

The latest scene or visual change has an integrity-checked backup and Undo. Undo rejects if later unrelated edits would be lost or original media changed. It restores the story draft, not an already-applied editor sequence. Narration candidates are private job assets, not duplicate public stories.

## Replace one image

Import a new image variation for the selected scene. Preview stages it without approving or replacing the current scene image. Apply only after reviewing the composition. Other scenes and narration stay unchanged.

Generate image request copies a single-scene instruction with local reference paths for Codex. Paste it into the chat and explicitly request generation. Agent Cut itself does not call an image provider or upload references. Outputs are imported as unapproved variations before review. Existing Scene Images prompt packs and identity/revision guards still apply.

## Before you publish

Check export quality reports missing or unreadable media, invalid scene timing, excessive transitions, silent narration, long quiet spans, repeated full-scale peaks, caption fit/glyph problems, estimated word timing and stale art prompts. Fit framing and strong zoom can produce informational warnings. Fix blockers before exporting; warnings allow export after review. Story export automatically repeats the checks on its frozen reviewed inputs and rejects changed media/fonts.

Caption checks cover every static cue. Animated checks sample up to 60 mid-word frames; they do not inspect every animation frame. Audio checks measure signal properties, not pronunciation or storytelling quality. Listen and watch the complete preview before publishing.

## MCP

Use `story_sync action=creator_contract` for the current contract. Actions are `creator_read`, `creator_visuals`, `creator_image_request`, `creator_voice_prepare`, `creator_image_prepare`, `creator_plan`, `creator_apply`, `creator_undo`, `creator_preflight` and `creator_report`. Pass options in the closed `creatorOptions` object. Reads are paginated; edits require fresh project/story identities and story revision. Prepare returns an owned job; poll `render_status`, inspect `creator_plan`, then supply its `confirmPlanId` to apply. Quality reports are paginated by job ID. These actions extend the existing tool; top-level MCP tool count remains 39.

All motion, audio composition, voice inference, alignment and export checks run locally using the existing installed runtimes. Existing running servers need a restart to load this build. No user story is automatically migrated or edited by installation.
