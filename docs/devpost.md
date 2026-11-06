---
title: "HUSH: a horror game where the monster hunts your real heartbeat"
published: false
tags: devchallenge, presagechallenge, gamedev, webdev
---

<!-- Draft. Replace every TODO, and check the required template on the challenge page before posting. -->

*This is a submission for the [Presage SmartSpectra SDK Challenge](https://dev.to/devteam/join-the-presage-smartspectra-sdk-challenge-3000-in-prizes-across-10-winners-1370).*

## What I Built

HUSH is a stealth-horror game where the monster can't see you. It hears you, and what it hears is your real body.

You're hiding in an abandoned 1987 acoustic research bunker. Your webcam reads your pulse and breathing through SmartSpectra, and those readings become your in-game noise. When the Listener, a giant with gramophone horns for a head, stands over your hiding place, the only thing you can do is sit still and physically slow your breathing.

Camera-based vitals get worse with talking and movement, and need a still, well-lit face. Most apps have to fight that. In HUSH, stillness and silence are the whole game, so it creates good measurement conditions just by being played.

## Demo

<!-- TODO: embed the video. -->

Try it without a camera or an API key: run the repo and pick **Judge Mode**. It plays a bundled signal, clearly labelled REPLAY.

## Code

{% github TODO/hush %}

## How It Responds to Human Signals

| Signal | What it does |
|---|---|
| Pulse rate | Slow pressure on your noise level, relative to your own baseline. The Listener whispers the number. |
| Pulse waveform | The HUD oscilloscope, and your own heartbeat played back to you |
| Breathing waveform | The fast control: I detect individual breaths to get rate and regularity |
| Breathing rate | Your resting baseline |
| Talking | A noise spike |
| Expressions | A sudden jump in fear or surprise counts as a flinch |
| Face landmarks | Head movement and stillness |
| Validation status | SIGNAL WEAK hints, in the SDK's own words |

**The most interesting technical problem:** SmartSpectra's breathing rate is a 30-second average, longer than an entire encounter. If the monster listened to that number, your calm breaths wouldn't count until it had already left. So I find peaks in the raw breathing waveform to get a breath-by-breath rate, and use the SDK's rate for the baseline. <!-- TODO: confirm this works live, and add what you saw. -->

**Fairness rules:**

- Low confidence can never make you louder, so bad lighting gets a hint, not a penalty.
- If the camera loses your face, the monster waits.
- Holding your breath never helps. It raises a noise floor, and the final lock counts real breaths.

After every run, an After-Action Report shows your pulse and breathing on a timeline against what happened in the game.

## Prize Categories

<!-- TODO: confirm your choice. Most Creative or Delightful Use is the natural fit. -->

Most Creative or Delightful Use.

## Consent and Data Handling

- A consent screen appears before the camera first turns on, and the webcam preview is off by default.
- HUSH saves no video. Session files contain numbers only and stay on your computer.
- Presage documents vitals as computed on-device. The SDK does go online to check the API key and usage, and to load its models, so there's no offline mode.
- I turned off the SDK's optional telemetry and don't use its cloud LLM feature.
- The one optional AI service is local: report notes from Ollama on your own computer, off by default, and it receives numbers only.
- HUSH is a game, not a medical device. It's labelled 18+ for its horror content, readings are estimates, and it has a Gentle Mode, instant pause and an offer of a break if your pulse reading stays high.

<!-- Optional template field: Agent Session. Your call whether to include it. -->
