import { describe, expect, it } from 'vitest';
import {
  numberToWords,
  PeakDetector,
  pickedFile,
  placeholderColor,
  type Manifest,
} from '../src/manifest';
import { BANNED_UI_WORDS } from '../src/copy';
import lines from '../../../config/lines.json';

const manifest: Manifest = {
  images: {
    a: { category: 'x', picked: 2, files: ['a1.png', 'a2.png'] },
    bad: { category: 'x', picked: 9, files: ['b1.png'] },
    empty: { category: 'x', picked: 1, files: [] },
  },
  animations: {},
};

describe('pickedFile', () => {
  it('uses the picked variant', () => {
    expect(pickedFile(manifest, 'a')).toBe('a2.png');
  });
  it('survives bad picks and missing ids, so the game can use a placeholder', () => {
    expect(pickedFile(manifest, 'bad')).toBe('b1.png');
    expect(pickedFile(manifest, 'empty')).toBeNull();
    expect(pickedFile(manifest, 'nope')).toBeNull();
  });
});

describe('placeholderColor', () => {
  it('is stable per id', () => {
    expect(placeholderColor('bg_corridor')).toBe(placeholderColor('bg_corridor'));
    expect(placeholderColor('a')).not.toBe(placeholderColor('b'));
  });
});

describe('numberToWords', () => {
  it.each([
    [0, 'zero'],
    [19, 'nineteen'],
    [20, 'twenty'],
    [72, 'seventy-two'],
    [100, 'one hundred'],
    [112, 'one hundred and twelve'],
    [140, 'one hundred and forty'],
  ])('%i → %s', (n, words) => {
    expect(numberToWords(n)).toBe(words);
  });
});

describe('PeakDetector', () => {
  it('counts one beat per cycle at resting and high pulse', () => {
    for (const bpm of [60, 120]) {
      const d = new PeakDetector();
      const hz = 30;
      const samples = Array.from({ length: hz * 30 }, (_, i) =>
        Math.sin((2 * Math.PI * bpm * i) / hz / 60),
      );
      expect(d.push(samples, hz)).toBeGreaterThanOrEqual(Math.floor(bpm / 2) - 1);
      const again = new PeakDetector();
      expect(again.push(samples, hz)).toBeLessThanOrEqual(Math.ceil(bpm / 2) + 1);
    }
  });

  it('does nothing on a flat line', () => {
    expect(new PeakDetector().push(new Array(300).fill(1), 30)).toBe(0);
  });
});

describe('player-facing text', () => {
  it('never uses medical words', () => {
    const text = JSON.stringify(lines).toLowerCase();
    for (const word of BANNED_UI_WORDS) expect(text).not.toContain(word);
  });
});
