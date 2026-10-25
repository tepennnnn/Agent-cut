# Keyframes increment — 2026-10-17

## Implemented contract

V2 items optionally store keyframes as a map from property name to 1–32 sorted points: {time,value,interpolation?}. Time is clip-local playback seconds, inclusive 0 through item duration. Values override the corresponding static property; clearing automation restores the static value. Before the first and after the last point, the nearest endpoint value holds. Each point controls the interpolation leaving it; omitted interpolation is linear. Hold keeps the current value until the next keyframe time, then changes immediately. No arbitrary expressions are accepted.

Video channels: brightness [-0.5,0.5], contrast [0.5,2], saturation [0,2], rotation [-180,180] degrees, offsetX/offsetY [-1,1] canvas fractions, opacity [0,1]. Audio tracks support volume [0,2]. To animate a video's sound, target its linked audio item. Animation is not automatically copied to linked media. Volume interpolation is evaluated per decoded audio frame, rather than sample-by-sample.

- item_keyframes(sequenceId,itemId,property,frames) replaces one property's points atomically. Unknown fields, duplicate/unsorted times, unsupported properties/interpolation, out-of-duration points, wrong media kind and locked tracks reject without committing.
- item_keyframes_clear(sequenceId,itemId,property?) removes one property's automation or all automation on the selected item. Empty automation maps are removed. Repeated clears are no-ops.
- Both commands use existing plan/edit/saved-plan, revision/project/plan guards and snapshot undo/redo. They require no automatic project migration.

Split, insertion cuts and range fragments evaluate boundary values and partition/rebase curves onto each resulting item, preserving linear/hold output. Fragment points remain bounded; an edit that would exceed the limit rejects and asks the caller to simplify automation. Slip keeps clip-local timing. Move/slide moves the animation with the item. Trim/rate/roll retain local point times; if a shorter duration would strand points, the batch rejects unless those points are updated/cleared in the same batch. Absolute annotation behavior is unchanged.

## Rendering and UI

keyframes.mjs implements bounded validation, evaluation, encoder expression generation and curve slicing. sequences.mjs validates every item and prevents legacy flattening of animated items. sequence-edits.mjs owns typed commands and fragment slicing. Existing engine video/audio filters consume generated numeric-only expressions; native composition renders animated items on their independent tracks. Cache keys include automation through canonical project state.

The selected-item inspector has a property picker, curve plot, add/edit/remove/clear controls and keyframe navigation. Forms use the shared typed commands. UI Add/Edit at an existing time replaces that time's point. Graphs show linear segments or hold steps. Composed frames, continuous playback and exports render the same automation. Heavy encoding stays in local child processes.

## Evidence and verification

keyframe-tests.mjs checks range/order/type/kind/lock failures, atomic rollback, endpoint clamping, linear and hold fragment equivalence, deterministic plans, reopen, undo/redo and isolated linked audio. Real FFmpeg tests measure blue-to-red alpha blending, moving crop regions, a held brightness change, rotation/color filter execution, increasing audio gain and composed-frame output. tests.mjs exercises animated split/dissolve and frame preview through the real STDIO MCP server. The browser workflow covers adding/navigating/clearing automation, composed preview and undo with real Store/Renderer on synthetic scratch media and intercepted HTTP. It is not a live TCP deployment test.

keyframe-render-proof.png compares 0.15 seconds (left) and 3.7 seconds (right) of a synthetic opacity ramp, blue underneath red. keyframe-ui-proof.png shows the inspector on synthetic red footage. These are test artifacts, not the user's video.

Premiere 22 static REA inventory includes Clear All Keyframes and audio/video keyframe display commands. Scoped mappings point to this contract; the original installed application's runtime semantics remain unverified. This implementation does not claim Premiere-equivalent interpolation or complete effect controls.

## Remaining effects scope

Scale/crop/anchor animation, Bezier/eased interpolation and tangents, masks/tracking, blend modes, adjustment layers, effect presets and a complete professional keyframe/effect library remain open. The full original request is not complete. No user project was migrated/edited and no running user process was restarted. Restart Agent Cut/reconnect MCP to load this increment.
