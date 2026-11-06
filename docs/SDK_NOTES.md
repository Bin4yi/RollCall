# SmartSpectra SDK notes (Phase 0)

Checked 2026-11-06 against `Presage-Security/SmartSpectra` commit `b8e8194` (2026-09-29) and the npm package `@smartspectra/node-sdk@3.4.0`. "Probed" means I ran it on the dev machine. Everything else comes from the docs linked here and still needs confirming on a live session.

**Dev machine:** Windows 11 Home, Intel i7-1195G7, Iris Xe + GeForce MX350, Node 24.16, one camera ("Integrated Webcam").

**Not yet verified:** no live measurement has run, because that needs an API key and a person at the webcam. See [Open questions](#open-questions).

## Platforms available today

| Platform | Status | Source |
|---|---|---|
| Node.js / Electron (win32-x64, linux-x64/arm64, darwin-arm64) | Supported | [nodejs/README.md](https://github.com/Presage-Security/SmartSpectra/blob/main/nodejs/README.md) |
| C++ on Windows 10/11 x64 | **Experimental**, ZIP | [cpp/README.md](https://github.com/Presage-Security/SmartSpectra/blob/main/cpp/README.md) |
| C++ on macOS Apple Silicon | Supported | same |
| C++ on Ubuntu / Debian | Experimental | same |
| Swift (iOS), Android | Supported, not relevant here | [README.md](https://github.com/Presage-Security/SmartSpectra/blob/main/README.md) |

## Most reliable path on this machine

Node SDK with **custom frame input** (`useCustomInput()` + `sendFrame()`), with the frames captured in the browser.

The Windows C++ docs say built-in webcams do not work and name a USB Logitech C920 as the tested camera ([issues-and-limitations.md](https://github.com/Presage-Security/SmartSpectra/blob/main/cpp/docs/windows/issues-and-limitations.md)). This machine only has a built-in webcam. The Node runtime wraps the same native code, so native `useCamera()` is expected to hit the same problem. It is unconfirmed for Node.

Browser capture sidesteps it, and it's the same approach as the SDK's own Electron renderer path. `HUSH_INPUT=camera` remains available for anyone with a USB webcam.

**Probed:**

- The package loads on Node 24 / Windows without an install step.
- `availableCameras()` returns the integrated webcam with `facing: unknown` (as documented, so select by ID).
- A session starts and tears down cleanly.

## Metrics available live

Field paths are from [data-types.md](https://github.com/Presage-Security/SmartSpectra/blob/main/docs/data-types.md) and [nodejs/docs/metrics.md](https://github.com/Presage-Security/SmartSpectra/blob/main/nodejs/docs/metrics.md). Bundle contents were probed. Timing is from [model-cards-and-limitations.md](https://github.com/Presage-Security/SmartSpectra/blob/main/docs/model-cards-and-limitations.md) and [measurement-quality.md](https://github.com/Presage-Security/SmartSpectra/blob/main/docs/measurement-quality.md).

| Signal | Status | Field | Bundle | Timing and gating |
|---|---|---|---|---|
| Pulse rate | **available** | `cardio.pulseRate[]` | cardio | 12 s average; confidence 0 until full; `stable` at conf ≥ 40; validated 40–110 BPM |
| Pulse waveform (pleth stand-in) | **available** | `cardio.arterialPressureTrace[]` | cardio | Uncalibrated, unitless; shape only, not a pressure reading |
| Breathing rate | **available** | `breathing.rate[]` | breathing | **30 s average**; confidence 0 until full; `stable` at conf ≥ 45; validated 5–40 br/min |
| Breathing waveform | **available** | `breathing.upperTrace[]`, `lowerTrace[]` | breathing | No own confidence; `stable` inherited from rate; lower trace needs the waistline in view |
| Inhale/exhale | **available** | `breathing.inhaleExhaleRatio[]` | breathing | Timing not documented |
| Breathing amplitude | **available** | `breathing.amplitude[]` | breathing | Timing not documented |
| Apnea flag | **available** | `breathing.apnea[].detected` | breathing | Internal input only; the word never appears in UI |
| HRV | **available** | `cardio.hrv[].rmssd` etc. | cardio | 60 s window; `stable` at conf ≥ 50. Recorded, not used in play: too slow, and the window is longer than most encounters |
| Expressions | **available** | `face.expression[].scores[]` | face | 0–100 per type |
| Talking | **available** | `face.talking[].detected` | face | Accuracy not documented |
| Blink | **available** | `face.blinking[].detected` | face | |
| Face landmarks | **available** | `face.landmarks[].value[]` (478 points) | face | Pixel vs normalised units **unclear**; the normaliser handles both. Fails when the face is rotated well away |
| Head pose / motion | **not available directly** | | | Derived from landmark bounding box. MediaPipe is not needed |
| Validation status | **available** | `validationStatus` event: code, hint | | `hint` is designed to be shown as-is; docs recommend debouncing |
| Update rate per metric | **unclear** | | | Not documented; measure on the first live session |

## What this changes in the design

1. **SDK rates cannot be the fast lever.** §7 of the brief treats breathing as fast, but `breathing.rate` is a 30 s average, longer than a whole encounter. The noise model instead derives instantaneous rate and regularity from peak intervals in `upperTrace`, and the SDK rate is only the baseline and fallback. This is what makes "slow your breathing and it walks past" work inside 20–35 s.
2. **Calibration takes about 30 s longer than planned.** Breathing confidence is zero until 30 s. The SDK starts when the tutorial starts, so its window fills during the tutorial cards rather than making players stare at a progress bar.
3. **The chest must be in frame** (`kChestNotVisible`), so setup asks players to sit back. Dark clothing and stripes also reduce breathing quality.
4. **The screen should not be the main light.** The docs warn that a TV or monitor as primary light causes flicker problems, so the calibration glow is a small help only and the guidance asks for a real lamp.
5. **Frame rate must stay ≥ ~25 fps.** Capture therefore runs in a Web Worker, away from the game's render loop.
6. **Fast motion can give confident wrong answers.** The docs say large motion can produce "deceptively high confidence", so `kExcessiveMotion` counts as low trust even when confidence is high.
7. **Pulse above 110 BPM is outside the validated range.** The post-exercise session will exceed this. The report labels such readings as estimates.

## Frame input

**Yes, the SDK accepts frames I supply:** `useCustomInput(transform)`, then `sendFrame(buf, w, h, stride, pixelFormat, timestampUs)`. Formats are RGB, BGR, RGBA, BGRA, NV12, NV21, YUYV ([api-reference.md](https://github.com/Presage-Security/SmartSpectra/blob/main/nodejs/docs/api-reference.md)). Timestamps must be monotonic (`kNonMonotonicTimestamp`), and `kTimestampGap` also exists. It can also own the camera (`useCamera`) or read a video file (`useFile`).

## On-device vs cloud

- Vitals are computed on-device, per the [README](https://github.com/Presage-Security/SmartSpectra/blob/main/README.md) ("the vitals the SDK computes on-device").
- **There is no offline mode.** Measurement authenticates online ([headless-testing-in-ci.md](https://github.com/Presage-Security/SmartSpectra/blob/main/docs/headless-testing-in-ci.md)).
- **Probed:** logs show `auth_client` usage verification, a "metrics authorization" call and encrypted model loading (`secure_model_loader`), so models or licences are fetched or unlocked at runtime.
- Telemetry is on by default. It is aggregate-only, and excludes raw frames, measured values and identifiers. `enableTelemetry: false` means it "transmits nothing" ([telemetry-and-privacy.md](https://github.com/Presage-Security/SmartSpectra/blob/main/docs/telemetry-and-privacy.md)). **HUSH turns it off.**
- LLM Insights send data to a service. **HUSH never calls `requestInsight()`.**
- **Wording limit:** the telemetry page's exclusions cover telemetry, and I found no blanket statement about raw frames across all server traffic. README and consent copy therefore say what is documented and don't say "nothing ever leaves your device".

## Auth, trial and credits

- API key from [physiology.presagetech.com](https://physiology.presagetech.com/auth/login), passed as `apiKey`.
- The challenge "runs on Presage's free trial, with no extra credits provided"; limit problems go to the Presage Discord ([challenge post](https://dev.to/devteam/join-the-presage-smartspectra-sdk-challenge-3000-in-prizes-across-10-winners-1370)).
- Credits are per account (`usage.get_plan` in [mcp-server.md](https://github.com/Presage-Security/SmartSpectra/blob/main/docs/mcp-server.md)), and exhaustion raises `kCreditExhausted`.
- **What consumes a credit, and how many the trial has, is not documented.** Assume session time counts. The sidecar only runs the SDK while a client has asked it to, and stops it when none is connected.

## Stability

- **30 fps browser frames crashing the Node SDK:** nothing in the current docs or troubleshooting table mentions it, and the README calls `sendFrame()` at 30 fps negligible overhead. The crash I reproduced had the cause described below, but a dummy key never reaches `kRunning`, so frames haven't been through a running session. **Unverified until a live session.** The SDK runs in a supervised child process anyway, so a crash cannot take down the game.
- **Silent auth failure (probed):** with an unreachable auth server the session logged `Connection timed out after 3000 milliseconds` and went back to idle **without firing an `error` event**. With an invalid key and working network, a session that pushed frames got `error` code 2 (`kAuthenticationFailed`) at about 3 s, but a session waiting to push frames logged `401` and stayed in `kStarting` for 25 s with no `error` event. The sidecar therefore reads the worker's stderr for 401s, and its watchdog treats "started but never running" as a failure.
- **`sendFrame()` throws outside a starting or running session (probed):** it raises "SmartSpectra is not in a valid state" (`kInvalidState`). An uncaught throw killed the worker about a second after frames started. It resembled the reported crash but wasn't native. The worker now only sends during `kStarting` and `kRunning`, and catches throws.
- **A stall over 2 s ends the session unless handled (probed):** the SDK logs `timestamp gap ... exceeds 2 s threshold` and rejects the frame, and its reference point doesn't move, so all later frames are rejected too. `FrameClock` in the worker closes up stalls.
- **The SDK needs a steady connection during a session (probed on Wi-Fi with up to 50% packet loss and round trips of 2–3 s):** its requests time out after about 3 s (`POST /v2/device_keys`, `Connection timed out after 3003 milliseconds`). `Usage verification failed. Status code: 0` repeats during a session, then raises `kNetworkError` (5), which cancels any model download in progress. The session then stays in error, so the worker exits and the supervisor restarts it, up to 5 times. On that connection sessions failed about every 15 s. Whether the model downloads themselves were saturating the link is untested.
- **Custom input needs frames to reach `kRunning` (probed with a valid key):** with no frames the session stayed in `kStarting` for the whole 25 s test; with frames, `kRunning` followed and 689 frames were accepted with no throws. An earlier version of the worker waited for `kRunning` before sending, which deadlocked every live session. The dummy-key tests couldn't show this.
- Native state is process-global: await `destroy()` before creating a new session. Another reason for one child process per session.
- `decodeMetrics` must come from `@smartspectra/node-sdk/messages`. The root export returns a raw Buffer unless a class is registered ([nodejs/docs/headless-testing-in-ci.md](https://github.com/Presage-Security/SmartSpectra/blob/main/nodejs/docs/headless-testing-in-ci.md)).
- The npm install is 386 MB (all platforms). It lives in `apps/sidecar/runtime`, outside the workspace, so Judge Mode never downloads it.

## Medical status

Every doc page says: "SDK metrics are offered for general wellness and informational purposes only. SDK metrics have not been cleared by the FDA and may not be used for medical diagnosis or treatment."

**This contradicts §14 of the brief**, which refers to "Presage's cleared measurement". I found no adult-population statement in the docs either. HUSH keeps the 18+ label as its own choice for horror content and makes no clearance claim.

## Open questions

Answer these on the first live session:

- [ ] Do browser-pushed frames work end to end with the integrated webcam?
- [ ] Real update rate of each metric, and the sample rate of the traces
- [ ] Landmark coordinate units
- [ ] Does `upperTrace` respond quickly enough for peak detection to track a deliberate change in breathing?
- [ ] Credits used per minute (check the portal before and after `calm_60s`)
- [ ] Does 30 fps at 720p stay stable, or does the reported crash reproduce?
