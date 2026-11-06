# Asset notes

Checked 2026-11-06 against the OpenAI docs and this account's `GET /v1/models`.

## What the API offers

| Question | Answer | Source |
|---|---|---|
| Image models on this key | `gpt-image-1-mini`, `gpt-image-1.5`, `gpt-image-2`, `gpt-image-2.5-*`, `gpt-image-2.6-flare`, `gpt-image-2.6-sunburst`, `chatgpt-image-latest` | `GET /v1/models` (probed) |
| Chosen | `gpt-image-2.6-sunburst`, configurable through `OPENAI_IMAGE_MODEL`. The guide describes Sunburst as the variant for work where editing precision matters | [image guide](https://developers.openai.com/api/docs/guides/image-generation) |
| Sizes | `1024x1024`, `1536x1024`, `1024x1536` recommended; multiples of 16 up to 3840 | same |
| Transparency | `background: "transparent"` with PNG or WebP. **Probed working** on both 2.6 models | same |
| Reference images | `/v1/images/edits` with several files in `image`. **Probed working** | same |
| GIF output | Exists, but failed in our probe: `No supported sheet fits 6 GIF frames at size '1024x1024'`. Not used | probed |
| Video | **Not available.** "The Sora 2 models and Videos API were shut down on September 24, 2026" | [video guide](https://developers.openai.com/api/docs/guides/video-generation) |
| Price | $30 per million image output tokens, about $8 per million image input tokens, about $5 per million text input tokens. The 2.6 rate is from the guide; the input rates are listed for `gpt-image-2` on the pricing page and assumed to match | [pricing](https://developers.openai.com/api/docs/pricing) |

**Real costs seen:** about $0.035 to $0.045 per medium-quality 1536x1024 sheet.

## Budget: $2 for images

The brief's default was `ASSET_MAX_USD=40` and a separate generation per asset. The owner set a **$2 maximum** during the build. So:

- Each API call is a **sheet** of up to 12 sprites on a grid, sliced with `sharp`. One call makes 12 Rollo poses.
- Calls run one at a time. `assets/spend.json` records real token usage, and a call is skipped if the estimate could cross the budget. A failed call isn't retried automatically.
- **Spent: $0.62**, including the first API probe (recorded as a conservative $0.11).

## What's generated, and what isn't

| From the API (62 sprites) | Drawn in code or composed locally, at no cost |
|---|---|
| Rollo: character sheet, 12 poses, 5 feel faces, tangled whistle, 6-frame wave | Status suns (SVG, shape and text, not colour alone) |
| 12 fictional athlete avatars | Logo mark (SVG) |
| Wordmark, landing hero | Check-in skies and sunrise (canvas) |
| Onboarding 4, empty states 2, how-it-works 3, privacy lock | App icons, favicon, OG, DEV cover, thumbnail, poster (`assets:brand`) |
| Sport icons 8, badge art 6 (numbers added in code) | Riso grain (inline SVG noise) |

**Dropped to fit the budget or because it wasn't needed:** the style bible and avatar anchor sheets (style is carried by the shared prompt and Rollo's reference), weather scene variants, sticker set, email header strip, whistle and celebrate animations. Only the wave has frames.

**Two sheets were regenerated:** the first avatar and how-it-works sheets gave clothes three stripes, which looks like a real brand's mark. The prompts now ask for plain clothing.

## Motion

Sora is gone, so motion is code first: the rising sun, live heartbeat horizon and breathing glow (canvas), status transitions and page movement (Motion). The Rollo wave is a sprite sheet + JSON, transparent WebM and GIF in `apps/web/public/assets/anim/`, built with `ffmpeg-static`. The app plays the sprite sheet on the consent screen. All of it respects `prefers-reduced-motion`.

## Provenance

`assets/manifest.json` keeps every prompt. `assets/gallery.html` shows everything for review. Every athlete is fictional, and images are illustrated, never photographic.
