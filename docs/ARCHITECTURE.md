# Architecture

```
 Athlete browser                         Server                                 Coach browser
 ┌───────────────────────┐ /ws/frames   ┌────────────────────────────────┐     ┌────────────────┐
 │ camera → FrameCapture │ ───────────▶ │ apps/api  (Hono + ws)          │     │ Roll Call board│
 │ sunrise + waveform    │ /ws/checkin  │  check-in sockets, auth        │◀───▶│ athlete detail │
 │                       │ ◀─────────── │  CheckinSession per check-in   │ REST│ decide & send  │
 └───────────────────────┘ ticks,result │        │ fork, one per session │     └────────────────┘
                                        │        ▼                       │
                                        │ apps/vitals-worker  ──▶ Presage│
                                        │  SDK, frames in memory only    │
                                        │ packages/readiness, drafts, db │
                                        └────────────────────────────────┘
```

## Packages

| Path | What | Notes |
|---|---|---|
| `packages/signals` | `VitalsFrame` schema, SDK normaliser, replay and sim sources, recorder | No DOM |
| `packages/readiness` | Baselines, deviations, status, reasons, the check-in state machine, banned words | Pure, deterministic, no I/O |
| `packages/drafts` | LLM adapters, prompt, banned-words check, templates | Input type has no field for names or notes |
| `packages/db` | Drizzle schema, board and detail queries, demo seed | SQLite through libSQL |
| `apps/vitals-worker` | One SDK session in one child process | The only code touching native SDK |
| `apps/api` | Routes, sockets, broker, notifications | Serves the built web app in production |
| `apps/web` | React PWA | `/`, `/a/<token>`, `/coach`, `/record` (development) |
| `tools/asset-forge` | OpenAI art pipeline with a spend guard | `assets:forge`, `assets:brand` |
| `tools/seed` | Synthetic reference sessions | `sessions:gen` |

## One check-in

1. The browser opens `/ws/checkin?token=…`. The server checks the token and consent, and picks a source.
2. **Live:** it forks a worker. The browser opens `/ws/frames?session=…`. Frames are forwarded to the worker's private localhost socket and dropped.
3. Every 100 ms a `VitalsFrame` reaches `CheckinSession`, which decides whether framing is good, counts only good seconds, and sends a tick. If the SDK has no metrics yet, a heartbeat frame still carries its validation state.
4. At 75 good seconds the session summarises trusted readings, the worker stops, and the numbers are stored. Low-confidence metrics are stored as absent.

Replay and sim go through the same `CheckinSession`, on the server, so they behave exactly like live.

## Why a separate process per session

The SDK's native state is process-global, and a native crash must not end anyone else's check-in. A worker in `kError` exits, and the broker starts another, up to 3 times. `MAX_LIVE_SESSIONS` limits how many run at once.

## Frame formats

| Where | Frames | Why |
|---|---|---|
| Browser on the server's computer | Raw NV12, 1280x720, 30 fps | Loopback can carry it; no compression artefacts |
| Phone or remote, Chromium | JPEG, 640x480, 30 fps, from a Web Worker | 30 raw frames a second would swamp Wi-Fi |
| Safari | JPEG from a canvas | No `MediaStreamTrackProcessor` |

## Data boundaries

- **Frames** are never written to disk. The only recorder stores `VitalsFrame` numbers, and only in development.
- **Real and demo data** are separated by a `workspace` column on athletes, enforced in every coach query.
- **Judge Mode** can't start the SDK, call the LLM or send a notification.
- **Dates** use the server's calendar day (`APP_TIMEZONE`), so an evening settle check doesn't land on tomorrow's UTC date.
