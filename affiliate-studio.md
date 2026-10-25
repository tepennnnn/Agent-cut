# Affiliate Studio

Restart Agent Cut, then choose **Affiliate Studio** from the editor header or Story Studio. The new workspace is `/affiliate` on your local Agent Cut server.

1. Enter the product name, audience, opening problem and checked product facts (one per line). Add limitations, an optional price note, your affiliate link and a call to action. Edit the spoken disclosure to match your wording.
2. Choose a short portrait video or a longer landscape review. Destination is saved with the campaign; it does not post to that platform. Short templates use up to three facts; longer templates use up to twelve. Duration is estimated at 150 words/minute until real audio is generated.
3. Build script structure. Choose a hook variant, then edit each scene's narration. The builder uses local templates and your text; it does not invent research, visit product pages or call an AI provider. Building again replaces the unsaved scene structure and photo assignments. Edit disclosure in the brief; its scene follows that text.
4. Add your product photos in filename order, or choose one for each scene. Use first photo for empty scenes reuses the first assigned photo. Start with PNG/JPG/WebP stills. Video Prompts & Clips now imports generated footage into measured scenes with preview/apply/undo. Add still-image motion in Scene Workshop.
5. Save campaign. Campaigns have independent revisions and a saved list. Export campaign JSON for a readable copy. It includes image IDs, not embedded media; it is not a portable media archive.
6. Choose Windows SAPI or your configured local Chatterbox voice, caption style, font, speech rate and cut/dissolve transition. Generate narration creates a NEW story draft. Your campaign and previous drafts remain intact. Voice and render choices are selected for each generation; the product brief and scenes are saved with the campaign.
7. Open latest video draft in Story Studio. Listen, adjust scene motion/framing, optionally align words, compose a preview, run quality checks and export the reviewed MP4. The disclosure is spoken and appears in captions. Earlier drafts remain available from the campaign's links. Applying to the editor timeline is still a separate reviewed action.
8. Copy the publishing title and description, which includes the disclosure and your saved affiliate link. Review all claims and current pricing, then publish manually. Links are description text, not clickable overlays burned into the MP4.

Reloading during narration retains a pending job. Finish pending narration job attaches the photos frozen for that generation and exposes its new story. Failed, canceled or interrupted jobs allow a fresh generation; use Cancel narration for a running job. Product/photo changes made meanwhile do not overwrite the frozen generated version. Finishing rejects edited generated stories and altered product image bytes rather than overwriting them.

Campaign limits: 20 editable scenes, 12,000 script characters, 20 retained generated-draft links per campaign. The ordinary story files remain available after a link ages out. Existing speech/model/export limits apply. Missing photos may be added in Story Studio before composition. Installation does not change existing stories or editor sequences, and no new dependency or model is installed.

## Codex / MCP

Start with `project_read view=summary`, then `story_sync action=affiliate_contract`. The existing tool exposes `affiliate_list`, `affiliate_read`, `affiliate_build`, `affiliate_save`, `affiliate_generate` and `affiliate_finish` through closed `affiliateOptions` fields. Supply `expectedProjectId` and fresh `campaignId`/`expectedCampaignRevision` for saved changes and generation. Use existing top-level voice/caption/transition options for generation. Poll `render_status`, then finish with the owned job ID. Review/export the returned story through existing tools. Top-level MCP count remains 39; compact discovery remains within its 24 KiB budget.


Video Prompts & Clips supports Google Flow, Dola/Seedance and Meta AI prompt packs, plus scene-matched local clip imports. Transition controls now provide actual renderer samples and the full catalog. See [video prompts, clip review and transition samples](video-workspace.md).
