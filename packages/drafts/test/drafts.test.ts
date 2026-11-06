import type { Deviation } from '@rollcall/readiness';
import { findBannedWords } from '@rollcall/readiness';
import { describe, expect, it } from 'vitest';
import {
  draftPrompt,
  draftSignals,
  fillName,
  INSTRUCTIONS,
  isUsableDraft,
  templateDraft,
  writeDraft,
  type DraftAction,
  type DraftInput,
  type DraftProvider,
  type DraftStyle,
} from '../src';

const input: DraftInput = {
  action: 'easy',
  style: 'warm',
  sessionIntensity: 'hard',
  hasCheckedIn: true,
  signals: [{ metric: 'pulse', direction: 'above', amount: '8' }],
};

const fake = (reply: string | Error): DraftProvider & { seen: string[] } => {
  const seen: string[] = [];
  return {
    name: 'fake',
    seen,
    async complete(instructions, prompt) {
      seen.push(instructions, prompt);
      if (reply instanceof Error) throw reply;
      return reply;
    },
  };
};

describe('writeDraft', () => {
  it('uses the provider when the reply is usable', async () => {
    const draft = await writeDraft(input, fake('{name}, easy day today. Pulse a bit above usual.'));
    expect(draft).toEqual({ body: '{name}, easy day today. Pulse a bit above usual.', source: 'fake' });
  });

  it('falls back to a template when there is no provider', async () => {
    expect((await writeDraft(input, null)).source).toBe('template');
  });

  it('falls back when the provider fails', async () => {
    expect((await writeDraft(input, fake(new Error('down')))).source).toBe('template');
  });

  it('falls back when the reply uses banned wording', async () => {
    const draft = await writeDraft(input, fake('{name}, this could be an infection. Rest up.'));
    expect(draft.source).toBe('template');
    expect(findBannedWords(draft.body)).toEqual([]);
  });

  it('falls back when the reply skips the name slot or runs long', async () => {
    expect((await writeDraft(input, fake('Amara, easy day.'))).source).toBe('template');
    expect((await writeDraft(input, fake(`{name}, ${'x'.repeat(600)}`))).source).toBe('template');
  });
});

describe('what the LLM sees', () => {
  it('holds numbers and the action only', async () => {
    const provider = fake('{name}, easy today.');
    await writeDraft(input, provider);
    const sent = provider.seen.join('\n');
    expect(sent).toContain('swap today');
    expect(sent).toContain('pulse 8 above their usual');
    expect(sent).not.toMatch(/Amara|Kasun|note/i);
  });

  it('input type has no field for names, notes or session titles', () => {
    expect(Object.keys(input).sort()).toEqual(
      ['action', 'hasCheckedIn', 'sessionIntensity', 'signals', 'style'].sort(),
    );
  });

  it('says so when there is no check-in', () => {
    expect(draftPrompt({ ...input, hasCheckedIn: false })).toContain('no check-in yet');
  });
});

describe('draftSignals', () => {
  it('keeps the top three real deviations, in plain amounts', () => {
    const deviations: Deviation[] = [
      { metric: 'pulse', today: 60, usual: 52, off: 3 },
      { metric: 'rmssd', today: 45, usual: 60, off: 2.5 },
      { metric: 'sleep', today: 5, usual: 7.5, off: 2 },
      { metric: 'stress', today: 130, usual: 100, off: 1.5 },
      { metric: 'feel', today: 4, usual: 4, off: 0 },
    ];
    expect(draftSignals(deviations)).toEqual([
      { metric: 'pulse', direction: 'above', amount: '8' },
      { metric: 'rmssd', direction: 'below', amount: '25%' },
      { metric: 'sleep', direction: 'below', amount: '2.5 h' },
    ]);
  });
});

describe('templates', () => {
  it('every template is usable and free of banned wording', () => {
    for (const action of ['keep', 'easy', 'rest', 'custom'] as DraftAction[]) {
      for (const style of ['warm', 'direct', 'funny'] as DraftStyle[]) {
        const text = templateDraft({ ...input, action, style });
        expect(isUsableDraft(text), text).toBe(true);
      }
    }
  });

  it('fills in the name afterwards', () => {
    expect(fillName('{name}, go.', 'Noor')).toBe('Noor, go.');
  });

  it('the instructions only name banned words in order to forbid them', () => {
    expect(INSTRUCTIONS).toContain('Never use these words');
  });
});
