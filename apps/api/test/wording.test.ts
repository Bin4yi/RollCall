import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { BANNED_WORDS, findBannedWords } from '@rollcall/readiness';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../../..');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/** Everything a person using Roll Call or reading about it can see. */
const PUBLIC_TEXT = [
  ...walk(resolve(ROOT, 'apps/web/src')).filter((f) => /\.tsx?$/.test(f)),
  ...walk(resolve(ROOT, 'packages/drafts/src')),
  resolve(ROOT, 'packages/db/src/seed.ts'),
  resolve(ROOT, 'packages/readiness/src/checkin.ts'),
  resolve(ROOT, 'apps/api/src/ws.ts'),
  resolve(ROOT, 'README.md'),
  resolve(ROOT, 'docs/devpost.md'),
  resolve(ROOT, 'docs/demo-script.md'),
].filter(existsSync);

describe('wording', () => {
  it.each(PUBLIC_TEXT.map((f) => [f.replace(ROOT, '')]))('%s has no banned words', (rel) => {
    const file = join(ROOT, rel);
    let text = readFileSync(file, 'utf8');
    // The drafts prompt names the banned words in order to forbid them.
    if (rel.includes('drafts')) text = text.replace(/Never use these words:[^\n]*/, '');
    expect(findBannedWords(text)).toEqual([]);
  });

  it('the banned list covers what the brief names', () => {
    for (const word of ['diagnos', 'disease', 'illness', 'sick', 'infection', 'anxiety', 'disorder', 'cardiac', 'arrhythmia', 'nervous system', 'risk score']) {
      expect(BANNED_WORDS).toContain(word);
    }
  });
});
