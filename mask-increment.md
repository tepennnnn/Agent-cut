# Mask increment — 2026-10-17

Contract: agentcut.effects.mask.v1. Requested capability: original Appendix A.5 masks; Premiere family obligation premiere22.effects-keyframes remains runtime-unverified. These are Agent Cut's scoped parameters and defaults, not measured Premiere factory behavior.

## Commands and defaults

V2 item_mask(sequenceId,itemId,mask) replaces the selected video item's single source mask. mask.shape is rectangle or ellipse. Optional defaults: x=.25, y=.25, width=.5, height=.5, feather=0, inverted=false, opacity=1. Positions/sizes use fractions of the cropped source image, not the canvas, source seconds or screen pixels. Width/height are 0.01–1; x/y are 0–1; the box must fit entirely inside the image. Feather is 0–0.25 and opacity is 0–1. item_mask_clear(sequenceId,itemId) removes the mask; clearing an absent mask is a no-op. Audio, missing items, malformed/unknown fields, invalid bounds and locked tracks reject atomically. The commands preserve linked audio and use existing plan/edit/saved-plan guards, deterministic serialization, reopen and undo/redo.

## Composition

Masks multiply the source alpha after crop/basic color and before fit, scale, rotation, position, item opacity and fades. They therefore move/rotate/scale with the clip, and static or animated item opacity multiplies the masked alpha. Rectangle coverage uses the minimum signed distance to the four box edges in normalized image coordinates. Ellipse coverage uses normalized radial distance scaled by the smaller radius. Zero feather uses hard inside/outside coverage. Nonzero feather uses clamp(0.5+distance/feather,0,1), centered on the boundary; this is a bounded linear normalized-coordinate feather, not a pixel-exact Euclidean blur. Inversion swaps inside/outside before mask opacity is applied. Normal and non-normal blends consume the resulting alpha, preserving lower video in masked-out areas. No audio processing is added.

Split/insert/range fragments copy a static mask unchanged. Source trims/crops can change the visible source within the normalized mask; inspect the resulting frame. No mask path animation, automatic tracking, polygon/Bezier drawing, multiple-mask stack, track matte, mask-based color correction or blur-isolation effect is implemented.

Masks on dissolve-attached video items currently reject, and adding a dissolve to a masked item rejects. That avoids incorrect same-track transparency interpolation in the current compositor. Independent masked upper tracks can still compose over lower-track dissolves. Clear the mask or attached transition before combining those edits. This is an explicit limit, not a claim of Premiere parity.

## Implementation and evidence

masks.mjs owns validation and internally generated numeric-only encoder expressions. operations.mjs exposes typed contracts; sequence-edits.mjs owns commands; sequences.mjs validates persisted data and rejects legacy flattening of masks; engine.mjs applies alpha before transforms. ui/v2-ui.js binds the Mask/Clear mask inspector controls to the same commands. No dependency or architecture rewrite was introduced.

mask-tests.mjs verifies shape/field/kind/bounds/lock failures, atomic rollback, defaults, clear/no-op, fragment retention, deterministic plans, reopen and undo/redo. Real FFmpeg fixtures check rectangle center versus outside, ellipse corners, inversion, feathered boundaries, zero/half opacity, motion, leading/trailing gaps, blend composition, animated opacity and composed-frame/export agreement. Browser verification uses synthetic scratch media, intercepted HTTP and real Store/Renderer for the mask dialog, preview, clear and undo. It is not live TCP deployment verification.

mask-render-proof.png shows rectangle, ellipse, inverted rectangle and feathered rectangle left to right, red over blue. mask-ui-proof.png shows the inspector workflow on synthetic red footage. Neither image is the user's video. Native Premiere runtime evidence remains unknown. Existing user projects were not edited/migrated and user processes were not restarted. Restart Agent Cut/reconnect MCP to load this build. Effects and the full original request remain unfinished, including adjustment layers, advanced interpolation and advanced mask features.

Final validation: npm test reports 55 tests, 54 passed, zero failed and one sandbox-blocked live HTTP client check skipped. Browser mask dialog, composed preview, clear and undo passed with zero page errors. Package and saved-project hash checks are recorded in masks-2026-10-17-release.json.
