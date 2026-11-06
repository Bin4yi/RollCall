import { createServer } from 'node:http';
import { expect, test } from '@playwright/test';
import { WebSocketServer } from 'ws';
import { parseFrameHeader, FRAME_HEADER_BYTES } from '../../sidecar/src/protocol';

test.use({
  launchOptions: {
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  },
  permissions: ['camera'],
});

/** Proves the browser-to-sidecar frame format, using Chromium's fake camera and a stand-in socket. */
test('webcam frames reach the frame socket in a format the SDK accepts', async ({ page }) => {
  const http = createServer();
  const server = new WebSocketServer({ server: http });
  await new Promise<void>((resolve) => http.listen(8766, '127.0.0.1', resolve));
  const frames: { size: number; header: ReturnType<typeof parseFrameHeader> }[] = [];
  server.on('connection', (socket) => {
    socket.on('message', (data: Buffer) =>
      frames.push({ size: data.length, header: parseFrameHeader(data) }),
    );
  });

  try {
    await page.goto('/signal-test.html');
    await page.locator('#start').click();
    await expect.poll(() => frames.length, { timeout: 30_000 }).toBeGreaterThan(30);

    const { header, size } = frames.at(-1)!;
    expect(header).not.toBeNull();
    const { width, height, stride, pixelFormat } = header!;
    expect(width).toBeGreaterThan(0);
    // SDK PixelFormat: 2 RGBA, 3 BGRA, 4 NV12.
    expect([2, 3, 4]).toContain(pixelFormat);
    const expected =
      pixelFormat === 4 ? width * height + width * Math.ceil(height / 2) : stride * height;
    expect(size - FRAME_HEADER_BYTES).toBe(expected);

    // The SDK rejects timestamps that don't move forward.
    const stamps = frames.map((f) => f.header!.timestampUs);
    for (let i = 1; i < stamps.length; i++) expect(stamps[i]!).toBeGreaterThan(stamps[i - 1]!);
    console.log(`frames: ${width}x${height} format ${pixelFormat}, ${frames.length} received`);
  } finally {
    server.close();
    http.close();
  }
});
