# VoxCPM2: local Tagalog narration and voice references

Agent Cut supports optional `engine: "voxcpm2"` through `story_sync` and Story/Affiliate Studio. It generates complete sentences, measures each WAV for scene/caption boundaries and stages a separate story draft. Existing stories and the editor timeline do not change automatically. Scene narration replacements continue to use `creator_voice_prepare` → review → `creator_apply`, with identity/revision guards and undo.

The publisher of [OpenBMB VoxCPM2](https://huggingface.co/openbmb/VoxCPM2) lists Tagalog among 30 languages and releases its code and model under Apache-2.0. Only recordings you are authorized to use should be imported. This feature performs reference conditioning, not fine-tuning. It does not verify spoken words or grant rights to third-party voices.

## What was tested

The community Q8_0 BaseLM/F16 acoustic conversion with **VoxGen 0.7.67, normal Vulkan mode**, generated a 4.32-second reference-conditioned Tagalog comparison in about 30.11 seconds on a Windows GTX 1660 SUPER 6 GB. The user preferred this second-recording sample. That is a short listening result, not a production-quality or word-perfect certification.

**Oracle Ampere CPU, ARM64 Linux and Samsung Android inference have not been measured here.** The Oracle path below uses a different community runtime, `llama.cpp-omni`, with its documented CPU backend. Its command contract and model metadata were inspected; real CPU output still needs one short acceptance test. VoxGen itself is GPU-only and is not the runtime for an Ampere instance without a GPU. Do not estimate Oracle runtime from the GPU result or launch a full content pilot before the short test passes.

## Install on Ubuntu / Oracle Ampere

Keep your existing repository changes and data. Fetch/pull this update using your normal reviewed Git workflow; do not reset local fixes. You need Node 20+, FFmpeg, around 3.55 GB for the two model files plus build/cache headroom, and enough free RAM for model weights and inference. 11 GB installed RAM alone does not prove adequate free memory or acceptable latency.

Restart your Agent Cut runtime and reconnect its MCP connection after updating so the new `voxcpm2-local-2026-10-28` build and engine contract are loaded. A source pull does not update an already-running Node process.

Install build prerequisites if absent, then build the pinned standalone CPU CLI outside Agent Cut:

```bash
sudo apt-get update
sudo apt-get install -y build-essential cmake git
git clone --no-checkout --depth 1 --filter=blob:none https://github.com/tc-mb/llama.cpp-omni.git "$HOME/agent-cut-tts-runtime"
git -C "$HOME/agent-cut-tts-runtime" fetch --depth 1 origin e369f1b54a3b4ed5837abd791aae5216b4ab73d1
git -C "$HOME/agent-cut-tts-runtime" checkout --detach e369f1b54a3b4ed5837abd791aae5216b4ab73d1
cmake -S "$HOME/agent-cut-tts-runtime" -B "$HOME/agent-cut-tts-runtime/build" \
  -DCMAKE_BUILD_TYPE=Release -DGGML_CUDA=OFF -DGGML_VULKAN=OFF \
  -DGGML_NATIVE=OFF -DLLAMA_CURL=OFF -DLLAMA_BUILD_TESTS=OFF
cmake --build "$HOME/agent-cut-tts-runtime/build" --target voxcpm2-cli --parallel 2
```

The pin is recorded in `voxcpm-models.json`. The pinned CLI's `--help` intentionally returns exit code 1 after displaying usage; Agent Cut handles that during setup. The CPU adapter does not send unsupported `--threads` flags. Build parallelism is not a claim about runtime thread count.

From Agent Cut, inspect the download plan, then explicitly opt in to downloading the exact files:

```bash
node scripts/setup-voxcpm-models.mjs --directory "$HOME/agent-cut-models/voxcpm2"
node scripts/setup-voxcpm-models.mjs --directory "$HOME/agent-cut-models/voxcpm2" --download
```

The script pins revision `169f64d8b98bbaab1761e4ca3a83e6af653456cc` of `DennisHuang648/VoxCPM2-GGUF`, verifies file size and full SHA-256, never overwrites an unexpected model, and leaves interrupted `.partial` files for inspection. It does not import voices, start a server, generate speech or edit projects. Generation and status never download models.

## Configure through MCP

First call `project_read` with `view: "summary"` and use the actual returned identity. Paths below are examples; use paths from your instance.

```json
{
  "action": "tts_configure",
  "expectedProjectId": "CURRENT_PROJECT_ID",
  "engine": "voxcpm2",
  "settings": {
    "backend": "llama.cpp-omni",
    "runnerPath": "/home/ubuntu/agent-cut-tts-runtime/build/bin/voxcpm2-cli",
    "baseModelPath": "/home/ubuntu/agent-cut-models/voxcpm2/VoxCPM2-BaseLM-Q8_0.gguf",
    "acousticModelPath": "/home/ubuntu/agent-cut-models/voxcpm2/VoxCPM2-Acoustic-F16.gguf",
    "sentenceTimeoutSeconds": 180,
    "jobTimeoutSeconds": 600,
    "maxSteps": 80
  }
}
```

Setup checks existing local files, their full model hashes, executable identity and advertised CLI flags. If setup reports an error, fix that specific installation issue instead of spawning reviewers, changing unrelated code or retrying a full pilot. `tts_status` and `voices` accept `engine: "voxcpm2"`; omitting the engine retains the existing Chatterbox behavior.

## Transfer and import your voice privately

The repository contains **no personal voice, voice embedding, generated comparison WAV, model weight or runtime executable**. Transfer your chosen recording directly to the instance, outside Git. For the second-recording comparison, the selected source interval was 0.52–6.12 seconds. You can use that interval with the original recording:

```json
{
  "action": "voice_import",
  "expectedProjectId": "CURRENT_PROJECT_ID",
  "engine": "voxcpm2",
  "path": "/home/ubuntu/voices/voice-reference.m4a",
  "referenceStart": 0.52,
  "referenceSeconds": 5.6
}
```

Supported sources are WAV, MP3, M4A, FLAC and OGG under 30 MB. Actual decoding uses FFmpeg, so an M4A recording named `.ogg` can still decode. Select 3–15 seconds of speech. The imported interval becomes an owned 16 kHz mono WAV with a content hash; original files remain untouched. Studio's VoxCPM2 setup has interval fields for browser imports. Save the returned voice ID for later calls. Imported references are private to that data directory and checked again before inference. The decoder does not automatically identify or remove background speakers/music; choose a clean segment yourself.

## One bounded acceptance test

Call `story_sync` once with:

```json
{
  "action": "generate",
  "expectedProjectId": "CURRENT_PROJECT_ID",
  "engine": "voxcpm2",
  "voice": "IMPORTED_VOICE_ID",
  "title": "Tagalog voice acceptance",
  "script": "Akala ko mag-isa ako. Paglingon ko, may nakatayo sa likod ko.",
  "shape": "portrait",
  "rate": 0
}
```

Poll `render_status` with the returned job ID at sensible intervals (for example 10–15 seconds). Do not regenerate while it is running. This creates a separate story draft; it does not apply a timeline. Read the completed story to locate its narration, then listen before approving use. Sentence boundaries are measured; within-sentence subtitle/word timing remains estimated. The `builtin` voice is also available, but does not use your reference.

Limits: 1–20 sentences/job, at most 240 characters and 35 words/sentence, default 180 seconds/sentence and 600 seconds/job, 80 decode patches/sentence (12.8 seconds maximum). Over-limit audio is rejected rather than silently accepted. Configuration can explicitly raise the bounded time limits; there are no automatic generation retries. Jobs use the existing cancellable queue. If Oracle times out, report the elapsed time and error; preserve everything and stop. Do not promise fast offline generation on two CPU cores.

## Windows GPU setup

For a separately installed VoxGen runtime, choose `backend: "voxgen"`, point `runnerPath` at `voxgen.exe` and use the same GGUF paths. Normal Vulkan mode uses the model's own voice-reference path. No CUDA/Python dependency is required by that adapter. This runtime is independently maintained; installed model/runtime changes require reconfiguration.

## Minimal instruction for Hermes

Read `voxcpm-local.md`. Preserve existing projects and local renderer fixes. Install only the optional pinned CPU runtime and model if not already present; do not rebuild Agent Cut or modify unrelated code. Use `story_sync` with `engine=voxcpm2`, import the privately transferred reference, and run only the two-sentence acceptance above. No subagents, full test suites, image/video generation or full content pilot. Use the configured time budgets, no automatic retries, and report the final status, elapsed inference time and narration path in under 150 words. If any setup/build/inference step fails, report its exact error and stop rather than beginning a broad debugging loop. Never apply a story to the editor without review.
