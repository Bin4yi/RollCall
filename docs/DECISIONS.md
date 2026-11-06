# Decisions

| Date | Decision | Why | Alternatives |
|---|---|---|---|
| 2026-11-06 | **Sidecar language: Node/TypeScript** with `@smartspectra/node-sdk@3.4.0` | Officially supported on Windows and loads on the dev machine; same language as the game and shared schema | C++ SDK (Windows is experimental, needs CMake/MSVC); Electron renderer SDK (forces Electron for everything) |
| 2026-11-06 | Default input is browser-captured frames pushed with `sendFrame()`; `HUSH_INPUT=camera` is the alternative | Windows docs say built-in webcams don't work natively, and that's the only camera here | Native `useCamera` only (needs buying a USB webcam) |
| 2026-11-06 | SDK runs in a supervised child; parent owns the vitals socket, child owns the frame socket | A native crash can't kill the game, and the game's connection survives a restart. Frames skip the parent to avoid IPC overhead | All in one process (one crash ends the session) |
| 2026-11-06 | No MediaPipe | The SDK provides 478 landmarks; head motion comes from their bounding box | MediaPipe on the same frames (extra CPU competing with the 25 fps floor) |
| 2026-11-06 | **Breath rate and regularity come from `upperTrace` peak intervals, not `breathing.rate`** | The SDK rate is a 30 s average, longer than an encounter, so it can't be the "fast lever" in §7 | SDK rate as specified (players' breathing changes wouldn't register in time) |
| 2026-11-06 | SDK starts at the tutorial, so calibration ends about 30 s later without feeling longer | Breathing confidence is 0 for the first 30 s | 20–30 s calibration as briefed (impossible for breathing) |
| 2026-11-06 | `apps/sidecar/runtime` is a separate npm project outside the workspace | SDK install is 386 MB across all platforms, which would break "fresh clone running in < 5 min" and slow CI | Workspace dependency; pnpm overrides dropping platforms |
| 2026-11-06 | SDK telemetry off, `requestInsight()` never called | Simplest accurate privacy story for the consent screen | SDK defaults |
| 2026-11-06 | No "cleared measurement" claim; 18+ is HUSH's own label | SDK docs state metrics have not been FDA cleared, which contradicts §14 of the brief | Following the brief's wording (would be false) |
| 2026-11-06 | Golden tests and Judge Mode use clearly labelled synthetic sessions (`data/sessions/synthetic/`) until real recordings exist; real files take priority automatically | Recordings need a person at a webcam and an API key; game work mustn't block on that | Wait for recordings; pass synthetic data off as real (dishonest) |
| 2026-11-06 | HRV is recorded but doesn't affect play | 60 s window is longer than an encounter, and it's easily misread as a health signal | Add to noise model |
| 2026-11-06 | `assets/raw/` is not committed | Intermediate files; `final/` and `anim/` are what the game loads | Commit everything |
