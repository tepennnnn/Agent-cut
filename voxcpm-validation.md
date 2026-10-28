# VoxCPM2 integration validation — 2026-10-28

- Focused regressions: **27 passed, 0 failed, 1 skipped** across VoxCPM2, existing Chatterbox, sentence narration, story export/apply/undo, workshop and affiliate tests. The skipped case is the explicitly opt-in real Nano inference/export test; Nano model inference was not repeated.
- Final VoxCPM2 tests after input-change checks: **9 passed, 0 failed, 0 skipped**. Coverage includes pinned model integrity, runtime/voice changes, CPU/GPU argument contracts, the CPU CLI's help exit status, cropped references, finite/nonzero WAV validation, decode-cap rejection, queued cancellation, subprocess cancellation, changed-input retries, measured story timing and reviewed scene replacement/undo.
- Startup/reconnect checks with local loopback access: **8 passed, 0 failed, 0 skipped**, including reconnect after an editor restart and exactly-once handling of a rejected mutation. The sandboxed attempt had skipped the real reconnect; it passed when rerun with loopback access.
- Real native integration: configured the actual cached model files by full SHA-256; imported a private reference; generated two separate Tagalog sentence parts through `StoryService` using VoxGen 0.7.67 on a Windows GTX 1660 SUPER. Generation took **37.244 seconds** and yielded **5.120 seconds** of 48 kHz narration. Final captions ended at the measured audio endpoint; current project bytes remained unchanged. This was an isolated test data directory, not a user's active project. Neither the recording nor the resulting audio is included in the repository.
- Browser/MCP acceptance: an isolated runtime dispatched `story_sync` with `engine: "voxcpm2"`, returned the local setup status and Tagalog voice choices, exposed the Studio CPU setup form, disabled narration generation while unconfigured and exposed the Affiliate engine choice. **Zero browser JavaScript errors.** No model was downloaded or configured by that browser test.
- Download helper: plan-only execution inspected without starting a download. The exact GGUF files had already been acquired and fully hash-verified separately. Network transfer by the new Node download helper was not repeated.
- Syntax and whitespace checks passed for the changed modules. Full unrelated editor regressions were not rerun.

## Limits

The automated native-runtime fixtures deliberately simulate synthesis and use real FFmpeg for audio/timing integration; they do not establish pronunciation. The separate GPU inference above is real. Listening approval for an earlier whole-text candidate is not a word-perfect approval of all future generated narration.

**No Oracle/Ampere, Linux ARM64 or Samsung Android inference has been executed here.** The CPU adapter is based on the pinned upstream CLI source/flags and compatible `voxcpm.*` GGUF metadata. The short CPU acceptance in `voxcpm-local.md` remains necessary before a full Hermes pilot. No automatic retries or unbounded content generation are enabled.

Personal voices, generated narration, models, binaries, local runtime settings and test data are excluded from this change. Publishing the source does not install a runtime or transfer a reference to the remote instance.
