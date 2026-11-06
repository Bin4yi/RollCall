# MediaPipe notes

Checked 2026-11-06 against the [Pose Landmarker web guide](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js), the [overview](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker) and `@mediapipe/tasks-vision@1.2.2` on npm (Apache-2.0).

## What the API gives

| Thing | Detail | Source |
|---|---|---|
| Package | `@mediapipe/tasks-vision`: `FilesetResolver.forVisionTasks(wasmUrl)`, `PoseLandmarker.createFromOptions(vision, options)` | web guide |
| Options used | `baseOptions: { modelAssetPath, delegate: 'GPU' }`, `runningMode: 'VIDEO'`, `numPoses: 1`. Web supports only `IMAGE` and `VIDEO` modes | web guide, overview |
| Per frame | `detectForVideo(video, timestampMs)` | web guide |
| Result | `landmarks` (normalised x, y in 0..1, z relative to the hips) and `worldLandmarks` (metres, origin at the hips), 33 points, each with `visibility` and `presence` | web guide |
| Landmark ids | 0 nose; 11, 12 shoulders; 13, 14 elbows; 15, 16 wrists; 23, 24 hips; 25, 26 knees; 27, 28 ankles; 29, 30 heels; 31, 32 foot index | overview |
| Models | Lite, full and heavy, all float16. Roll Call uses lite for frame rate. The guide gives no file sizes or latency figures | overview |

**Not stated by the docs:** a licence for the model files themselves (the page links a model card), and any latency figures. Real frame rates on phones are unmeasured here.

## How it's used

- Runs **in the browser, on the phone**, lazy-loaded the first time Legs or Train opens. The app downloads the WASM from jsDelivr (pinned to the installed version) and the model from Google's storage. **Pose frames never leave the device**, only derived numbers.
- **MediaPipe has its own usage log.** Found by a test, not in the docs: version 1.2.2 POSTs to `https://odml.pa.googleapis.com/v1/log`. From reading `vision_bundle.mjs`, it holds the task type, running mode, OS family, library version, and counts and timings of inferences. No images or landmarks. It's on unconditionally, and neither the guide nor `vision.d.ts` shows an off switch. **Roll Call blocks it** with a `connect-src` Content-Security-Policy in `index.html`, which limits the page to its own server and the two download hosts. The library treats the refusal as a failed send and stops trying. `apps/web/e2e/live-pose.spec.ts` checks nothing else goes out. The policy lives in the page, so a self-hosted copy without it would send that log.
- The camera asks for `frameRate: { ideal: 60 }` and takes what it gets. The real rate is measured and stored with each jump.
- Frames are timestamped with `performance.now()`, and `requestVideoFrameCallback` paces detection where available.
- Landmarks pass a **One Euro filter** (`packages/pose/src/filter.ts`), tuned quick because jump timing can't afford lag, then a **visibility gate** of 0.5. Frames missing what a measurement needs are ignored, never guessed.
- If GPU setup fails, it falls back to the CPU delegate.

## Jump height

Height comes from flight time: **h = g·t²/8**. Take-off is when both ankles rise above their standing level by 3.5% of leg length; landing is when the first comes back.

**Frame-rate error.** Height goes with flight time squared, so its relative error is about twice the time error. At 30 fps one frame is 33 ms; against 0.45 s of flight that's about **15% of jump height** (`frameError()`, tested). At 60 fps it's about 7%.

**How it's reduced:**

- The exact moments are **interpolated** between the frames either side of the crossing, rather than rounded to a frame.
- **Best of three** valid jumps.
- Only **change against the person's own usual** is ever shown, with a "±5% typical error" note. Absolute centimetres are never shown. The same camera, spot and method each day means much of the error cancels, though that's an assumption until real data exists.

**Cross-check.** Hip rise from take-off to the top, scaled by leg length, should agree with the flight-time height. If they differ by more than 45%, the jump is flagged and another is asked for. The leg length in metres is an assumed 0.85 m, so this catches odd jumps, not small errors.

**Why knee angle comes from extension.** In the front view a bending knee points at the camera, so a 2D knee angle barely changes. Hip-to-ankle distance does shrink, and with two equal leg bones `distance = leg · sin(angle / 2)`. The landing check reads the last airborne frame, because knees normally give just after touch-down.

**Rejections:** knees tucked at landing (more than 25° below take-off, which fakes flight time), hands off hips, out of frame, too few frames in the air (under 4), methods disagree. Up to six attempts.

## Reps and form

A state machine on one key joint angle, per exercise (`packages/pose/src/exercises/`), with hysteresis, and a minimum range so half-reps don't count. Rep speed is timed over the part of the lift clear of the turning point, where pauses and jitter would swamp a short movement, and normalised by torso length. So it's only comparable within a person, which is all it's used for.

**Knees caving needs the front view,** but squats default to side-on for depth. The check only runs when the feet are visibly apart, so it stays quiet side-on.

## What has and hasn't been tested

- **Logic:** unit tests on generated stick-figure sessions, which are clearly labelled synthetic. They prove the maths and state machines, not accuracy on a real body.
- **Real MediaPipe, live path:** `apps/web/e2e/live-pose.spec.ts` feeds a generated photo of a fictional person, slid up and down, through Chromium's fake camera. The model loads under the page's security policy, finds the whole body, detects jumps, and only numbers are saved. Software rendering here gave about 3 fps, so every jump was correctly rejected as "too few frames". That also shows the app refuses to measure when the frame rate is too low.
- **Real MediaPipe, virtual 30 fps clock:** the same photo through the real model, frame by frame. A true 500 ms flight read **481 and 483 ms**: a small, consistent under-read (about 7% in height, because the threshold sits above the floor), with about 0.4% between jumps. Both passed the checks. A sliding photo has no knee bend or arm swing, so this checks landmark noise, not real jumps.
- **Real MediaPipe on AI-generated clips (16 clips, 10 s, 24 fps):** run with `extract-poses.spec.ts`, scored by `pnpm videos:report`. AI video doesn't follow real physics or timing, so this checks tracking and counting, never accuracy.

  | Clip | Expected | Got |
  |---|---|---|
  | Good jumps | Valid | 2 valid |
  | Hands off hips | Rejected | Rejected, correct reason |
  | Tucked landing | Tucked | Rejected, but as "methods disagree" |
  | Side squats, goblet squats | 6 reps | 6 and 6 |
  | Shallow squats | Partials or depth cue | 2 reps with depth cue, 2 partials |
  | Push-ups | 6 reps, fatigue stop | 5 reps and 1 partial, fatigue stop at rep 5 |
  | Balance | Timed, with sway | Timed, with sway |
  | Plank | Hold, sag | Held 7.3 s, 15% sag, ankles often not seen |
  | **Lunges** | 6 reps | **2** |
  | **Glute bridges** | 6 reps | **0** |
  | **Overhead press** | 6 reps | **1, plus 6 partials** |
  | **Knees caving** | Flagged | **Not flagged** (depth was) |
  | **Sagging push-ups** | Flagged | **Not flagged** |
  | **Bad framing** | "Feet cut off" hint | **Hint never fired.** The clip's feet are in frame, so this may be the clip, not the code |

  So lunge, bridge, press and the two form checks don't work on real landmarks yet, even though they pass on the stick figure. The demo video leaves them out.
- **Not tested:** a real person jumping or training, reps on real landmarks, real phones, real frame rates, and how well any threshold here suits real bodies. Record sessions at `/record-pose` to change that.

## Approach credit

Written fresh for this repo. Nothing was adapted from RepForge or RepCheck, so no credit line is needed.
