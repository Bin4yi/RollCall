/**
 * Renders the Listener's lines to mp3 with OpenAI text-to-speech, into apps/game/public/hush-voice/.
 * Lines are rendered ahead of time so the game needs no key, adds no delay, and never sends a
 * player's pulse reading anywhere. Finished clips are reused, so re-running only pays for changes.
 *
 * Usage: pnpm voice:gen [--dry-run] [--out <dir>]
 * API: https://developers.openai.com/api/docs/guides/text-to-speech
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import lines from '../config/lines.json';
import { voiceKey, voiceLines, type VoicePack } from '../apps/game/src/voice';

const ROOT = resolve(import.meta.dirname, '..');
const envFile = resolve(ROOT, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const MODEL = process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts';
const VOICE = process.env.OPENAI_TTS_VOICE || 'cedar';
const BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const INSTRUCTIONS =
  'You are an ancient, patient creature in a dark bunker. Whisper very slowly in a low, breathy, ' +
  'unhurried voice, close to the listener. Calm and unsettling, never shouting. ' +
  'Treat each ellipsis as a long pause.';
const CONCURRENCY = 4;
const MAX_ATTEMPTS = 4;

const outFlag = process.argv.indexOf('--out');
const OUT =
  outFlag >= 0 ? resolve(process.argv[outFlag + 1]!) : resolve(ROOT, 'apps/game/public/hush-voice');

/** A problem retrying can't fix, such as a bad key or no credit. */
class FatalError extends Error {}

async function render(text: string, apiKey: string): Promise<Uint8Array> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${BASE_URL}/audio/speech`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        voice: VOICE,
        input: text,
        instructions: INSTRUCTIONS,
        response_format: 'mp3',
      }),
    });
    if (res.ok) return new Uint8Array(await res.arrayBuffer());
    const detail = await res.text();
    const outOfCredit = detail.includes('insufficient_quota');
    if (res.status === 401 || res.status === 403 || outOfCredit) {
      throw new FatalError(`OpenAI refused the request (${res.status}): ${detail.slice(0, 300)}`);
    }
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= MAX_ATTEMPTS) {
      throw new Error(`"${text}" failed (${res.status}): ${detail.slice(0, 300)}`);
    }
    await new Promise((done) => setTimeout(done, 1000 * 2 ** attempt));
  }
}

async function main(): Promise<void> {
  const planned = voiceLines(lines.whispers).map((text) => ({
    text,
    key: voiceKey(text),
    file: `${createHash('sha1').update(`${MODEL}|${VOICE}|${INSTRUCTIONS}|${text}`).digest('hex').slice(0, 12)}.mp3`,
  }));
  const missing = planned.filter(({ file }) => !existsSync(resolve(OUT, file)));
  console.log(`${planned.length} lines, ${missing.length} to render (${MODEL}, ${VOICE})`);
  if (process.argv.includes('--dry-run')) {
    console.log(`Characters to send: ${missing.reduce((sum, { text }) => sum + text.length, 0)}`);
    return;
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (missing.length && !apiKey) {
    console.error('Set OPENAI_API_KEY in .env first.');
    process.exitCode = 1;
    return;
  }

  mkdirSync(OUT, { recursive: true });
  const queue = [...missing];
  let done = 0;
  let failure: Error | null = null;
  const worker = async (): Promise<void> => {
    while (!failure) {
      const next = queue.shift();
      if (!next) return;
      try {
        writeFileSync(resolve(OUT, next.file), await render(next.text, apiKey!));
        if (++done % 20 === 0) console.log(`${done}/${missing.length}`);
      } catch (err) {
        failure = err as Error;
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  // Written even after a failure: the game uses what exists and falls back for the rest.
  const finished = planned.filter(({ file }) => existsSync(resolve(OUT, file)));
  const pack: VoicePack = {
    model: MODEL,
    voice: VOICE,
    clips: Object.fromEntries(finished.map(({ key, file }) => [key, file])),
  };
  writeFileSync(resolve(OUT, 'manifest.json'), `${JSON.stringify(pack, null, 1)}\n`);

  if (failure) {
    console.error((failure as Error).message);
    console.error(`Stopped with ${finished.length}/${planned.length} clips. Re-run to continue.`);
    process.exitCode = 1;
    return;
  }
  // Clips from an older voice or script would otherwise stay in git forever.
  const current = new Set(planned.map(({ file }) => file));
  for (const name of readdirSync(OUT)) {
    if (name.endsWith('.mp3') && !current.has(name)) rmSync(resolve(OUT, name));
  }
  console.log(`${finished.length} clips in ${OUT}`);
}

await main();
