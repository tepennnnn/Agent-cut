# M1-01 through M1-03 — agent loop increment

Build: `agent-loop-m1-01-03-2026-10-18`.

## Delivered

M1-01: editor diagnostics now show build, application root, project ID and data root under **Connect to Codex**. Startup validates an existing runtime's data root and build before reuse. Browser origin checks use the actual bound port after fallback, correcting a defect that could reject the editor's own browser requests. The client-route transformation is prepared, tested for unrelated-table preservation/idempotence, and applied only with the required protected-file grant. Its outcome/backup is recorded separately in `m1-route-proposal.json`. Live client reconnection remains a distinct gate; restricted loopback observations are not called a host pass.

M1-02: `project_read` keeps its old default full response. Optional `view: "summary"` provides compact identity/revision/counts; `view: "window"` accepts sequence, selected item IDs, exclusive time window, detail level, page size and cursor. Default summary window records include timing, effects and automation-property names; full detail includes exact item fields. Cursors are session-authenticated and bound to identity, revision and query. Stale/tampered/query-mismatched cursors reject. Window responses fit 16 KiB, with explicit total/returned/continuation coverage; a single oversized record rejects rather than silently truncating it. Summary fits 4 KiB. Legacy window reads include timeline clips and layers.

`timeline_operations` still returns the full registry with no arguments. Optional names/version/page/cursor filters return exact closed operation contracts in ≤8 KiB pages. `AGENT_CUT_COMPACT_MCP=1` advertises small operation envelopes instead of repeating every operation schema. Server-side request and operation validation continue to use the original exact closed schemas. Full-schema discovery remains compatible. Compact-mode mutations require project identity both in the advertised schema and at the stdio entry point, including forwarding to an already-running editor.

M1-03: new read-only-timeline tool `timeline_plan_preview` loads a saved plan, verifies its identity/base revision/digest and freezes before/after projects inside the existing serial queue. Rendering then runs outside that queue, allowing independent edits. It returns labeled committed-base and proposed-candidate images, plan/base/current revision, stale status, selected sequence/time, durations and changed paths. It never assigns the candidate into Store state or commits a revision/history entry. Applying still uses the ordinary saved-plan flow and confirmation policy; stale plans reject.

## Candidate-preview workflow

1. Read `project_read` with `view: "summary"`, then a focused window and selected operation contracts.
2. Call `timeline_plan_save` with project identity, base revision, summary and typed operations.
3. Call `timeline_plan_preview` with returned plan ID, expected identity/revision and candidate timeline `time`. Optional `sequenceId` selects a proposed sequence; `includeBefore: false` requests the candidate image alone.
4. Review the saved plan and labeled candidate evidence. Apply through `timeline_plan_apply` with the original revision and required destructive confirmation. Show committed `frame_preview` proof after applying, or discard the plan.

Before imagery is omitted, with coverage identifying that fact, when the chosen proposed time/sequence did not exist in the base project. An edit during rendering marks the returned candidate stale; it does not replace the newly committed project. Composition is serialized per candidate service to avoid concurrent file writes. Completed composition is reused for subsequent requested times with a small in-memory cache.

## Scope limits and verification

This increment supports composed candidate **stills**, initially for selected sequences up to **120 seconds**. It renders the full frozen selected sequence and extracts the requested frame; it does not yet provide optimized five-second draft clips, cancellation, persistent candidate jobs or disk eviction. Those remain M1-04/M2 tasks. An over-limit sequence fails explicitly. Existing full composition can therefore still be slow. This is not a claim that M2 latency/resource targets are met.

Five new focused tests cover bounded reads/cursors, closed validation under compact advertisements, actual before/after pixel changes without saved-project changes, concurrent edits during candidate composition and real full/compact stdio calls with labeled images. The stdio test verifies matching plan IDs, malformed-operation rejection and missing compact identity rejection. A startup test covers actual-port origin policy. Browser verification covers the visible build/profile panel and all existing synthetic workflows with zero page errors.

Full suite: **95 tests, 94 passed, zero failed, one sandbox-blocked live HTTP check skipped**. The final package is also tested from an extracted directory. Measured discovery/summary payloads are recorded in `m1-protocol-metrics.json`; serialized byte savings are not asserted to equal a particular tokenizer's savings.

Source modules: `agent-reads.mjs`, `candidate-preview.mjs`, `app-build.mjs`, shared `server.mjs`/`startup.mjs`, and the existing UI. The canonical app remains the development source. Both existing extracted app code copies receive the verified release while configurations and saved project files are preserved. No user project is migrated, edited, copied into a synthetic fixture or automatically rendered. Model installation remains unchanged.

Client routing uses the user's selected extracted app server and explicitly binds its existing data root, with compact discovery enabled. Protected configuration changes are backed up, hash-guarded and limited to the agent-cut table/its two environment values; other MCP entries stay intact. Restart the intended editor and reconnect Agent Cut after deployment, then verify a fresh `editor_info` build/data-root and `project_read` summary. Current project is v1: a separate reviewed backed-up migration remains necessary before using v2-only creator operations on that project.

This completes the implementations for compact context and candidate still previews. M1-01 is not fully accepted until fresh user-host client identity/connectivity is verified. M1-04 and M1-05 are outside the requested three-task batch.
