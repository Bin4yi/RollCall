# SmartSpectra SDK notes

Checked 2026-11-06 against `Presage-Security/SmartSpectra` commit `b8e8194` (2026-09-29) and `@smartspectra/node-sdk@3.4.0`. "Probed" means I ran it on the dev machine with a valid key. Everything else comes from the docs linked here.

**Dev machine:** Windows 11 Home, Intel i7-1195G7, Iris Xe + GeForce MX350, Node 24.16, one built-in webcam.

**Verified live so far:** a real session reached `kRunning` on the built-in webcam at 30 fps, with talking detection and breathing samples arriving. **No pulse, breathing rate or HRV value has been seen from a real person yet.** See [Open questions](#open-questions).

## Facts the brief asked to verify

| Claim | Result | Source |
|---|---|---|
| Pulse: 12 s average, 40–110 bpm, with confidence | **Confirmed** | [model cards](https://github.com/Presage-Security/SmartSpectra/blob/main/docs/model-cards-and-limitations.md) |
| Breathing: 30 s average, 5–40/min, with confidence | **Confirmed** | same |
| HRV: 60 s window, mean NN, RMSSD, SDNN, Baevsky | **Confirmed.** Fields are `rmssd`, `sdnn`, `meanNn`, `baevsky`, `confidence`, `stable`. Units are **not stated** | [metrics.md](https://github.com/Presage-Security/SmartSpectra/blob/main/nodejs/docs/metrics.md), [measurement-quality.md](https://github.com/Presage-Security/SmartSpectra/blob/main/docs/measurement-quality.md) |
| Stress index read against the user's own baseline | Taken from the brief. I didn't find this wording in the pages I read, so treat it as our rule | not found |
| Breathing traces, lower needs the waistline | **Confirmed** | [data-types.md](https://github.com/Presage-Security/SmartSpectra/blob/main/docs/data-types.md) |
| Pulse waveform is relative, not blood pressure | **Confirmed**: uncalibrated, unitless | same |
| 478 landmarks, blink, talking, 8 expressions | **Confirmed** | same |
| Confidence 0 until each window fills | **Confirmed**. Scale is 0–100, `stable` gates: pulse 40, breathing 45, HRV 50 | measurement-quality.md |
| Node SDK on Windows | **Confirmed and probed**: `win32-x64`, Node 20+ | [nodejs/README.md](https://github.com/Presage-Security/SmartSpectra/blob/main/nodejs/README.md) |
| `enableTelemetry: false` | **Confirmed**: "transmits nothing" | [telemetry-and-privacy.md](https://github.com/Presage-Security/SmartSpectra/blob/main/docs/telemetry-and-privacy.md) |
| Caller-supplied frames | **Confirmed and probed**: `useCustomInput()` + `sendFrame(buf, w, h, stride, format, timestampUs)`. RGB, BGR, RGBA, BGRA, NV12, NV21, YUYV | [api-reference.md](https://github.com/Presage-Security/SmartSpectra/blob/main/nodejs/docs/api-reference.md) |
| **320×240 at ~15 fps from a phone** | **Contradicted.** The docs say "don't let the camera fall below roughly 25 fps; target 30". See below | measurement-quality.md |
| Node SDK crashes on 30 fps browser frames | **Not reproduced.** 30 fps ran live for over a minute. The crash I hit was my own uncaught `sendFrame` throw | probed |

## Frame rate and resolution

The docs give a frame-rate floor but **no resolution requirement**, so I capture at 30 fps, not the brief's 15. `FRAME_RATE_TOO_LOW` is a real validation code. Low light also lowers the rate: the built-in webcam ran at about 20 fps in a dim room and 30 fps with light on the face (probed).

- Same computer as the server: raw NV12, 1280x720.
- Anywhere else: JPEG, 640x480, because raw frames would need far more bandwidth.

**Unverified:** whether JPEG compression or 640x480 affects pulse and HRV quality. Test before relying on phones.

## Where the worker runs: local Node on Windows

Chosen because it's the only option proven here. Docker and WSL commands exist on this machine but weren't needed.

**Server use and Presage's terms:** the SDK README lists "Headless or server-side Node process with host-provided frames" as a supported use. But its licence says use is under [Presage's Terms of Service](https://physiology.presagetech.com/tos), and that page wouldn't load for me (it renders with JavaScript). **I couldn't confirm the terms allow processing other people's frames on a server.** The safest reading until someone reads them: run the worker on your own computer for the demo. The Dockerfile's SDK build is opt-in for this reason.

## Metrics and how they're used

| Signal | Field | Used for |
|---|---|---|
| Pulse | `cardio.pulseRate[]` | Readiness |
| Pulse waveform | `cardio.arterialPressureTrace[]` | Check-in horizon |
| HRV | `cardio.hrv[]` | Readiness: `rmssd`, `baevsky`. Stored: `sdnn`, `meanNn` |
| Breathing rate | `breathing.rate[]` | Readiness |
| Breathing waveform | `breathing.upperTrace[]` | Check-in glow |
| Inhale/exhale, amplitude, apnea flag | `breathing.*` | Normalised, not used |
| Talking | `face.talking[]` | Pauses the check-in |
| Blink, expressions, landmarks | `face.*` | Normalised, not used |
| Validation | `validationStatus` event | Framing hints |

Validation codes, from the SDK's `index.d.ts`: 1 no face, 2 multiple faces, 3 not centred, 4 size out of range (deprecated), 5 too dark, 6 too bright, 7 chest not visible, 10 camera tuning, 11 frame rate too low, 12 excessive motion, 13 too close, 14 too far, 15 too high, 16 too low, 17 not forward. Friendly wording is in `packages/readiness/src/checkin.ts`.

## On-device vs Presage's servers

- Vitals are computed on-device per the [README](https://github.com/Presage-Security/SmartSpectra/blob/main/README.md). In Roll Call "device" means **our server**, so frames do leave the athlete's phone, and the consent screen says so.
- **There is no offline mode** ([headless-testing-in-ci.md](https://github.com/Presage-Security/SmartSpectra/blob/main/docs/headless-testing-in-ci.md)).
- **Probed:** logs show usage verification, metrics authorisation and encrypted model loading, so the SDK needs the network throughout.
- `requestInsight()` sends data to a service. Roll Call never calls it.
- **Wording limit:** the telemetry page's exclusions cover telemetry. I found no blanket statement about frames across all server traffic, so nothing here claims that no frames can ever reach Presage.

## Auth, trial and credits

- Key from the [Developer Portal](https://physiology.presagetech.com/auth/register), passed as `apiKey`.
- Exhaustion raises `kCreditExhausted` (4).
- **What uses a credit is not documented.** Assume session time counts. Judge Mode can't start the SDK, tests blank the key, and `MAX_LIVE_SESSIONS` caps concurrency.

## Stability (all probed)

- **Custom input needs frames to reach `kRunning`.** With no frames the session stayed in `kStarting` for the whole 25 s test. With frames, `kRunning` followed and 689 frames were accepted. So frames must start during `kStarting`.
- **`sendFrame()` throws outside `kStarting`/`kRunning`** with "not in a valid state". Uncaught, it kills the process. The worker gates and catches.
- **A stall over 2 s ends the session unless handled.** The SDK logs `timestamp gap ... exceeds 2 s threshold` and rejects the frame, and its reference doesn't move, so all later frames fail too. `FrameClock` closes up stalls.
- **The SDK needs a steady connection.** Its requests time out after about 3 s (`Connection timed out after 3003 milliseconds`). `Usage verification failed. Status code: 0` repeats, then raises `kNetworkError` (5), which cancels model downloads. On Wi-Fi with up to 50% packet loss, sessions failed about every 15 s. Presage's model cache folders stayed empty, so models may be downloading again each start. Unproven whether the downloads were themselves saturating the link.
- **A session in `kError` stays there.** The worker exits and the broker restarts it, up to 3 times.
- **No metrics until a face is found.** With no face, only validation events arrive, so the worker sends heartbeat frames carrying the validation state.
- **Rejected keys:** a 401 is logged but doesn't reliably raise `error`, so the broker reads the worker's stderr.
- `decodeMetrics` must come from `@smartspectra/node-sdk/messages` ([headless-testing-in-ci.md](https://github.com/Presage-Security/SmartSpectra/blob/main/docs/headless-testing-in-ci.md)).
- Native state is process-global, hence one process per session.
- The npm install is 386 MB across platforms, so it lives in `apps/vitals-worker/runtime`, outside the workspace.

## Medical status

Every doc page says: "SDK metrics are offered for general wellness and informational purposes only. SDK metrics have not been cleared by the FDA and may not be used for medical diagnosis or treatment." Roll Call's 18+ label is its own choice.

## Open questions

Answer these on the first good live session:

- [ ] Do pulse, breathing and HRV reach the confidence gates within 75 seconds on this webcam?
- [ ] Real update rate of each metric, and the sample rate of the traces
- [ ] Do JPEG frames at 640x480 read as well as raw 1280x720?
- [ ] Does iPhone Safari keep up at about 30 fps through the canvas path? Only Chromium has been tested
- [ ] Credits used per check-in (compare the portal before and after)
- [ ] Do models cache after one complete download, and does that make weak connections workable?
- [ ] Do Presage's terms allow server use?
