import { numberToWords } from './manifest';

/** Pure voice-pack lookups, shared by the game and tools/gen-voice.ts. */
export interface VoicePack {
  model: string;
  voice: string;
  /** voiceKey(line) to a file name in /hush-voice/. */
  clips: Record<string, string>;
}

/** Pulse readings with a recorded clip. Anything outside this falls back to Web Speech. */
export const VOICE_PULSE_MIN = 40;
export const VOICE_PULSE_MAX = 160;

/** Same key however a line is punctuated, so "...closer now..." finds its clip. */
export function voiceKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z'-]+/g, ' ')
    .trim();
}

/** Every line the Listener can say, with each {pulse} slot written out for each reading. */
export function voiceLines(whispers: Record<string, string[]>): string[] {
  const lines = new Set<string>();
  for (const line of Object.values(whispers).flat()) {
    if (!line.includes('{pulse}')) {
      lines.add(line);
      continue;
    }
    // With no pulse reading the game drops the number, so that wording needs a clip too.
    const withoutPulse = line.replace('{pulse}', '');
    if (voiceKey(withoutPulse)) lines.add(withoutPulse);
    for (let n = VOICE_PULSE_MIN; n <= VOICE_PULSE_MAX; n++) {
      lines.add(line.replace('{pulse}', numberToWords(n)));
    }
  }
  return [...lines];
}
