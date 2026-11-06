import { createServer } from 'node:http';
import { expect, test } from '@playwright/test';
import sharp from 'sharp';
import { WebSocketServer } from 'ws';
import {
  FRAME_HEADER_BYTES,
  JPEG_FORMAT,
  parseFrameHeader,
} from '../../vitals-worker/src/protocol';

test.use({
  launchOptions: {
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  },
  permissions: ['camera'],
});
test.beforeEach(({ page: _page }, info) => {
  test.skip(info.project.name !== 'desktop', 'The frame format does not depend on the viewport');
});

type Frame = { size: number; data: Buffer; header: ReturnType<typeof parseFrameHeader> };

async function withStandIn(run: (url: string, frames: Frame[]) => Promise<void>): Promise<void> {
  const http = createServer();
  const server = new WebSocketServer({ server: http });
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const frames: Frame[] = [];
  server.on('connection', (socket) => {
    socket.on('message', (data: Buffer) =>
      frames.push({ size: data.length, data, header: parseFrameHeader(data) }),
    );
  });
  const address = http.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  try {
    await run(`ws://127.0.0.1:${port}`, frames);
  } finally {
    server.close();
    http.close();
  }
}

const startCapture = (page: import('@playwright/test').Page, url: string, encoding?: 'raw' | 'jpeg', removeProcessor = false) =>
  page.evaluate(
    async ([u, e, remove]) => {
      if (remove) delete (window as never as Record<string, unknown>).MediaStreamTrackProcessor;
      const { FrameCapture } = await import('/src/capture/frameCapture.ts' as string);
      const capture = new FrameCapture();
      await capture.start(u, e);
    },
    [url, encoding, removeProcessor] as const,
  );

test('raw frames reach the socket in a format the SDK accepts', async ({ page }) => {
  await withStandIn(async (url, frames) => {
    await page.goto('/');
    await startCapture(page, url, 'raw');
    await expect.poll(() => frames.length, { timeout: 30_000 }).toBeGreaterThan(30);
    const { header, size } = frames.at(-1)!;
    const { width, height, stride, pixelFormat } = header!;
    expect([2, 3, 4]).toContain(pixelFormat);
    const expected = pixelFormat === 4 ? width * height + width * Math.ceil(height / 2) : stride * height;
    expect(size - FRAME_HEADER_BYTES).toBe(expected);
    const stamps = frames.map((f) => f.header!.timestampUs);
    for (let i = 1; i < stamps.length; i++) expect(stamps[i]!).toBeGreaterThan(stamps[i - 1]!);
  });
});

async function expectJpegFrames(frames: Frame[]): Promise<void> {
  await expect.poll(() => frames.length, { timeout: 30_000 }).toBeGreaterThan(20);
  const { header, data } = frames.at(-1)!;
  expect(header!.pixelFormat).toBe(JPEG_FORMAT);
  // The worker decodes these with sharp, so prove sharp can.
  const { info } = await sharp(data.subarray(FRAME_HEADER_BYTES)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  expect(info.channels).toBe(3);
  expect(info.width).toBe(header!.width);
  expect(info.height).toBe(header!.height);
}

test('phones: JPEG frames from the worker path decode on the server', async ({ page }) => {
  await withStandIn(async (url, frames) => {
    await page.goto('/');
    await startCapture(page, url, 'jpeg');
    await expectJpegFrames(frames);
  });
});

test('Safari fallback: JPEG frames from the canvas path decode on the server', async ({ page }) => {
  await withStandIn(async (url, frames) => {
    await page.goto('/');
    await startCapture(page, url, undefined, true);
    await expectJpegFrames(frames);
  });
});
