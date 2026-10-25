# Narration replacement and acoustic word alignment

Story Studio includes **Narration / Replace & resync**. It can prepare new timing for a recording of the same script, or align the current narration without replacing its audio. Preparation does not change the saved story. A separate **Apply reviewed narration resync** action changes the draft after review; **Undo narration resync** restores its previous content.

## Use

1. Restart Agent Cut after installing this build, then open the saved story in Story Studio.
2. Select replacement WAV/MP3/M4A/FLAC/OGG narration. Alternatively select **Keep current narration and align its words**.
3. Choose **Audio-based word alignment** for English speech up to 120 seconds. The local runtime/model must be configured. The explicitly labeled **Proportional estimate** option supports up to 20 minutes but does not measure word positions.
4. Select **Prepare resync preview**. Review the proposed audio, composed video when all scene images are assigned, and before/after scene times. Expand **Aligned word times** to seek the audio by word. The first 100 word times are shown; review the full narration in the video. Low-score word buttons are highlighted. Scene timing tables read all bounded result pages.
5. If the acoustic model flags low-score words, listen and explicitly accept the warning before applying. A poor overall audio/script match fails instead of inventing a successful alignment.
6. Apply the reviewed resync. Images, scene/caption IDs, caption text and per-cue styling, shared art settings, font, animation and transition selection are retained. Compose/export again from the updated draft.
7. Use **Undo narration resync** to restore the earlier draft. This restores the original audio, duration, scene boundaries, subtitle timing and styling. Meaningful edits made after applying prevent this undo from silently discarding them. Composing a preview alone does not block undo.

This changes the story draft. Existing editor sequences remain unchanged; use the existing reviewed **Add story to editor** workflow to add the updated story as a new undoable sequence. No automatic project migration or timeline replacement occurs.

## What alignment means

The optional local Wav2Vec2 base-960h acoustic model and torchaudio 2.6 CTC align the known script to the audio. Word boundaries come from acoustic frames, rather than being distributed proportionally across a cue. This is machine alignment, not guaranteed ground truth. The same script must be spoken in the narration; it does not rewrite or transcribe a different story. Numbers should be written as spoken English words; unsupported tokens reject clearly.

The adapter compares a greedy acoustic transcript with the script as a mismatch check. Its similarity and token scores are quality indicators, not calibrated accuracy percentages. Low-score words require explicit review. No automatic silence removal or speech-speed change is performed.

Measured word times feed animated captions in composed previews and MP4 export. Static captions and SRT use the aligned cue boundaries. Alignment is independent of font/animation selection. The renderer verifies the bound narration asset and its bytes; edited captions, altered narration bindings, speed changes or stale audio cannot silently claim the original acoustic word times. Changed cues/bindings use explicit estimates, reported in render metadata. Retiming a caption therefore requires a new alignment to recover acoustic word timing.

## Offline runtime

This setup uses the existing Chatterbox Python environment's torch/torchaudio 2.6.0. The English base-960h model was installed separately in `outputs/agent-cut-runtime/alignment/`; it is approximately 360 MiB. Its official source, byte count and SHA-256 are recorded in that folder's installation.json, with the upstream MIT license. The adapter pins the official checkpoint hash, loads weights with `weights_only=True`, and blocks network socket operations. Neither alignment nor generation downloads a model at runtime or uploads narration.

Setup fields accept an existing Python interpreter, local model path and 1–4 CPU threads. Model, interpreter and worker identities are frozen and verified. A changed runtime/model requires explicit reconfiguration; interrupted jobs require an explicit retry. Acoustic inference uses bounded 20-second windows to limit attention memory, then aligns the complete script to the combined emissions. English clips beyond two minutes should be split into shorter stories for this version.

References: [torchaudio CTC forced alignment](https://docs.pytorch.org/audio/2.6.0/tutorials/ctc_forced_alignment_api_tutorial.html), [base-960h model and license](https://docs.pytorch.org/audio/2.6.0/generated/torchaudio.pipelines.WAV2VEC2_ASR_BASE_960H.html).

## Agent tools

The existing `story_sync` tool provides `sync_contract`, `sync_status`, `sync_configure`, `sync_prepare`, `sync_read`, `sync_apply` and `sync_undo`. Read `sync_contract` for action fields, supplied under `syncOptions`. Use the current project ID, story ID and story revision. `sync_prepare` accepts an absolute local audio `path`, an uploaded owned `audioId`, or `useCurrent=true`.

Preparation returns an owned `story-resync` job. Poll `render_status`, then read its `planId` using `sync_read confirmPlanId=...`. Reads paginate at 20 records; check coverage. Apply uses that plan ID and the current story revision, with explicit `acceptLowConfidence` when required. The plan, original narration, replacement audio, composed source/font/transition inputs and backup integrity are checked before mutation. The top-level MCP tool count remains unchanged.

## Evidence

See story-resync-verification.json and outputs/agent-cut-resync-demo. Real offline inference aligned all 46 words of the saved sample script to the revised 17.04-second narration, using the same scene images and caption style. Audio/script acoustic-transcript similarity was 1.0 in this test; this is not a general accuracy guarantee. The real composed preview/export used acoustic timing for all eight cues. UI acceptance covered upload, review before apply, audio word seeking, video playback, apply, export, undo, mobile layout and zero external browser requests. Tests ran on isolated copies; the user's original story and project stayed unchanged.
