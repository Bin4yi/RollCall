# Architecture

```
 browser (Chrome/Edge)                               sidecar (Node)
┌────────────────────────────────┐                  ┌──────────────────────────────┐
│ apps/game                      │  ws :8765        │ supervisor.ts                │
│  LiveSource ◀───VitalsFrame────┼──────────────────┼─ owns the socket, recording, │
│  (or ReplaySource / SimSource) │  ───control────▶ │  restarts, credit protection │
│      │                         │                  │     ▲ IPC        ▼ fork      │
│  SignalBus                     │                  │ worker.ts                    │
│   ├ engine Run (10 Hz)         │  ws :8766        │  SmartSpectra SDK            │
│   ├ scene and HUD (Pixi)       │  ──raw frames──▶ │  MetricsNormalizer           │
│   ├ audio                      │                  └──────────────────────────────┘
│   └ Recorder                   │
│ frameWorker.ts (Web Worker) ───┘
└────────────────────────────────┘
```

## Rules the layout enforces

- **Pure logic has no DOM.** `packages/signals`, `packages/engine` and `packages/report` run in plain Node and are unit tested there. `apps/game` only draws and handles input.
- **One clock.** Sources have no timers. The game calls `source.advance(100)` then `run.tick(0.1)`, so the same inputs always give the same run, at any speed.
- **Native code is isolated.** Only `worker.ts` touches the SDK. If it dies, the supervisor restarts it and the game's socket stays open.
- **Frames skip the supervisor.** Pushing 40 MB/s through IPC would be wasteful, so the browser talks straight to the worker.
- **The SDK only runs when asked.** The worker starts on a `start` message and stops 10 s after the last client leaves.

## Signal flow

`VitalsFrame` (`packages/signals/src/schema.ts`) is the only contract between sources and the engine. `MetricsNormalizer` converts SDK packets into it: confidence 0–100 becomes 0..1, repeated waveform samples are removed, and the head position comes from the landmark bounding box.

## Why breathing comes from the waveform

The SDK's breathing rate is a 30 s average, longer than a whole encounter. `BreathAnalyzer` finds peaks in the raw chest waveform instead, which gives a breath rate and regularity that respond within a few breaths. The SDK rate sets the baseline and is the fallback when no trusted waveform is available.

## Fairness

- Each noise term has a gate: under low confidence it may fall, but not rise.
- A final guard stops total noise rising at all during low trust, because a calm player who loses signal would otherwise lose the calm bonus and get louder.
- The exception is the SDK's own "excessive motion" code, since motion is the thing it's reporting.
- Losing the face for over 3 s freezes the Listener.
- Breath-holding raises a noise floor, cancels the calm bonus, and can't open the finale lock, which counts real breaths.
