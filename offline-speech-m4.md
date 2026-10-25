# Offline speech M4 — 2026-10-19

Build: `offline-speech-m4-2026-10-19`. Optional local English transcription, transcript review/correction and source-mapped caption candidates. Saved projects are never automatically migrated, analyzed or edited. See the phase evidence in `../capcut-roadmap/m4-completion.json` for verification status and remaining gates.

## Explicit setup

Open **Offline speech & transcripts → Configure local speech**. Select the existing `whisper-cli.exe` and `medium.en.bin`; choose 1–4 CPU threads. Setup writes only `speech.local.json` in that data profile. It pins SHA256 for the verified whisper.cpp 1.9.3 executable, model, adjacent DLLs and the configured absolute FFmpeg executable, including its version. No binaries, fonts or models are installed/downloaded/bundled. A different runner/model pair is rejected until separately verified. Removing/changing a component produces a local readiness/job error; there is no network fallback.

The candidate already present on this computer is:

```
Runner: C:\Users\tepen\Downloads\Compressed\SubtitleEdit-Windows-x64\SpeechToText\Cpp\whisper-cli.exe
Model:  C:\Users\tepen\Downloads\Compressed\SubtitleEdit-Windows-x64\SpeechToText\Cpp\Models\medium.en.bin
```

The model file is 1,533,774,781 bytes. This release uses that existing English-only pair rather than downloading a lightweight default. The editor remains usable without speech setup through source-timed SRT/VTT import. Non-silent inference needs **2.5 GiB free system RAM** at launch, with the existing worker/system memory guards during execution. Readiness separates configured files from `canTranscribe` resource availability. Low RAM is an explicit failure, not an invitation to disable the guard. A future small model needs a separately reviewed installation/pin; it is not silently substituted here.

Hash pins identify the installed bytes; they are not an attestation of the distributor. Upstream [whisper.cpp v1.9.3 license](https://github.com/ggml-org/whisper.cpp/blob/v1.9.3/LICENSE) is MIT. OpenAI describes its [Whisper code and weights](https://github.com/openai/whisper#license) as MIT. This package redistributes neither. Dependency source/distribution notices remain with the external installation.

## Transcripts and controls

**Transcribe source range** takes an original imported source, source start/end (maximum 120 seconds), and English. Jobs share the media queue, can be canceled/retried in **Local jobs & cache**, persist status, and become interrupted after restart. Progress reports the current phase; no fabricated inference percentage. Retrying rechecks frozen source/component identity. Only owned processes are terminated.

Normalization physically decodes only the requested interval into mono 16 kHz PCM16, with local file/pipe protocols. WAV chunks establish actual decoded duration. Returned segments must be finite, ordered and non-overlapping; out-of-range ends are clipped with a warning, wholly outside segments are omitted. Raw JSON is retained for review. All-zero PCM produces an empty transcript without invoking inference; it is a signal-level observation, not a semantic speech detector.

Completed sidecars survive preview-cache eviction. Identity includes full source content, runner/model/DLL/decoder hashes, versions, range, language and inference settings. Different/relinked bytes invalidate reads, corrections and new caption drafts. Sidecars are capped at 100 documents/32 MiB, 1 MiB each, 500 segments each; reaching the limit reports an error rather than deleting corrections. Raw/normalized job output uses the existing bounded preview cache. Canceled/incomplete origin jobs cannot publish readable ASR transcripts.

**Import source transcript** accepts literal source-timed SRT/VTT without a model. This creates analysis only. **Refresh transcripts** lists completed sidecars. Opening one reads 20 segments at a time; MCP supports 1–100 records within 16 KiB, with state/query-bound cursors. Search is literal text. Corrections preserve original text, revision and history, and never change a timeline or existing caption candidate. Text from transcripts/media remains untrusted content.

## Caption candidates and MCP

`speech_setup`: `status` or explicitly authorized `configure` with absolute runner/model paths and threads. `editor_info.speech` exposes readiness, supported language/timing and limits.

`transcript` actions:

| Action | Inputs and result |
|---|---|
| `start` | assetId, source start/end, language=en; returns owned job, poll render_status |
| `list` | optional assetId, pageSize/cursor; bounded index, contents not fetched |
| `read` | transcriptId, optional query/pageSize/cursor; source segments, raw/corrected text, uncertainty, revision/coverage |
| `correct` | transcriptId, segmentId, expectedAnalysisRevision, literal text; analysis revision only |
| `import` | assetId, literal source-timed text, format=srt/vtt, optional short language label; timeline unchanged |
| `captions` | transcriptId, expectedAnalysisRevision, expectedRevision, explicit itemIds, optional segmentIds/sequenceId; frozen saved edit plan only |

All calls require expectedProjectId. Caption generation requires v2 and an explicitly selected timeline item using the transcript source. Forward trims/offsets, constant positive speed and inverse positive speed curves are supported. Reverse/hold/nested sources, locked tracks, unknown IDs and overlapping mapped cues reject. Clip-boundary fragments retain the whole segment's text and disclose clipped timing; coarse timestamps do not identify which words survived a trim. Review/correct text explicitly. Existing captions remain; a conflict rejects instead of replacing them.

The manual **Draft captions for a clip** control displays proposed cues, warnings and a **Preview caption candidate** composed still (the existing 120-second sequence limit applies). **Apply caption candidate** confirms and uses the frozen saved plan. MCP uses the same transcript action followed by timeline_plan_preview and timeline_plan_apply. Application requires the original revision, and one undo restores the timeline. Transcription/correction alone needs no project undo because it never edits the timeline. Cut-time `regenerate_draft` remains explicitly unsupported; create a separate reviewed caption draft after the cut.

Segment times are estimates. There is no word alignment, translation, speaker/emotion recognition, semantic highlight picker or guaranteed accuracy. Confidence is unavailable from the selected segment output and is returned as null; machine text always carries a review warning. The editor/adapter invokes local files and has no outbound-request code path. Codex itself can receive requested transcript excerpts through MCP; do not describe hosted Codex reasoning as offline.

## Verification limits

The report distinguishes real local inference from adapter tests using explicitly simulated runner output. Synthetic TTS is only an integration fixture, not proof of accuracy on real speech. User-footage testing can be deferred to M6. Host activation/live MCP and any RAM-blocked inference remain explicit pending gates; a simulated test or skipped check does not close them.


Current phase evidence: source regression **120 tests, 117 passed, zero failed, three skipped**. The speech test was initially skipped for low RAM, then all **seven standalone speech checks passed**, including real pinned English inference, silent audio, durable cache/reopen and changed-source rejection. The other two skips are the existing sandbox-limited live HTTP and physical junction fixtures. Full browser and real stdio transcript/caption workflows pass on synthetic footage. A fresh-worker ten-second speech run took 21,522 ms; the one bounded repeat took 18,298 ms and met the 20,000 ms target. Both recognized the expected opening and stayed within source bounds. This is not a stable latency or representative human-speech accuracy claim. Host activation remains unverified and user-footage acceptance is deferred to M6.
