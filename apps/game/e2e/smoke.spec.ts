import { expect, test } from '@playwright/test';

test.describe('HUSH', () => {
  test('title screen shows the disclaimer and every way in', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('play-live')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('judge')).toBeVisible();
    await expect(page.getByText('not a medical device')).toBeVisible();
    await page.screenshot({ path: 'test-results/title.png' });
  });

  test('replay run: calibrates, survives an encounter, reaches the report', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto('/?source=replay&session=judge_tour_900s&bot=1&speed=20&seed=2');
    const badge = page.getByTestId('source-badge');
    await expect(badge).toContainText('REPLAY', { timeout: 60_000 });
    await expect(badge).toContainText('synthetic');

    const phaseIs = (phase: string) =>
      page.waitForFunction(
        (p) =>
          (window as never as { __hush: { run: { phase: string } | null } }).__hush.run?.phase ===
          p,
        phase,
        { timeout: 90_000 },
      );
    await phaseIs('playing');
    await page.screenshot({ path: 'test-results/playing.png' });

    await page.waitForFunction(
      () =>
        (
          window as never as { __hush: { run: { log: { event: { kind: string } }[] } | null } }
        ).__hush.run?.log.some((e) => e.event.kind === 'encounter_survived'),
      undefined,
      { timeout: 150_000 },
    );

    await expect(page.getByTestId('report')).toBeVisible({ timeout: 180_000 });
    await expect(page.getByText('Calm Under Fire')).toBeVisible();
    await page.screenshot({ path: 'test-results/report.png', fullPage: false });
    await page.getByTestId('report-done').click();
    await expect(page.getByTestId('judge')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('Esc pauses to a calm screen, and resumes', async ({ page }) => {
    await page.goto('/?source=sim&bot=1');
    await expect(page.getByTestId('source-badge')).toHaveText('SIM', { timeout: 60_000 });
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('pause')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('pause')).toBeHidden();
  });

  test('live mode without a sidecar explains itself instead of hanging', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['camera']);
    await page.goto('/');
    await page.getByTestId('play-live').click({ timeout: 60_000 });
    await expect(page.getByText('Before the camera turns on')).toBeVisible();
    await expect(page.getByText('computed on your device')).toBeVisible();
    await page.getByRole('button', { name: 'No thanks' }).click();
    await expect(page.getByTestId('judge')).toBeVisible();
  });
});
