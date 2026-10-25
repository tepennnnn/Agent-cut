# Creator release M6 — 2026-10-19

Build: `creator-release-m6-reconnect-2026-10-19`. The release candidate contains the M1–M5 creator workflows and fixes serving the speech/recipe browser modules and refreshing stale attached-session credentials after a pre-execution authentication rejection. A real editor-restart test verifies exactly one mutation and exact undo; network failures and ambiguous responses never automatically retry edits. There are 37 MCP tools and 96 validated operations (67 v2). The candidate is staged in the existing launcher folders; live host activation and user acceptance remain required before declaring the release fully accepted.

## Start and verify

On this computer, use the existing launcher:

`C:\Users\tepen\Documents\Codex\2026-10-16\how-to-open-codex-terminal\outputs\Agent-Cut-keyframes-2026-10-17\agent-cut\start.cmd`

Keep its `data` directory and `config.local.json`. Close an older editor terminal normally, start this launcher, then reconnect the existing Agent Cut MCP connection. Do not add a duplicate server or select the development profile as a workaround. Use the URL printed by the launcher: if the preferred port is occupied by another application, startup chooses an available loopback port.

Ask Codex: “Use Agent Cut. Read the project summary and editor information. Report the build, application root, data root, project ID and revision before making any edits.” Expected build is the ID above. Expected data root ends in `Agent-Cut-keyframes-2026-10-17\agent-cut\data`; tool discovery should contain 37 tools. Stop if these differ. Do not publish runtime tokens in reports.

The initial sandbox denied localhost access. With explicit localhost permission, real HTTP authorization/media/module checks and a real Chromium edit/undo journey passed. A fresh stdio client read the intended revision-14 project (14.24 seconds, 37 tools) without changing its saved bytes. The already-open Codex bridge retained obsolete credentials; this release fixes that case. Close the editor normally, restart this existing launcher, and restart the Agent Cut connection after upgrading. A still-loaded older bridge may require restarting Codex to load the corrected code. No MCP reinstallation or duplicate registration is needed. User-led footage acceptance is still deferred.


## First reviewed edit

Read the intended project/revision, preserve a checkpoint/backup, then choose a small edit. Legacy v1 projects remain readable; v2 activation requires a separate reviewed migration plan, matching identity/revision, confirmation and recovery backup. Architecture approval alone does not activate migration.

For speech edits, configure an already installed local runner/model explicitly or import source-timed SRT/VTT. Read actual passages, choose ranges, generate an `edit_recipe` plan, inspect its complete source evidence/warnings and `timeline_plan_preview`, then apply only the reviewed plan at the same revision. Show a committed composed frame, export locally and verify undo. A transcript correction changes analysis only. Measured low audio level does not establish filler words or the strongest passage.

For a montage, choose up to twelve source ranges in order, framing, a title, optional locally imported music, short transitions and explicit fades/ducking. Music must cover the result. Plans never loop or stretch it automatically.

## Recovery

- **Connection/startup:** check the printed URL and profile first. An occupied port can cause a fallback port; reconnect to the runtime for the same folder. Do not terminate an unrelated process or reinstall MCP as the first response.
- **Wrong/stale project or plan:** reread identity/revision and regenerate/review the candidate. Do not retry the old mutation blindly.
- **Missing media:** inspect media status; use reviewed relink with source bounds/content checks, backup and undo. Never substitute another file silently.
- **Missing font/model:** inspect readiness/warnings. Choose an available local font and regenerate the candidate. Import captions manually if optional ASR is unavailable. No downloads or cloud fallback occur.
- **Canceled/interrupted job:** inspect job status; incomplete outputs are unavailable. Retry explicitly after correcting the cause. Only the runtime's owned work can be canceled. Cancellation does not apply timeline edits.
- **Abandoned lock:** inspect lock ownership and the recovery plan. Recover only a proven dead owner with matching revision/confirmation; recovery preserves a backup. A live or unverifiable owner's lock is never stolen.
- **Undo/restore:** undo restores project content while advancing revision. For older checkpoints/backups, review the restore plan and its backup before activation. Do not delete `data` to solve an error.
- **Cache:** use the owned derived-cache controls. Active/referenced outputs, imported media, user exports and saved projects are protected. Do not manually remove active job files.

## Scope and measured limits

The editor performs local file processing and has no automatic outbound requests/model downloads. The existing Codex conversation can receive requested frames/transcript excerpts; this is not a fully offline Codex model. No OS socket audit is claimed.

Speech uses optional pinned whisper.cpp/English medium.en with coarse segment timing; no word-alignment, human-speech accuracy or guaranteed latency claim. The M4 10-second TTS probe initially took 21.522 seconds; a bounded repeat took 18.298 seconds against a 20-second target. Heavy-worker memory guards can reject work when RAM is low.

Five-second draft previews are bounded to 640 pixels/15 fps (maximum ten seconds). Nested-source bounded drafts reject; full composition is available. Candidate stills support sequences up to 120 seconds. Recipes allow at most twelve ranges, 120 seconds, 200 operations, thirty source bindings and 60 KB of complete review. Excerpt reconstruction requires unprocessed forward constant-speed source items; unsupported effects/holds/reverse/nesting reject explicitly. Captions at dissolves use coarse midpoint joins requiring review.

Earlier measured synthetic M2 draft times were 2.324–2.333 seconds cold; warm stills 72–75 ms. M3 styled 1080p landscape export took 21.210 seconds. These are declared fixture measurements, not fresh M6 performance guarantees. The initial M6 export benchmark stopped safely at the 512 MiB system-memory guard; its evidence is retained. A later run started with about 5 GiB free RAM and passed every frozen target: cold draft median 2.406 seconds (worst 2.490), cold still median 552 ms, warm still median 77 ms, landscape export 21.784 seconds and portrait export 34.675 seconds. Minimum sampled free RAM was 3.64 GiB and coordinator RSS peaked near 52 MiB. Three preview observations and one export observation per aspect are fixture measurements, not percentile guarantees. Renderer and preview code are unchanged by the reconnect correction. Current source/extracted regression counts are recorded in the external completion report.

Source and extracted-package checks, manifest digests and saved-project preservation are recorded in the external `outputs/capcut-roadmap/m6-completion.json`. That report distinguishes verified checks from blocked/deferred acceptance. Historical reports inside the package retain their original dates and build IDs.

## Requirement disposition

AC-C02–AC-C13 have isolated automated implementation evidence across M1–M5, with the limits above. AC-C01 has fresh intended-profile stdio/health identity evidence; AC-C14 retains final current-chat activation and physical junction acceptance gates. The physical junction fixture is sandbox-blocked; a normal-Windows-terminal check is supplied in outputs/capcut-roadmap/finish-phase6-checks.cmd outside the app package. User-led real-footage acceptance is deferred by the user, including any separately reviewed migration. Full CapCut/Premiere parity, cloud services, generative media, downloaded templates, voice cloning, subject tracking/removal/reframe, karaoke animation, beat-perfect assembly, collaboration, multicam and HDR/mastering remain outside this release.
