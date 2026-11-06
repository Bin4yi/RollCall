import { findBannedWords, type Deviation, type Metric } from '@rollcall/readiness';
import OpenAI from 'openai';

export type DraftAction = 'keep' | 'easy' | 'rest' | 'custom';
export type DraftStyle = 'warm' | 'direct' | 'funny';

/**
 * The only facts an LLM may see: numbers and the coach's chosen action. No names, video or notes, and
 * the session title is left out because coaches write it freely. `{name}` is filled in afterwards.
 */
export interface DraftInput {
  action: DraftAction;
  style: DraftStyle;
  sessionIntensity?: 'hard' | 'moderate' | 'easy' | 'rest';
  signals: { metric: Metric; direction: 'above' | 'below'; amount: string }[];
  hasCheckedIn: boolean;
}

export interface DraftProvider {
  readonly name: string;
  complete(instructions: string, input: string): Promise<string>;
}

export interface Draft {
  body: string;
  source: string;
}

const METRIC_WORDS: Record<Metric, string> = {
  pulse: 'pulse',
  rmssd: 'HRV',
  stress: 'stress index',
  breath: 'breathing',
  sleep: 'sleep',
  feel: 'how they feel',
};

export function draftSignals(deviations: readonly Deviation[]): DraftInput['signals'] {
  return deviations
    .filter((d) => d.off >= 1)
    .sort((a, b) => b.off - a.off)
    .slice(0, 3)
    .map((d) => {
      const delta = Math.abs(d.today - d.usual);
      const amount =
        d.metric === 'rmssd' || d.metric === 'stress'
          ? `${Math.round((delta / Math.max(d.usual, 1)) * 100)}%`
          : d.metric === 'sleep'
            ? `${Math.round(delta * 2) / 2} h`
            : d.metric === 'feel'
              ? `${Math.round(delta)} points`
              : `${Math.round(delta)}`;
      const above = d.metric === 'pulse' || d.metric === 'stress' || d.metric === 'breath';
      return { metric: d.metric, direction: above ? 'above' : 'below', amount };
    });
}

export const INSTRUCTIONS = `You draft a short message from a sports coach to one of their adult athletes. The coach will edit and approve it.

Rules:
- Two or three sentences, under 60 words. Plain, spoken English.
- Start with "{name}," exactly as written. Never write a real name.
- Say what the coach decided. Mention at most one reading, always compared with the athlete's own usual, such as "pulse a bit above your usual".
- Readings are wellness estimates for training decisions. Never suggest a health problem, cause or treatment. Never use these words: diagnosis, disease, illness, sick, infection, anxiety, disorder, cardiac, arrhythmia, risk.
- Don't invent facts, session details or numbers.
- Reply with the message only.`;

const ACTION_WORDS: Record<DraftAction, string> = {
  keep: 'keep today’s planned session',
  easy: 'swap today’s session for an easy one',
  rest: 'make today a rest day',
  custom: 'change today’s session, with details the coach will add',
};

const STYLE_WORDS: Record<DraftStyle, string> = {
  warm: 'warm and encouraging',
  direct: 'direct and brief',
  funny: 'light and funny, never mocking',
};

export function draftPrompt(input: DraftInput): string {
  const signals = input.signals.length
    ? input.signals
        .map((s) => `${METRIC_WORDS[s.metric]} ${s.amount} ${s.direction} their usual`)
        .join('; ')
    : 'close to their usual';
  return [
    `Coach's decision: ${ACTION_WORDS[input.action]}.`,
    `Tone: ${STYLE_WORDS[input.style]}.`,
    `Planned session intensity: ${input.sessionIntensity ?? 'not set'}.`,
    `This morning's readings: ${input.hasCheckedIn ? signals : 'no check-in yet'}.`,
  ].join('\n');
}

const TEMPLATES: Record<DraftAction, Record<DraftStyle, string>> = {
  keep: {
    warm: '{name}, your numbers look good this morning. Train as planned and enjoy it.',
    direct: '{name}, all good today. Train as planned.',
    funny: '{name}, sun’s up and so are you. Train as planned, no excuses left.',
  },
  easy: {
    warm: '{name}, you’re a little off your usual this morning, so let’s swap today for something easy. You’ll get more from tomorrow.',
    direct: '{name}, you’re off your usual today. Easy session instead of the plan.',
    funny: '{name}, today’s workout just got demoted. Keep it easy, and tomorrow we go again.',
  },
  rest: {
    warm: '{name}, let’s make today a rest day. You’ve earned it, and it’ll help the weeks ahead.',
    direct: '{name}, rest day today. No training.',
    funny: '{name}, your official assignment today is doing nothing. Please take it seriously.',
  },
  custom: {
    warm: '{name}, I’ve made a change to today’s session. Details below.',
    direct: '{name}, today’s session has changed. Details below.',
    funny: '{name}, plot twist in today’s session. Details below.',
  },
};

export const templateDraft = (input: DraftInput): string =>
  TEMPLATES[input.action][input.style];

/** A draft must be free of banned words, short, and contain no leaked real name. */
export function isUsableDraft(text: string): boolean {
  const body = text.trim();
  return (
    body.length > 0 &&
    body.length <= 500 &&
    body.includes('{name}') &&
    findBannedWords(body).length === 0
  );
}

export const fillName = (body: string, name: string): string => body.replaceAll('{name}', name);

/** Tries the LLM once, and always ends with something usable: a failed or unsafe draft becomes a template. */
export async function writeDraft(input: DraftInput, provider: DraftProvider | null): Promise<Draft> {
  if (provider) {
    try {
      const text = (await provider.complete(INSTRUCTIONS, draftPrompt(input))).trim();
      if (isUsableDraft(text)) return { body: text, source: provider.name };
    } catch {
      /* Falls through to the template. */
    }
  }
  return { body: templateDraft(input), source: 'template' };
}

/** https://developers.openai.com/api/docs/guides/text */
export function openAiProvider(apiKey: string, model: string): DraftProvider {
  const client = new OpenAI({ apiKey, timeout: 20_000, maxRetries: 0 });
  return {
    name: `openai:${model}`,
    async complete(instructions, input) {
      const response = await client.responses.create({ model, instructions, input });
      return response.output_text;
    },
  };
}

/** https://docs.ollama.com/api/chat */
export function ollamaProvider(url: string, model: string): DraftProvider {
  return {
    name: `ollama:${model}`,
    async complete(instructions, input) {
      const res = await fetch(`${url.replace(/\/$/, '')}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          stream: false,
          messages: [
            { role: 'system', content: instructions },
            { role: 'user', content: input },
          ],
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`Ollama ${res.status}`);
      return ((await res.json()) as { message?: { content?: string } }).message?.content ?? '';
    },
  };
}
