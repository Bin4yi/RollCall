# Roll Call

![Roll Call: a rooster coach crows as the sun rises over a running track, the horizon a heartbeat](apps/web/public/brand/og.png)

**Every athlete, checked in by sunrise. No wearables.**

A morning readiness check-in for online coaches and their athletes, powered by the [Presage SmartSpectra SDK](https://github.com/Presage-Security/SmartSpectra).

> **Not a medical device.** Readings are wellness estimates to help with training decisions, for adults 18+. The coach makes every decision. Presage states that SDK metrics are for general wellness and informational purposes and have not been cleared by the FDA.

## The problem

A coach with twelve athletes has a phone full of "feeling 6/10 I guess". Wearables cost money, need charging, and half the squad forgets them.

## How it works

1. **The athlete checks in.** A private link, a phone propped up, 75 still seconds and two taps. The sun rises as the progress bar, and the horizon is their live pulse waveform.
2. **The coach sees the board.** Everyone sorted by how far they are from their own usual, with plain reasons like "Pulse 10 above usual · HRV 36% below usual".
3. **The coach decides and sends.** Keep the plan or swap it. AI drafts a note from the numbers only, the coach edits it, and nothing goes until they press Send.

*The coach decides, the AI only drafts, and the camera only measures.*

## Try it

You need Node 22+ and pnpm (`npm i -g pnpm`).

```bash
pnpm install
pnpm dev        # then open http://localhost:5173
```

### Judge Mode

Press **Try it now with demo data**. It needs no camera, no account and no keys. You get 12 fictional athletes with 28 days of invented data, all labelled **DEMO DATA**, and a replayed check-in with a synthetic signal. It never starts the SDK or calls an LLM.

### Live check-ins

```bash
pnpm vitals:setup      # downloads the SDK, about 390 MB
cp .env.example .env   # then add SMARTSPECTRA_API_KEY and COACH_PASSPHRASE
pnpm dev
```

Sign in at `/coach`, add an athlete and open their link. Chrome and Edge are tested. Safari has a fallback capture path that has only been exercised in Chromium. A stable connection matters, because the SDK contacts Presage during a session. Phones need HTTPS for camera access, so use a deployment or an HTTPS tunnel, not a plain LAN address.

`/record` saves reference sessions to `data/sessions/` as numbers only, in development. Real recordings replace the synthetic stand-ins automatically.

## How each SDK signal is used

| SDK signal | Field | In Roll Call |
|---|---|---|
| Pulse rate | `cardio.pulseRate` | Readiness, weight 0.30, against the athlete's own usual |
| HRV (RMSSD) | `cardio.hrv[].rmssd` | Readiness, weight 0.25, compared on a log scale |
| Baevsky stress index | `cardio.hrv[].baevsky` | Readiness, weight 0.15, only against their own usual |
| SDNN, mean NN | `cardio.hrv[].sdnn`, `.meanNn` | Stored and exported |
| Breathing rate | `breathing.rate` | Readiness, weight 0.15 |
| Pulse waveform | `cardio.arterialPressureTrace` | The live horizon. Arbitrary units, shape only |
| Breathing waveform | `breathing.upperTrace` | The sun's breathing glow |
| Talking | `face.talking` | Pauses the check-in, and those readings don't count |
| Validation status | `validationStatus` | Friendly framing hints from Rollo |
| Confidence | On each metric | Below the SDK's gates, a metric is "not read today" |

Sleep (0.10) and how they feel (0.05) are the athlete's own answers. Sources and caveats: [docs/SDK_NOTES.md](docs/SDK_NOTES.md).

## The readiness model

- **Learning:** no status until 5 good check-ins.
- **Baseline:** rolling 14-day median and MAD, from good check-ins only.
- **Deviation:** robust z-score, with a floor so tiny spreads can't explode, counting only the "harder day" direction.
- **Status:** Watch if the combined score is at least 1 or one metric at least 2. Check in if combined is at least 2, or after Watch 3 days running. Statuses hold near a threshold so they don't flicker.
- **Missing data:** low-confidence metrics drop out and the weights renormalise.

Status is a shape and text as well as a colour: sun up, sun rising, sun behind a cloud, moon.

## Architecture

```
athlete browser ── frames ──▶ apps/api ── one process per session ──▶ apps/vitals-worker (SDK)
                ◀─ waveform ─┤   │
coach browser  ◀── REST ─────┘   ├─ packages/readiness  baselines, status, check-in logic (pure)
                                 ├─ packages/drafts     LLM adapters, wording filter, templates
                                 └─ packages/db         SQLite through Drizzle
```

More in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Choices and alternatives: [docs/DECISIONS.md](docs/DECISIONS.md).

## Privacy

- **Video is never saved.** Frames are processed in memory on the Roll Call server and discarded. Only derived numbers are stored.
- **What leaves the server:** the SDK contacts Presage to check its key and usage and to load its models. SDK telemetry is turned off, and its cloud LLM feature is never called.
- **What AI sees:** numbers and the coach's chosen action. Never names, video, notes or session titles.
- **Athletes' control:** export or delete everything from their own page. Deleting ends their link.
- **Coaches** see only their own athletes, and links are unguessable and can be rotated.

## Honesty and limits

- Pulse is validated for 40–110 bpm and breathing for 5–40 per minute. Roll Call never reports pulse above that range.
- Readings are estimates and a status is not a verdict. Pulse also moves with coffee, poor sleep or a stressful commute.
- Coach sign-in is a shared passphrase, which suits a hackathon, not production.
- **Bundled sessions are synthetic**, generated by `tools/seed/gen-sessions.ts` and labelled, until real recordings replace them.

## Development

```bash
pnpm test           # unit and contract tests
pnpm test:e2e       # Playwright, desktop and phone. First run: pnpm --filter @rollcall/web exec playwright install chromium
pnpm typecheck
pnpm lint
pnpm sessions:gen   # rebuild synthetic sessions
pnpm assets:forge   # generate art with OpenAI. Has a spend guard: ASSET_MAX_USD, default 2
pnpm assets:brand   # rebuild icons and share images, free
```

To deploy: `Dockerfile` and `render.yaml` run Judge Mode. Build with `--build-arg WITH_SDK=1` for live check-ins, and read [Presage's terms](https://physiology.presagetech.com/tos) first.

## Credits

- [Presage SmartSpectra SDK](https://github.com/Presage-Security/SmartSpectra) for the measurement. Integration follows its documentation.
- [React](https://react.dev), [Vite](https://vite.dev), [Tailwind CSS](https://tailwindcss.com), [Motion](https://motion.dev), [Recharts](https://recharts.org), [Hono](https://hono.dev), [Drizzle](https://orm.drizzle.team), [libSQL](https://github.com/tursodatabase/libsql), [zod](https://zod.dev), [ws](https://github.com/websockets/ws), [sharp](https://sharp.pixelplumbing.com), [Vitest](https://vitest.dev), [Playwright](https://playwright.dev), [axe](https://github.com/dequelabs/axe-core).
- Illustrations generated with the OpenAI API. Prompts are in `assets/manifest.json`. Every athlete is fictional.

Built for the [Presage SmartSpectra SDK Challenge](https://dev.to/devteam/join-the-presage-smartspectra-sdk-challenge-3000-in-prizes-across-10-winners-1370) on DEV.
