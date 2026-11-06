import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const shot = (page: Page, name: string, project: string) =>
  page.screenshot({ path: `test-results/screens/${project}-${name}.png`, fullPage: true });

async function noA11yProblems(page: Page, what: string): Promise<void> {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(
    violations.map((v) => `${what}: ${v.id} on ${v.nodes.map((n) => n.target).join(' | ')}`),
  ).toEqual([]);
}

async function startDemo(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByTestId('judge-mode').click();
  await expect(page.getByTestId('board-summary')).toBeVisible({ timeout: 30_000 });
}

/** Finishes a check-in that's already on its sunrise screen. */
async function answerCheckin(page: Page): Promise<void> {
  await expect(page.getByTestId('feel-4')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('feel-4').click();
  await page.getByTestId('answers-done').click();
  await expect(page.getByTestId('checked-in')).toBeVisible();
}

test.describe('Judge Mode', () => {
  test('landing page explains itself and is accessible', async ({ page }, info) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Every athlete, checked in by sunrise.' })).toBeVisible();
    await expect(page.getByText('not a medical device')).toBeVisible();
    // Let the logo finish fading in.
    await page.waitForTimeout(800);
    await shot(page, 'landing', info.project.name);
    await noA11yProblems(page, 'landing');
  });

  test('whole story: board → replayed check-in → coach swaps → athlete sees the message', async ({ page }, info) => {
    const project = info.project.name;
    await startDemo(page);
    await expect(page.getByTestId('board-summary')).toHaveText('10 of 12 checked in, 2 to look at.');
    await expect(page.getByText('DEMO DATA')).toBeVisible();
    const rows = page.getByTestId('board').locator('li');
    await expect(rows).toHaveCount(12);
    await expect(rows.nth(0)).toContainText('Amara');
    await expect(page.getByTestId('row-Amara').getByTestId('reasons')).toContainText(/above usual/);
    await expect(page.getByTestId('row-Tomasz')).toContainText('Maybe check in personally');
    await shot(page, 'board', project);
    await noA11yProblems(page, 'board');

    // Hana's replayed check-in, sped up for the test.
    await page.goto('/a/demo-hana?mode=replay&speed=20');
    await expect(page.getByText('DEMO DATA')).toBeVisible();
    await shot(page, 'athlete-home', project);
    await noA11yProblems(page, 'athlete home');
    await page.getByTestId('start-checkin').click();
    await expect(page.getByTestId('checkin-title')).toBeVisible();
    await expect(page.getByText(/REPLAY: recorded signal/)).toBeVisible();
    await expect(page.getByRole('progressbar')).toBeVisible({ timeout: 30_000 });
    // Let the sun climb a little before the picture.
    await page.waitForTimeout(1500);
    await shot(page, 'sunrise', project);
    const box = await page.locator('canvas').boundingBox();
    expect(box!.height).toBeGreaterThan(page.viewportSize()!.height * 0.95);
    await expect(page.getByRole('heading', { name: 'Two quick taps' })).toBeVisible({ timeout: 60_000 });
    await shot(page, 'answers', project);
    await noA11yProblems(page, 'answers');
    await page.getByTestId('feel-4').click();
    await page.getByTestId('answers-done').click();
    await expect(page.getByTestId('checked-in')).toBeVisible();
    await shot(page, 'checked-in', project);

    // The board picks it up.
    await page.goto('/coach');
    await expect(page.getByTestId('board-summary')).toHaveText('11 of 12 checked in, 2 to look at.');

    // The coach opens Amara, swaps the session, edits the draft and sends.
    await page.getByTestId('row-Amara').getByRole('link').click();
    await expect(page.getByTestId('chart-pulse')).toBeVisible();
    await expect(page.getByTestId('detail-plan')).toContainText('Track intervals');
    await shot(page, 'detail', project);
    await noA11yProblems(page, 'athlete detail');
    await page.getByTestId('action-easy').click();
    const draft = page.getByTestId('draft');
    await expect(draft).toHaveValue(/^Amara,/);
    await expect(page.getByTestId('draft-source')).toContainText('template');
    await draft.fill('Amara, easy run instead of intervals today. Your pulse is above your usual. Edited by coach.');
    await shot(page, 'decide', project);
    await page.getByTestId('send').click();
    await expect(page.getByTestId('sent')).toBeVisible();

    // Amara's phone gets exactly what the coach wrote, and the changed plan.
    await page.goto('/a/demo-amara');
    await expect(page.getByTestId('inbox-message').first()).toContainText('Edited by coach');
    await expect(page.getByTestId('plan-title')).toContainText('Easy session');
    await expect(page.getByRole('heading', { name: 'Your coach has a note for you' })).toBeVisible();
    await shot(page, 'athlete-message', project);

    // Bulk send covers everyone Ready who has no message yet.
    await page.goto('/coach');
    await page.getByTestId('bulk-start').click();
    await page.getByTestId('bulk-confirm').click();
    await expect(page.getByTestId('bulk-result')).toContainText('Sent to');
    await page.reload();
    await expect(page.getByTestId('bulk-start')).toBeDisabled();
  });

  test('no key and no camera are ever requested in Judge Mode', async ({ page }) => {
    const frames: string[] = [];
    page.on('websocket', (ws) => frames.push(ws.url()));
    await page.addInitScript(() => {
      (window as never as { camera: number }).camera = 0;
      const original = navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);
      if (original) {
        navigator.mediaDevices.getUserMedia = (c) => {
          (window as never as { camera: number }).camera++;
          return original(c);
        };
      }
    });
    await startDemo(page);
    await page.getByTestId('try-checkin').click();
    await page.getByTestId('start-checkin').click();
    await expect(page.getByText(/REPLAY: recorded signal/)).toBeVisible({ timeout: 30_000 });
    expect(await page.evaluate(() => (window as never as { camera: number }).camera)).toBe(0);
    expect(frames.some((u) => u.includes('/ws/frames'))).toBe(false);
  });

  test('filters and keyboard use work on the board', async ({ page }, info) => {
    await startDemo(page);
    await page.getByTestId('filter-check-in').click();
    await expect(page.getByTestId('board').locator('li')).toHaveCount(2);
    await page.getByTestId('filter-learning').click();
    await expect(page.getByTestId('row-Jonah')).toContainText('3 of 5 check-ins');
    await page.getByTestId('filter-waiting').click();
    await expect(page.getByTestId('row-Diego')).toContainText('days ago');
    await page.getByTestId('filter-all').click();
    if (info.project.name === 'desktop') {
      await page.keyboard.press('j');
      await page.keyboard.press('j');
      await expect(page.getByTestId('board').locator('li').nth(1).getByRole('link')).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('chart-pulse')).toBeVisible();
    }
  });

  test('settings and settle check work', async ({ page }, info) => {
    await startDemo(page);
    await page.goto('/coach/settings');
    await page.getByTestId('style-direct').check();
    await shot(page, 'settings', info.project.name);
    await noA11yProblems(page, 'settings');
    await page.goto('/coach/a/demo-amara');
    await page.getByTestId('action-rest').click();
    await expect(page.getByTestId('draft')).toHaveValue('Amara, rest day today. No training.');

    await page.goto('/a/demo-noor?mode=sim&speed=20');
    await page.getByTestId('start-settle').click();
    await expect(page.getByTestId('settle-10')).toBeVisible({ timeout: 60_000 });
    await shot(page, 'settle-done', info.project.name);
    await page.getByTestId('settle-10').click();
    await expect(page.getByTestId('start-settle')).toBeHidden();
    await page.goto('/coach/a/demo-noor');
    await expect(page.getByTestId('settle-summary')).toBeVisible();
  });
});

test.describe('Real coach and athlete', () => {
  test('first run: sign in, add, consent, onboard, check in, then export and delete', async ({ page, context }, info) => {
    const project = info.project.name;
    await page.goto('/coach');
    await expect(page.getByLabel('Passphrase')).toBeVisible();
    await shot(page, 'login', project);
    await noA11yProblems(page, 'login');
    await page.getByLabel('Passphrase').fill('wrong');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toContainText('didn’t match');
    await page.getByLabel('Passphrase').fill('e2e-pass');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByTestId('board-summary')).toBeVisible();
    await expect(page.getByText('DEMO DATA')).toBeHidden();

    const before = await page.getByTestId('board').count();
    if (before === 0) await shot(page, 'empty-board', project);
    await page.getByTestId('add-athlete').first().click();
    const name = `Sam ${project}`;
    await page.getByLabel('Name').fill(name);
    await page.getByRole('button', { name: 'Create link' }).click();
    const link = (await page.getByTestId('new-link').textContent())!;
    expect(link).toMatch(/\/a\/[\w-]{20,}$/);

    // The athlete, on another device, with no coach cookie.
    await context.clearCookies();
    await page.goto(`${link}?mode=sim&speed=20`);
    await expect(page.getByText('What’s measured')).toBeVisible();
    await expect(page.getByText('It’s never saved')).toBeVisible();
    await shot(page, 'consent', project);
    await noA11yProblems(page, 'consent');
    await page.getByTestId('consent-accept').click();
    await page.getByTestId('start-checkin').click();
    for (let i = 0; i < 4; i++) {
      if (i === 0) {
        // Let the card finish sliding in, or the contrast check reads it half transparent.
        await page.waitForTimeout(600);
        await shot(page, 'onboarding', project);
        await noA11yProblems(page, 'onboarding');
      }
      await page.getByTestId('onboarding-next').click();
    }
    await expect(page.getByText(/SIMULATED signal/)).toBeVisible({ timeout: 30_000 });
    await answerCheckin(page);
    await expect(page.getByTestId('streak')).toContainText('1 sunrise');

    const download = page.waitForEvent('download');
    await page.getByText('My data and privacy').click();
    await page.getByRole('link', { name: 'Download my data' }).click();
    expect((await download).suggestedFilename()).toBe('roll-call-my-data.json');
    await page.getByTestId('delete-start').click();
    await page.getByTestId('delete-confirm').click();
    await expect(page.getByRole('heading', { name: 'All gone' })).toBeVisible();
    await page.goto(link);
    await expect(page.getByText('This link isn’t working')).toBeVisible();
    await shot(page, 'link-dead', project);
  });

  test('without Judge Mode a coach route asks for sign-in, and links are not guessable from demo', async ({ page }) => {
    const res = await page.request.get('/api/coach/board');
    expect(res.status()).toBe(401);
    await page.goto('/a/not-a-real-token');
    await expect(page.getByText('This link isn’t working')).toBeVisible();
  });
});

test.describe('Accessibility and motion', () => {
  test('the check-in respects reduced motion', async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await context.newPage();
    await startDemo(page);
    await page.goto('/a/demo-hana?mode=replay&speed=20');
    await page.getByTestId('start-checkin').click();
    await expect(page.getByRole('progressbar')).toBeVisible({ timeout: 30_000 });
    await context.close();
  });
});
