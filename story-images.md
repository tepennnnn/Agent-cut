# Scene Images — subscription-assisted workflow

Open **Story Studio → Scene images**. This feature prepares and manages image assets; Agent Cut does not log into ChatGPT/Flow, call a provider API, or upload references. Generation in those services requires internet and follows your account's limits. Local speech, composition and export remain offline.

1. Set a style, image format and recurring-character description. Add up to eight character/style reference images. Save a named visual profile to reuse the same settings and references in later episodes within this Agent Cut project.
2. Generate narration from your script, or resume a saved story. Paragraphs define the scene IDs `scene-001`, `scene-002`, etc.
3. Click **Build scene prompts**. These are local templates based on narration, visual briefs, shared settings and references. Review or rewrite each prompt. Rebuilding refreshes templates while preserving edited prompts. A stale indicator flags prompts whose shared settings/brief changed.
4. Choose **Download prompt pack** for prompts, normalized reference PNGs, storyboard.json and a Codex request. A local ZIP is always saved; its path is shown if browser download is canceled. Alternatively, copy individual prompts and attach references in ChatGPT/Flow yourself. **Copy Codex image request** prepares a request for this chat's available image generator, subject to its limits; it does not start generation automatically.
5. Name selected results `scene-001.png`, `scene-002.jpg`, etc. Use `scene-001-v02.png` for another variation. **Import images by scene ID** maps by filename, regardless of selection order. Unknown scene names are rejected before uploads. PNG/JPG/WebP are supported, up to 20 MB each, 60 per import and eight variations per scene.
6. Review thumbnails and click **Approve for scene**. Importing alone leaves the current image in place. Approval changes only the image, keeps narration and caption boundaries, and invalidates the composed preview. Compose again, review and export.

Shared references improve consistency but do not guarantee identical faces or an exact depiction of the narration. Agent Cut groups images by filename; visual review is necessary. No generated image was requested from a provider during acceptance testing; the test footage uses local fixture illustrations.

The older **Add images in order** and **Choose image** controls remain direct-assignment controls. Use the new scene-ID import for a review-before-replacement workflow.

## MCP

The existing `story_sync` tool exposes these actions without increasing the top-level tool count:

- `art_contract`: exact image-action settings and field guidance.
- `art_read`: bounded image plan; default ten scenes, maximum twenty per page, with project/story/art revisions.
- `art_update`: settings, scene briefs/prompts, optional template rebuilding.
- `art_profiles` / `art_profile_save`: local named profiles with revision guards.
- `art_pack`: creates owned prompt/reference files and ZIP; returns absolute local paths and a request for Codex.
- `art_import` / `art_import_folder`: unapproved variations from owned image IDs or a top-level local folder with scene-named images.
- `art_approve` / `art_remove_variation`: select a scene image or remove an unused variation. Approved images require replacement before removal.

Start with `project_read view=summary`. Supply `expectedProjectId` and `storyId`. Read `art_read` for `expectedStoryRevision` and `expectedArtRevision`; stale writes reject. Compact MCP wraps image fields in `artOptions`, while common fields (`storyId`, `expectedStoryRevision`, `path`) stay at top level. Read `art_contract` for the closed runtime contracts. Image metadata increments a separate art revision and preserves an existing composed review. Approval changes the story revision and invalidates that review. Existing project timelines change only through the existing reviewed, backed-up, undoable `apply` action.

## Verification

See `story-images-verification.json` and the `outputs/agent-cut-story-images-demo` evidence directory for the actual browser run, sample ZIP, screenshot and exported MP4. The browser download was canceled in the automated environment; the authenticated local API returned an intact ZIP, and the local-path fallback was verified. No provider calls or uploads were made.
