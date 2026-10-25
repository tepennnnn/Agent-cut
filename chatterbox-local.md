# Local Chatterbox speech in Agent Cut

Chatterbox is an optional Story Studio engine alongside the existing Windows voices. This integration runs a separate local Python worker; scripts and voice references are not sent to a speech provider. It uses the same generated-audio timing, scene images, subtitles, preview, export, and optional new-sequence workflow as Windows TTS.

## Use it

1. Restart the existing Agent Cut editor and reconnect its existing MCP entry after this upgrade.
2. Open **Story Studio**, then select **Chatterbox · local AI voice** under **Speech engine**.
3. Choose the built-in voice, or import a clean English voice reference of 5.1–30 seconds (WAV, MP3, M4A, FLAC or OGG, up to 30 MB). Imported references remain in the local profile and appear in the voice dropdown. Use a voice you have permission to use.
4. Enter the script with blank lines between scenes and generate narration. Add scene images, compose a preview, then export the reviewed MP4/SRT or add it as a new sequence.

**Local Chatterbox setup** shows the Python interpreter, model directory, Nano/Turbo choice, auto/CPU/CUDA device and 1–4 CPU threads. **Check & enable local runtime** validates existing files and saves this profile's settings. It never installs packages or downloads models. A failed or missing setup leaves Windows voices usable. Chatterbox failures are reported rather than silently substituting a different voice.

## Runtime and offline behavior

The installed external runtime lives outside the app source under `outputs/agent-cut-runtime/chatterbox`. Source upgrades preserve it. Python dependencies and model checkpoints require an explicit initial download; generation then loads checkpoints with `from_local`, sets Hugging Face/Transformers offline mode, disables telemetry and rejects Python socket connections/DNS. Upstream Perth watermarking stays enabled. Temporary/JIT files are kept in owned local job directories.

The initial installed model is Nano (English), chosen for a smaller local footprint. Turbo (English) is supported through a separately installed compatible local checkpoint directory. Multilingual Chatterbox, online providers and automatic model downloads are not part of this adapter. The selected device and actual runtime versions are recorded with each generated story. Automatic selects CUDA when available; choose CPU explicitly if a GPU job runs out of memory.

One job loads the model once for all script phrases, then releases its worker. Generation uses the existing persistent queue, progress reporting, cancellation and explicit retry. Chatterbox speech workers have a 6 GiB resident-memory budget; other jobs retain the existing 2.5 GiB budget. The system free-memory guard remains active. Runtime/model fingerprints and reference-audio SHA-256 detect changed frozen inputs before retry. Reconfigure after an intentional runtime or model update.

Caption/scene timing uses the generated WAV lengths. This is phrase timing, not forced word alignment. Short phrases can introduce audible pauses; speech rate applies a local FFmpeg tempo adjustment and timing is recalculated from that resulting audio. Model output may need listening/review for pronunciation or unwanted speech before publication.

## Codex tools

The existing `story_sync` tool accepts `engine:"windows"` (default) or `engine:"chatterbox"`; tool count stays at 39.

- `tts_status`: inspect readiness and saved/default local settings.
- `tts_configure`, with `settings:{pythonPath,modelDir,model,device,threads}`: validate and enable installed local files. Unknown setup keys reject.
- `voices`, with `engine:"chatterbox"`: built-in voice ID `builtin` and imported reference IDs.
- `voice_import`, with `path`: copy/normalize a local reference and return its voice ID without changing the project timeline.
- `generate`, with `engine:"chatterbox"` and `voice`: create the narration job. The remaining script/title/shape/rate/caption-style fields are unchanged. Poll `render_status`; use the returned story ID with the existing read/update/preview/export/apply workflow.

All calls require the current `expectedProjectId`. Setup and reference imports are profile preferences/assets, not timeline mutations. Generation, preview and export leave the current project intact. Existing project migration/apply requirements remain in force.

## Recreating the runtime

Use a dedicated Python 3.12 environment rather than changing a shared Python installation. The implementation was prepared against Chatterbox source commit `5de7a54aa4e5e2baadb0182dde554908b48b85c2` and Nano model revision `71ccd1d0081b430592cea481f4307e764e07bc64`. Keep upstream MIT notices. The installation record and requirements lock in the runtime folder record the actual dependency versions and artifact hashes used on this PC.

The Nano directory needs `ve.safetensors`, `t3_nano_v1.safetensors`, `s3gen_meanflow.safetensors`, `conds.pt`, `merges.txt`, `vocab.json`, `tokenizer_config.json`, `special_tokens_map.json` and `added_tokens.json`. Turbo substitutes `t3_turbo_v1.safetensors`. Select these existing files through local setup after installing compatible PyTorch, torchaudio and Chatterbox dependencies. Use the NVIDIA-compatible PyTorch build for CUDA; a CPU build cannot use the GPU merely by selecting CUDA in the UI.

## Verification

`chatterbox-tests.mjs` distinguishes simulated adapter-contract tests from the explicitly enabled real-model test (`AGENT_CUT_REAL_CHATTERBOX=1`). The real test generates speech with local Nano, composes a portrait MP4 with two images and timed captions, and checks that the saved project did not change. The release verification record includes its measured device, generation time, sample paths and browser checks. Do not treat the simulated adapter tests as evidence of model quality or speed.
