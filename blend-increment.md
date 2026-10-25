# Blend-mode increment — 2026-10-17

Contract ID: agentcut.effects.blend.v1. Requested capability: original Appendix A.5 (blend modes). Premiere family obligation: premiere22.effects-keyframes, still runtime-unverified. The static command named Frame Blending is a different feature and is not used as proof of layer-blend behavior.

## Tool and model

V2 item_blend(sequenceId,itemId,mode) accepts normal, multiply, screen, darken, lighten, difference and addition. It applies to the selected video item only, never its linked audio. Normal is the default and removes optional blendMode metadata on reset. Audio targets, unknown items/modes, locked tracks and invalid persisted blend metadata reject atomically. Plans are deterministic; save/edit/replay, no-op detection, reopen and undo/redo use existing Store behavior. V1 remains unchanged. The inspector exposes the same command through Blend mode.

## Render semantics

Composition follows bottom-to-top video track order. The foreground includes its existing transform, crop, static/animated opacity and fades. For normalized encoded RGB components B (already composed lower image), S (foreground), and foreground alpha a, output is (1-a)*B+a*F(B,S):

| Mode | F(B,S) |
|---|---|
| normal | S |
| multiply | B*S |
| screen | 1-(1-B)*(1-S) |
| darken | min(B,S) |
| lighten | max(B,S) |
| difference | abs(B-S) |
| addition | min(1,B+S) |

Non-normal blends use bounded, internally generated FFmpeg expressions in 8-bit RGB and an extracted foreground alpha mask. A full-duration transparent foreground preserves lower imagery before/after the item and outside transformed/padded edges. This is encoded SDR RGB arithmetic, not linear-light/HDR color management or a claim of exact Adobe color behavior. Audio is unaffected. Composed frames, playback and exports use the same compositor; animated opacity controls blend strength. Inactive/muted tracks contribute nothing.

Non-normal blending on a dissolve-attached item currently rejects, including attempts to add a dissolve after choosing such a blend. That avoids applying the blend twice during same-track overlap. A blended independent upper track can still compose over a lower track's dissolve. Clear the attached transition or reset the item's blend mode before editing that combination. Arbitrary blend expressions, overlay/soft-light/hard-light modes, blend-mode animation, masks and adjustment layers remain open.

## Verification and evidence

blend-tests.mjs checks enum/kind/lock/ID failures, reset/no-op behavior, invalid persisted state, prohibited blend/dissolve combinations, deterministic plans, reopen and undo/redo. Real FFmpeg exports compare all modes to numeric gray references with a five-luma-unit tolerance for conversion/encoding. Additional checks cover leading/trailing background, half opacity, transformed transparent edges, animated opacity, mute behavior, composed-frame agreement and red/blue screen producing magenta. The browser workflow exercises the shared dialog and undo using synthetic media and intercepted HTTP with real Store/Renderer; it is not live TCP verification.

The full original request and effects workstream remain open. No Premiere runtime evidence was upgraded to verified by these tests. No saved user project was edited/migrated and no user process was restarted. Restart Agent Cut and reconnect MCP to load updated code.

Final validation: npm test reports 52 tests, 51 passed, zero failed and one sandbox-blocked live HTTP client check skipped. Browser blend dialog and undo passed with zero page errors. blend-render-proof.png shows normal, multiply, screen and red/blue screen left to right on synthetic fixtures. See the blends-2026-10-17 release record for package/hash/data-preservation verification.
