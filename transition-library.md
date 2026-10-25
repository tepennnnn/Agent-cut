# Agent Cut transition library

Build transition-library-2026-10-25 adds 176 choices for a total of 257 transitions: 7 existing basics, 74 WGFX adaptations, 51 additional FFmpeg xfade effects and all 125 shaders from GL Transitions 1.76.1. Seven native effects duplicate existing basics and are not added as extra menu entries.

## Use

Restart the usual Agent Cut launcher. In Story Studio, use Search transitions, select Scene transition and its duration, then Save story changes and Compose preview. Existing narration and subtitle times are preserved. Export the reviewed MP4. The main v2 editor has the same list under outgoing video item → Advanced inspector → Transition, with a search field. Normal timeline transition overlap behavior is unchanged. All existing preset IDs remain valid.

GL effects include Book Flip, Film Burn, Dreamy Zoom, Cross Zoom, Cube, Inverted Page Curl, Ripple, Luma and many more. Shader parameters use the pinned upstream defaults. Luma and Displacement use deterministic built-in grayscale maps. Custom parameter/map editing is not exposed in this release.

## Local rendering

Native transitions use the installed FFmpeg xfade implementation. GL effects run the original GLSL in an isolated, headless local Chrome or Edge process; no browser download or remote rendering service is used. Your current PC already has supported browsers. Other PCs need local Chrome/Edge, or can select FFmpeg/basic/WGFX effects. Hardware or software WebGL may be used by the browser.

The GL renderer extracts only the transition windows into local PNGs, renders their frames, and feeds an alpha-preserving intermediate to the same sequence compositor used for previews and exports. Temporary PNGs and successful intermediate movies are removed. One owned browser is reused inside a composition and closed on completion/failure/cancel. The render page and frame server bind only to 127.0.0.1 and block external page requests. No media is uploaded.

Transitions blend two independently transformed clip sources, with correct track ordering and alpha compositing. Clip audio is mixed by the existing audio path. Captions/titles are drawn afterwards, and Story Studio maintains narration/image/caption timing. Native/GL chains can coexist with WGFX/basic effects. Bounded previews include enough transition context. Existing mask/non-normal-blend and nesting draft restrictions still apply.

GL transitions may take longer than simple fades, especially at high resolution or on software WebGL. The existing queue, cancel, memory and preview cache limits remain enforced. Native transitions are available without a browser. Upstream shader alpha behavior and default visual design are retained; some effects deliberately introduce opaque colors or borders between their endpoints. WGFX choices retain their previously documented approximations.

## Frozen resources and cache

New GL jobs record the shader library digest, rendering page digest and local browser file identity. Retry/apply rejects changed resources. Frame and draft caches include those identities. Existing projects, media, voice references, TTS setup and MCP registration are preserved by installation.

## Development / evidence

- Source: https://github.com/gl-transitions/gl-transitions ; package pinned to 1.76.1.
- Most GL shaders are MIT; InvertedPageCurl is BSD 3 Clause and StereoViewer BSD 2 Clause. Original headers/authors are retained in gl-transition-library.json and THIRD-PARTY-TRANSITIONS.md. Playwright Core is Apache 2.0; its license/notice are retained with the dependency.
- npm run build:transitions regenerates the catalog from the pinned package and installed FFmpeg inventory.
- npm run test:transition-library runs all 51 additional native video renders, 125 GL shaders at five progress points, endpoint orientation, alpha/layering, mixed chains, bounded phase, undo, cancellation and frozen identity tests.
- npm test runs the existing regression suite. Browser acceptance uses real local HTTP/MCP calls, not intercepted API responses.

See transition-library-verification.json and the adjacent agent-cut-transition-library-demo folder for results, screenshots and a real portrait story export.
