# Local 360 reframing — 2026-10-19

Build `spherical-reframe-2026-10-19` adds original Agent Cut projection tools. Insta360 Studio remains responsible for proprietary INSV stitching and FlowState stabilization. No Insta360 binaries or models are bundled, copied or invoked through an unverified private API.

## Workflow

1. In installed Studio, open the original X4 recording. Export **360 Video**, full sphere, mono 2:1 equirectangular MP4. Bake the desired stabilization into this export. A flat Studio export cannot be reframed as a sphere.
2. Import the stitched MP4 into Agent Cut. Open **360° reframing → Suggest four angles**, choose a source window up to 120 seconds and explicitly confirm the projection.
3. Review columns **front / right / back / left** and rows **start / middle / end**. These directions use the exported sphere's coordinates; they are sample choices, not semantic rankings or tracked subjects.
4. Choose a direction and optionally adjust opening/ending yaw, pitch, horizontal FOV and output shape. Rendering creates a separate H.264/AAC flat MP4, with audio if the source has it. Use **Review completed 360 job** to play it.
5. Import that flat result explicitly, then use normal reviewed timeline plans. Rendering alone never changes the project or inserts a clip.

## MCP

Read `project_read` first. Call `sphere_reframe` with `action: "contracts"` and the current `expectedProjectId`. It returns the closed schemas for `suggest` and `render`. Both job starts require current `expectedRevision`, a local imported `assetId`, `projection: "equirectangular"`, `stitched: true`, and a source `start`/`end`.

Poll `render_status`, then call `sphere_reframe` with `action: "read"`, project identity and `jobId`. Suggestions return a native MCP image; a render returns a verified local output path. `job_control` supports cancellation and retained-request retry. Retry rejects changed source/decoder inputs. Completed review metadata and derived media are bound to stored SHA-256 digests.

Rendering accepts 1–32 clip-local camera keyframes `{time,yaw,pitch,roll,hFov}`. Yaw/roll are −180…180°, pitch −85…85°, horizontal FOV 30…120°. Output dimensions must be even, 160…1920, at 1…30 fps. Smoothstep interpolation uses the shortest yaw/roll arc; full spins are intentionally unsupported. The manual panel exposes two endpoints; MCP exposes the complete path.

## Evidence and limits

The real X4 sample `VID_20251012_045016_00_001.insv` contains two HEVC 2880×2880 fisheye streams and stereo audio. Normal installed Studio 6.0.6 UI export produced a 4.84-second 4320×2160 H.264 file with equirectangular spherical metadata and AAC stereo. FlowState was visibly enabled in the export settings. Agent Cut produced 12 rectilinear candidate frames and a 720×1280 camera-path demonstration with stereo audio. Original source and project hashes stayed unchanged in the isolated acceptance profile.

The REA evidence, Studio settings/success screenshots, actual media acceptance and browser report are under `outputs/insta360-integration` in the workspace. Static REA inspection found private `ExportMain`/`studio_worker.dll` dispatch, but did not establish a supported headless stitching protocol. This release therefore uses an explicit Studio-export bridge.

This increment does not provide native INSV import/stitching, gyro metadata editing, automatic subject tracking, semantic angle ranking, optical seam repair, ambisonic audio, HDR color management, 360 timeline effects or spherical output export. The tested Studio input is SDR BT.709. Exact 2:1 dimensions alone cannot prove that a video is stitched; confirmation remains required. No internet calls or downloads are part of the workflow.
