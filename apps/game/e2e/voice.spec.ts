import { expect, test } from '@playwright/test';

/** 0.1 s of silence: enough for the browser to decode a real clip. */
function silentWav(): Buffer {
  const rate = 8000;
  const bytes = rate / 10;
  const wav = Buffer.alloc(44 + bytes, 128);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + bytes, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate, 28);
  wav.writeUInt16LE(1, 32);
  wav.writeUInt16LE(8, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(bytes, 40);
  return wav;
}

type VoiceWindow = { __hush: { whisper: { say(text: string): void } }; __spoken: string[] };

test('uses a generated clip when there is one, and Web Speech when there is not', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const w = window as never as VoiceWindow;
    w.__spoken = [];
    window.speechSynthesis.speak = (u) => void w.__spoken.push(u.text);
  });
  await page.route('**/hush-voice/manifest.json', (route) =>
    route.fulfill({
      json: { model: 'test', voice: 'test', clips: { 'closer now': 'clip.mp3' } },
    }),
  );
  let clipRequests = 0;
  await page.route('**/hush-voice/clip.mp3', (route) => {
    clipRequests++;
    return route.fulfill({ body: silentWav(), contentType: 'audio/wav' });
  });

  await page.goto('/');
  await expect(page.getByText('voice is AI-generated')).toBeVisible({ timeout: 60_000 });

  // The click is what allows audio to start. A first run then opens on the tutorial.
  await page.getByTestId('play-sim').click();
  await expect(page.getByRole('heading', { name: 'Sit still' })).toBeVisible({ timeout: 60_000 });
  const say = (text: string) =>
    page.evaluate((line) => (window as never as VoiceWindow).__hush.whisper.say(line), text);
  const spoken = () => page.evaluate(() => (window as never as VoiceWindow).__spoken);

  await say('...closer now...');
  await expect.poll(() => clipRequests).toBe(1);
  await page.waitForTimeout(300);
  expect(await spoken()).toEqual([]);

  await say('...not in the pack...');
  await expect.poll(spoken).toHaveLength(1);
  expect(clipRequests).toBe(1);
});

test('with no voice pack, the title makes no AI voice claim', async ({ page }) => {
  await page.route('**/hush-voice/manifest.json', (route) => route.fulfill({ status: 404 }));
  await page.goto('/');
  await expect(page.getByText('not a medical device')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('voice is AI-generated')).toBeHidden();
});
