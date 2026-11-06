import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const shot = (page: Page, name: string, project: string) =>
  page.screenshot({ path: `test-results/screens/${project}-${name}.png`, fullPage: true });

async function noA11yProblems(page: Page, what: string): Promise<void> {
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(violations.map((v) => `${what}: ${v.id} on ${v.nodes.map((n) => n.target).join(' | ')}`)).toEqual([]);
}

async function seeded(page: Page): Promise<void> {
  await page.goto('/');
  const res = await page.request.post('/api/demo/start');
  expect(res.ok()).toBe(true);
}

test.describe('Amara’s morning in Judge Mode', () => {
  test('heart, legs, today’s call, train, crew, map and camp, with no camera', async ({ page }, info) => {
    const project = info.project.name;
    let cameras = 0;
    await page.exposeFunction('countCamera', () => {
      cameras++;
    });
    await page.addInitScript(() => {
      const md = navigator.mediaDevices;
      if (md?.getUserMedia) {
        const original = md.getUserMedia.bind(md);
        md.getUserMedia = (c) => {
          void (window as never as { countCamera: () => void }).countCamera();
          return original(c);
        };
      }
    });
    await seeded(page);

    // One tile behind before the morning starts.
    await page.goto('/a/demo-amara/crew?speed=20');
    await expect(page.getByTestId('crew-name')).toHaveText('Dawn Patrol');
    await expect(page.getByTestId('tiles-Dawn Patrol')).toHaveText('12 tiles');
    await expect(page.getByTestId('tiles-Fox Milers')).toHaveText('13 tiles');
    await expect(page.getByText('DEMO DATA')).toBeVisible();

    // Heart first.
    await page.goto('/a/demo-amara?speed=20');
    await page.getByTestId('start-checkin').click();
    await expect(page.getByText(/REPLAY: recorded signal/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('feel-4')).toBeVisible({ timeout: 60_000 });
    await page.getByTestId('feel-4').click();
    await page.getByTestId('answers-done').click();
    await expect(page.getByTestId('checked-in')).toBeVisible();
    await expect(page.getByTestId('call-lines')).toContainText('Heart: Ready');
    await expect(page.getByTestId('call-lines')).toContainText('Legs: not checked today');
    await shot(page, 'today-before-legs', project);
    await noA11yProblems(page, 'today');

    // Then legs: three replayed jumps.
    await page.getByTestId('open-legs').click();
    await expect(page.getByTestId('legs-start')).toBeVisible();
    await shot(page, 'legs-offer', project);
    await noA11yProblems(page, 'legs offer');
    await page.getByTestId('legs-start').click();
    await expect(page.getByTestId('pose-stage')).toBeVisible();
    await expect(page.getByText(/REPLAY: generated movement/)).toBeVisible();
    await page.waitForTimeout(200);
    await shot(page, 'legs-measuring', project);
    await expect(page.getByTestId('legs-result')).toHaveText('Legs: 9% below your usual.', { timeout: 60_000 });
    await shot(page, 'legs-result', project);
    await noA11yProblems(page, 'legs result');
    await page.getByTestId('legs-continue').click();

    // Two lines, and Rollo's suggestion.
    await expect(page.getByTestId('call-lines')).toHaveText('Heart: Ready · Legs: 9% below usual');
    await expect(page.getByTestId('choose-upper')).toContainText('Rollo’s pick');
    await expect(page.getByTestId('call-why')).toContainText('legs are clearly down');
    await shot(page, 'todays-call', project);
    await page.getByTestId('choose-upper').click();
    await expect(page.getByTestId('smart-call')).toContainText('+3');

    // Her smart call takes the contested tile.
    await page.getByTestId('nav-crew').click();
    await expect(page.getByTestId('tiles-Dawn Patrol')).toHaveText('13 tiles');
    await expect(page.getByTestId('tiles-Fox Milers')).toHaveText('12 tiles');
    await expect(page.getByTestId('map-news')).toContainText('Dawn Patrol took a tile from Fox Milers');
    await expect(page.getByTestId('my-today-points')).toHaveText('+5');
    await expect(page.getByTestId('dawn-map')).toBeVisible();
    await expect(page.getByTestId('tile-claimed').first()).toBeAttached();
    await page.waitForTimeout(2500);
    await shot(page, 'crew', project);
    await noA11yProblems(page, 'crew');

    // Share cards are made in the browser.
    await page.getByTestId('rested-card').click();
    await expect(page.getByTestId('share-preview')).toBeVisible();
    await shot(page, 'share-rested', project);
    await page.getByTestId('recap-portrait').click();
    await expect(page.getByTestId('share-preview')).toHaveAttribute('src', /^data:image\/png/);
    await shot(page, 'share-recap', project);

    // A friendly nudge, once.
    await page.getByTestId('nudge-Hana').click();
    await expect(page.getByTestId('crew-note')).toContainText('Rollo');
    await expect(page.getByTestId('nudge-Hana')).toBeHidden();

    // A teammate's camp shows buildings, never readings.
    await page.getByTestId('visit-Kasun').click();
    await expect(page.getByTestId('camp-title')).toHaveText('Kasun’s camp');
    await expect(page.getByText('Buildings only')).toBeVisible();
    await page.waitForTimeout(800);
    await shot(page, 'teammate-camp', project);

    await page.getByTestId('nav-camp').click();
    await expect(page.getByTestId('camp-title')).toHaveText('Your camp');
    await expect(page.getByRole('link', { name: 'Camp' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('building-barn')).toBeVisible();
    await page.waitForTimeout(1500);
    await shot(page, 'camp', project);
    await noA11yProblems(page, 'camp');

    // Train mode: push-ups, live count, "That's the set".
    await page.goto('/a/demo-amara?speed=4');
    await page.getByTestId('start-session').click();
    await expect(page.getByTestId('train-title')).toHaveText('Easy upper body');
    await shot(page, 'train-pick', project);
    await noA11yProblems(page, 'train picker');
    await page.getByTestId('exercise-pushup').click();
    await expect(page.getByTestId('rep-count')).toHaveText('2', { timeout: 30_000 });
    await shot(page, 'train-mid-set', project);
    await expect(page.getByTestId('fatigue-stop')).toContainText('That’s the set', { timeout: 60_000 });
    await shot(page, 'train-set', project);
    await expect(page.getByTestId('set-summary')).toContainText('Push-up: 7 reps', { timeout: 60_000 });
    await shot(page, 'train-rest', project);
    await noA11yProblems(page, 'train rest');
    await page.getByTestId('finish-session').click();
    await expect(page.getByTestId('session-finished')).toBeVisible();
    await shot(page, 'train-finished', project);
    await page.getByTestId('train-home').click();
    await expect(page.getByTestId('call-chosen')).toContainText('followed through');

    // Insights.
    await expect(page.getByTestId('insight-speed-squat')).toContainText('18% faster');
    await expect(page.getByTestId('insight-speed-squat')).toContainText('Watch day');
    await shot(page, 'today-done', project);

    expect(cameras).toBe(0);
  });

  test('a tucked landing is rejected and another is asked for', async ({ page }) => {
    await seeded(page);
    await page.goto('/a/demo-hana?speed=20&poses=jumps_tucked');
    await page.getByTestId('start-checkin').click();
    await expect(page.getByTestId('feel-4')).toBeVisible({ timeout: 60_000 });
    await page.getByTestId('feel-4').click();
    await page.getByTestId('answers-done').click();
    await page.getByTestId('open-legs').click();
    await page.getByTestId('legs-start').click();
    await expect(page.getByTestId('legs-result')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText('1 jump didn’t count.')).toBeVisible();
  });

  test.describe('every exercise counts in replay', () => {
    for (const [id, expected] of [
      ['squat', /Bodyweight squat: 8 reps/],
      ['pushup', /Push-up: 7 reps/],
      ['lunge', /Lunge: 8 reps/],
      ['bridge', /Glute bridge: 8 reps/],
      ['press', /Overhead press: 6 reps/],
      ['plank', /Plank: held \d+ seconds/],
    ] as const) {
      test(id, async ({ page }, info) => {
        test.skip(info.project.name !== 'desktop', 'One viewport is enough for this');
        await seeded(page);
        await page.goto('/a/demo-priya?speed=20');
        await page.getByTestId('choose-planned').click();
        await page.getByTestId('start-session').click();
        // A plan with no strength keyword offers every bodyweight exercise.
        await page.getByTestId(`exercise-${id}`).click();
        await expect(page.getByTestId('set-summary')).toContainText(expected, { timeout: 60_000 });
      });
    }
  });

  test('balance test and skip both work', async ({ page }) => {
    await seeded(page);
    await page.goto('/a/demo-kasun/legs?speed=20');
    await page.getByTestId('legs-balance').click();
    await expect(page.getByTestId('legs-result')).toContainText('Balance test saved', { timeout: 60_000 });
    await page.goto('/a/demo-priya/legs');
    await page.getByTestId('legs-skip').click();
    await expect(page.getByTestId('call-lines')).toContainText('Legs: skipped today');
  });

  test('Tomasz sees a gentle card that the crew doesn’t', async ({ page }) => {
    await seeded(page);
    await page.goto('/a/demo-tomasz');
    await expect(page.getByTestId('gentle-card')).toContainText('Only you can see this');
    await page.goto('/a/demo-mei/crew');
    await expect(page.getByTestId('member-Tomasz')).toBeVisible();
    await expect(page.getByText(/tough|flat/)).toBeHidden();
  });
});

test.describe('Real crew', () => {
  test('a new athlete starts a crew, and the invite link fills the code in for a friend', async ({ page }, info) => {
    const project = info.project.name;
    await page.goto('/');
    await page.request.post('/api/coach/login', { data: { passphrase: 'e2e-pass' } });
    const create = async (name: string): Promise<string> => {
      const res = await page.request.post('/api/coach/athletes', { data: { name, sport: 'running' } });
      return ((await res.json()) as { link: string }).link;
    };
    const first = await create(`Crew Starter ${project}`);
    const second = await create(`Crew Friend ${project}`);
    for (const link of [first, second]) await page.request.post(`/api${link}/consent`);

    await page.goto(`${first}/crew`);
    await shot(page, 'crew-start', project);
    await noA11yProblems(page, 'crew start');
    await page.getByLabel('Crew name').fill(`Test Crew ${project}`);
    await page.getByTestId('create-crew').click();
    await expect(page.getByTestId('crew-name')).toHaveText(`Test Crew ${project}`);
    const code = (await page.getByTestId('invite-code').textContent())!;

    await page.goto(`/join/${code}`);
    await expect(page.getByTestId('join-code')).toHaveText(code);
    await shot(page, 'join', project);
    await page.goto(`${second}/crew`);
    await expect(page.getByLabel('Join with a code')).toHaveValue(code);
    await page.getByTestId('join-crew').click();
    await expect(page.getByTestId('crew-checked-in')).toHaveText('0 of 2');

    await page.getByText('What my crew sees').click();
    await page.getByTestId('leave-crew').click();
    await expect(page.getByTestId('create-crew')).toBeVisible();
  });
});
