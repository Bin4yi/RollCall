---
title: "Roll Call: every athlete, checked in by sunrise, no wearables"
published: false
tags: devchallenge, presagechallenge, webdev, ai
cover_image: TODO upload apps/web/public/brand/dev-cover.png
---

*This is a submission for the [Presage SmartSpectra SDK Challenge](https://dev.to/devteam/join-the-presage-smartspectra-sdk-challenge-3000-in-prizes-across-10-winners-1370).*

## What I Built

Online coaches run on messages like "feeling 6/10 I guess". **Roll Call** gives a coach a 30-second answer to *who should train hard today?*

Each morning an athlete opens a private link, props up their phone, sits still for 75 seconds and taps two answers. The coach opens one board with everyone sorted by how far they are from **their own usual**. The coach keeps or swaps each session, and an AI draft, written from numbers only, goes out once the coach has edited it and pressed Send.

**The coach decides, the AI only drafts, and the camera only measures.**

## Demo

TODO: embed the video.

TODO: live link. "Try it now with demo data" needs no camera, no account and no keys, and everything in it is labelled DEMO DATA.

## Code

TODO: repo link.

## How It Responds to Human Signals

| SDK signal | What Roll Call does with it |
|---|---|
| Pulse rate (12 s window) | Compared with the athlete's rolling 14-day usual. Heaviest weight in readiness |
| HRV: RMSSD, SDNN, mean NN, Baevsky stress index (60 s window) | RMSSD and the stress index feed readiness, compared only with the athlete's own usual |
| Breathing rate (30 s window) | Part of readiness |
| Pulse and breathing waveforms | The check-in screen: the horizon is the live pulse wave, and a glow follows the breath |
| Talking, face present | The check-in pauses politely, and readings taken while talking don't count |
| Validation codes | Become friendly hints with Rollo, such as "Lean back so your upper chest is in view" |
| Confidence | Below the SDK's documented gates, a metric is "not read today" and drops out of readiness. It's never guessed |

### Three design choices that came from the SDK's limits

**Why 75 seconds.** HRV needs a full 60-second window before its confidence means anything. 75 seconds gives it a settling margin, and talking or moving pauses the clock rather than spoiling the reading.

**Why personal baselines.** The docs say to read the stress index against the same person's own baseline. So there's no league table and no scary single number. The first five check-ins just learn the athlete's usual, using median and MAD so one odd morning doesn't move it.

**Why never during exercise.** Pulse is validated for 40–110 bpm, so Roll Call doesn't report anything above that. The post-session settle check waits until you're seated and calm.

### What I learned the hard way

TODO: keep what's true after your live sessions. Custom input only reaches `kRunning` once it receives frames, so waiting for "running" before sending deadlocks. A stall over 2 seconds makes the SDK reject every later frame unless timestamps are closed up. And the SDK's calls time out after about 3 seconds, so it needs a steady connection for the whole session.

## Prize Categories

Best Thoughtful Real-World Use. TODO: confirm this is still the category you want.

## Consent and Data Handling

- A plain-words consent screen appears before the first check-in.
- Video goes over an encrypted connection to the Roll Call server, is processed in memory and thrown away. It's never saved. Only derived numbers are stored.
- The SDK contacts Presage to check its key and usage and to load its models. SDK telemetry is off.
- AI drafts see numbers and the coach's chosen action. Never names, video, notes or session titles, and a test enforces it.
- Athletes can export or delete everything from their own page.
- Roll Call is not a medical device. Readings are wellness estimates, for adults 18+. The coach makes every decision.

## Agent Session

TODO: optional. Decide whether to include this section.

#presagechallenge
