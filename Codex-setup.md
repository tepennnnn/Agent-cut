# Connect Agent Cut to Codex

Current build: `chatterbox-local-2026-10-25`, 39 tools. Extends `story_sync` with optional local Chatterbox setup, voice references and offline generated narration, image scenes, timed captions, reviewed export and optional new-sequence apply. See [Story Studio](story-studio.md). Restart the editor and reconnect its existing MCP connection after upgrading so the new service/tool advertisement load. Existing projects are retained; story generation/preview/export do not migrate them.

This package provides a local STDIO MCP connection. If Agent Cut is already registered, keep that entry and its data-directory setting. Do not register a duplicate server or switch to a different project directory. Use the setup below only for a new connection.

## In Codex settings

Open **Settings → MCP servers → Add server**. Choose **STDIO** and enter:

| Field | Value on this computer |
|---|---|
| Name | `agent-cut` |
| Command | `C:\Program Files\nodejs\node.exe` |
| Argument 1 | `C:\Users\tepen\Documents\Codex\2026-10-16\how-to-open-codex-terminal\outputs\agent-cut\server.mjs` |
| Argument 2 | `--stdio` |

If the arguments control is one field, enter the script path in quotes followed by `--stdio`:

```text
"C:\Users\tepen\Documents\Codex\2026-10-16\how-to-open-codex-terminal\outputs\agent-cut\server.mjs" --stdio
```

Save, then restart the MCP connection. Check `/mcp` in Codex for `agent-cut` and its tools. If you move or extract the package elsewhere, use that folder's absolute server path instead.

The MCP process starts the local editor server automatically. In your browser, open **http://127.0.0.1:43127**. Alternatively, start the editor first with `start.cmd`; the MCP process attaches to the same running editor and project. All media is served from loopback only.

## First instruction

> Use Agent Cut. Read the project, show a composed frame at 0.5 seconds, and tell me what edits are available. Then rename the project to My Codex Edit.

Then try a concrete edit:

> Use Agent Cut. Remove the first half-second from the timeline, keep captions aligned, show a preview of the new opening, and export an MP4.

The included demo is generated footage. Replace it with your own video using Import, or tell Codex an absolute local video path. Ask Codex to clear the timeline before adding a new edit if appropriate.

## Optional CLI registration

If you separately have the Codex CLI installed:

```powershell
codex mcp add agent-cut -- node "C:\Users\tepen\Documents\Codex\2026-10-16\how-to-open-codex-terminal\outputs\agent-cut\server.mjs" --stdio
```

Do not register both the plugin and a duplicate manual MCP entry. The ZIP also includes portable plugin manifests and a workflow skill for clients that support local plugin packages. Direct MCP settings are the simplest path for this build.

## Manual TOML alternative

If you manage configuration files yourself, add this table to the appropriate Codex configuration without replacing its other entries:

```toml
[mcp_servers.agent-cut]
command = 'C:\Program Files\nodejs\node.exe'
args = ['C:\Users\tepen\Documents\Codex\2026-10-16\how-to-open-codex-terminal\outputs\agent-cut\server.mjs', '--stdio']
startup_timeout_sec = 15
tool_timeout_sec = 120
```

Long silence scans can exceed a tool timeout. Increase `tool_timeout_sec` for long source files if needed; exports are asynchronous and use render_status polling.

Setup fields and CLI format follow [official OpenAI documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli). Actual connection in the Codex host remains to be checked after registration; protocol tests are not proof of an installed host connection.

## Version 0.2 editing workflow

Restart an already running Agent Cut server and reconnect MCP after upgrading so tool discovery uses the new schemas. Keep the existing data folder; earlier project files remain supported. Read the current project, save a named checkpoint, apply specific changes, and inspect a composed frame before exporting. Added tools are timeline_redo, project_checkpoint and subtitle_import. timeline_edit now supports transforms, crop, basic color, fades, dissolves, slip/roll/duplicate, markers, export ranges and independent video/audio layers. Audio imports use local MP3/WAV/M4A/FLAC/OGG files.

Example prompt: “Read Agent Cut, save a checkpoint named Before polish, add a short fade to the opening, show a composed preview, and explain the changes.”

Media storage, decoding and rendering remain local. Hosted Codex can receive requested tool results, SRT contents and preview images. The application has no AI API connection. Live local HTTP integration and Codex host registration remain sandbox-unverified.

If port 43127 is occupied by another copy, current builds select a free loopback port. Use the actual URL returned by editor_info or printed at startup. The MCP server reads its own data folder's authenticated runtime and follows that port; do not connect tools to an unrelated copy to bypass a conflict. A new extraction has an empty data folder. Preserve the original data folder and local config when upgrading existing footage.

## Extended workstreams build

After restarting/reconnecting, `editor_info` reports `extended-workstreams-2026-10-17`. Read project identity/title/assets before editing. Keep using the app folder whose `project_read` contains your intended current footage, and that folder's `server.mjs --stdio`, rather than automatically switching to the canonical example path above. Both extracted folders currently have independent saved projects. Both existing extracted app folders receive code updates, while their data/config remain independent. New tools include `media_find`, `media_status`, reviewed `media_relink_preview`/`media_relink`, `audio_analyze` and `subtitle_export`; new timeline commands are listed by `timeline_operations`. See extended-workstreams.md.

The freeze-frame update reports `freeze-frames-2026-10-18` from `editor_info`. MCP tool count stays 29; `timeline_operations` adds `item_freeze` and `item_freeze_clear`. Restart your existing app folder and reconnect MCP after upgrading.

The reverse/transition update reports `reverse-transitions-2026-10-18` from `editor_info`; tool count remains 29. `timeline_operations` adds `item_reverse` and optional `sequence_transition.kind`. Keep the intended existing project/data folder and reconnect after restarting its server. No project migrates automatically.

The nesting build reports `nested-sequences-2026-10-18`; tool count remains 29. Shared operations add `sequence_nest` and confirmed `asset_remove` for unused references. Restart the intended existing app folder and reconnect MCP to load current contracts. All real saved projects remain unchanged by this code delivery.


## Text/captions M3

Restart the intended existing folder and reconnect MCP. `editor_info.build` should be `text-captions-m3-2026-10-19`; tool count stays 34. `editor_info.text` lists local font availability/digests and presets. Read `project_read` with `view: window, detail: text` for bounded title/caption IDs, timing and overrides. Fetch the new `graphic_text`, `graphic_delete`, `sequence_caption_style` and `sequence_text_retime` contracts with `timeline_operations`. Styled range/gap/insert/overwrite edits require explicit caption/title retain/retime policies. Save/preview a plan before a substantive text edit, preserve identity/revision guards, and describe plain subtitle export as omitting styles and titles. No model installation or user-project migration is part of this increment. See text-captions-m3.md.


## Offline speech tools (M4)

See [offline-speech-m4.md](offline-speech-m4.md). `speech_setup action=status` reports installed pins and resource readiness; configure explicitly selects existing local whisper.cpp 1.9.3/medium.en paths, with no download. `transcript` supports bounded source transcription (English, maximum 120 seconds), paginated read/search, correction, source-timed SRT/VTT import and caption candidates. Supply project identity. Correction requires the analysis revision; caption mapping also requires project revision and selected item IDs. Poll/cancel/retry through the shared job tools. Caption output is a saved ordinary plan: preview/review, then apply and undo through existing tools. These actions never silently migrate a v1 project. Low RAM, unsupported language, reverse/held/nested mapping and stale source bytes give explicit errors/fallbacks.


## Source-evidenced editing recipes (M5)

Call `edit_recipe action=contracts` with a selected kind before `action=plan`. Opening/highlight/excerpt requests cite selected transcript IDs/revisions/segments; pause cuts cite selected completed `pause_analyze`/`pause_read` measurements. Montage requests explicitly order local source ranges and choose title/music/gain/fades/ducking. Returned IDs identify a frozen ordinary operation plan, not an applied edit. Use its candidate sequence ID for `timeline_plan_preview`, review source/timeline evidence and warnings, then authorized `timeline_plan_apply`. Destructive prefix/pause cuts require matching `confirmPlanId`; one undo restores the original timeline. Source bytes and revisions are checked again at preview/apply. See [agent-recipes-m5.md](agent-recipes-m5.md) for bounds and supported processing; never label low level as speech meaning or claim an automatic strongest moment.
