/**
 * One SmartSpectra session in its own process: the only code that touches SDK native code. A crash
 * here can't take down the API. Frames arrive on a private localhost socket, are handed to the SDK
 * and discarded. Nothing here writes frames anywhere. Every SDK call is documented in docs/SDK_NOTES.md.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { MetricsNormalizer, type SdkMetrics } from '@rollcall/signals';
import sharp from 'sharp';
import { WebSocketServer } from 'ws';
import {
  FRAME_HEADER_BYTES,
  FrameClock,
  JPEG_FORMAT,
  mergeFrames,
  parseFrameHeader,
  type WorkerMessage,
} from './protocol';

interface SdkInstance {
  on(event: string, callback: (...args: never[]) => void): SdkInstance;
  useCustomInput(transform?: number): SdkInstance;
  start(): void;
  stopAsync(): Promise<void>;
  destroy(): Promise<void>;
  sendFrame(
    buf: Uint8Array,
    width: number,
    height: number,
    stride: number,
    format: number,
    timestampUs: number,
  ): boolean;
}
interface SdkModule {
  SmartSpectraSDK: { new (options: Record<string, unknown>): SdkInstance };
  ProcessingStatus: { kStarting: number; kRunning: number; kError: number };
  PixelFormat: { kRGB: number };
  breathingMetrics: number[];
  cardioMetrics: number[];
  faceMetrics: number[];
}

/** SmartSpectraErrorCode values. Restarting can't fix these. */
const INVALID_STATE = 1;
const KEY_REJECTED = 2;
const OUT_OF_CREDIT = 4;

const send = (message: WorkerMessage): void => {
  process.send?.(message);
};

const runtimeRequire = createRequire(
  fileURLToPath(new URL('../runtime/package.json', import.meta.url)),
);

function loadSdk(): { sdk: SdkModule; decode: (buf: Buffer) => unknown } | null {
  try {
    return {
      sdk: runtimeRequire('@smartspectra/node-sdk') as SdkModule,
      // The root export returns a raw Buffer; /messages always decodes (see SDK_NOTES.md).
      decode: (
        runtimeRequire('@smartspectra/node-sdk/messages') as {
          decodeMetrics: (b: Buffer) => unknown;
        }
      ).decodeMetrics,
    };
  } catch (err) {
    send({
      type: 'status',
      state: 'sdk-missing',
      detail: `SmartSpectra SDK not installed. Run: pnpm vitals:setup (${(err as Error).message})`,
    });
    return null;
  }
}

async function main(): Promise<void> {
  const apiKey = process.env.SMARTSPECTRA_API_KEY;
  if (!apiKey) {
    send({ type: 'status', state: 'no-key', detail: 'SMARTSPECTRA_API_KEY is not set.' });
    return;
  }
  const loaded = loadSdk();
  if (!loaded) return;
  const { sdk: mod, decode } = loaded;

  const sdk = new mod.SmartSpectraSDK({
    apiKey,
    enableTelemetry: false,
    requestedMetrics: [...mod.breathingMetrics, ...mod.cardioMetrics, ...mod.faceMetrics],
  });

  let frameSizeKnown = false;
  let acceptsFrames = false;
  let lastValidation: number | null = null;
  let sendFailureReported = false;
  const normalizer = new MetricsNormalizer();
  const startedAt = performance.now();
  const now = (): number => Math.round(performance.now() - startedAt);
  let pending: ReturnType<MetricsNormalizer['toFrame']> | null = null;

  sdk.on('processingStatus', ((status: number) => {
    const name =
      status === mod.ProcessingStatus.kRunning
        ? 'running'
        : status === mod.ProcessingStatus.kError
          ? 'error'
          : `status-${status}`;
    // A custom-input session only reaches kRunning once it receives frames (probed), so frames
    // have to start during kStarting. Before that, and after stopping, sendFrame throws.
    acceptsFrames =
      status === mod.ProcessingStatus.kStarting || status === mod.ProcessingStatus.kRunning;
    send({ type: 'status', state: name });
  }) as never);
  sdk.on('validationStatus', ((code: number, _ts: number, hint: string) => {
    normalizer.setValidation(code, hint);
    // The SDK repeats this for every frame. Callers only need to hear about changes.
    if (code === lastValidation) return;
    lastValidation = code;
    send({ type: 'validation', code, hint });
  }) as never);
  sdk.on('metrics', ((buf: Buffer) => {
    const decoded = decode(buf);
    if (Buffer.isBuffer(decoded)) return;
    pending = mergeFrames(pending, normalizer.toFrame(decoded as SdkMetrics, now()));
  }) as never);
  sdk.on('error', ((code: number, message: string, retryable: boolean) => {
    send({ type: 'error', code, message, retryable });
    // A session in kError stays there, so exit and let the broker decide whether to start another.
    if (code !== KEY_REJECTED && code !== OUT_OF_CREDIT && code !== INVALID_STATE) {
      setTimeout(() => process.exit(1), 200);
    }
  }) as never);

  // The SDK sends no metrics until it finds a face (probed), so a heartbeat carries the validation
  // state, or the check-in could never tell the athlete what's wrong.
  setInterval(() => {
    send({ type: 'frame', frame: pending ?? normalizer.heartbeat(now()) });
    pending = null;
  }, 100);

  const server = new WebSocketServer({ host: '127.0.0.1', port: 0, maxPayload: 16e6 });
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const clock = new FrameClock();

  const push = (buf: Uint8Array, w: number, h: number, stride: number, fmt: number, ts: number): void => {
    if (!frameSizeKnown) {
      frameSizeKnown = true;
      normalizer.setFrameSize({ width: w, height: h });
    }
    try {
      sdk.sendFrame(buf, w, h, stride, fmt, ts);
    } catch (err) {
      // One bad frame must not end the session. Say so once, not 30 times a second.
      if (!sendFailureReported) {
        sendFailureReported = true;
        send({ type: 'status', state: 'frame-rejected', detail: (err as Error).message });
      }
    }
  };

  server.on('connection', (socket) => {
    // JPEG decoding is asynchronous, so frames go through a queue to stay in order.
    let queue: Promise<void> = Promise.resolve();
    let queued = 0;
    socket.on('message', (data: Buffer) => {
      if (!acceptsFrames) return;
      const header = parseFrameHeader(data);
      if (!header) return;
      const timestampUs = clock.next(header.timestampUs);
      const body = data.subarray(FRAME_HEADER_BYTES);
      if (header.pixelFormat !== JPEG_FORMAT) {
        push(body, header.width, header.height, header.stride, header.pixelFormat, timestampUs);
        return;
      }
      // Late frames are worthless, so fall behind by dropping rather than queueing without limit.
      if (queued > 5) return;
      queued++;
      queue = queue.then(async () => {
        try {
          const { data: rgb, info } = await sharp(body)
            .removeAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });
          push(rgb, info.width, info.height, info.width * 3, mod.PixelFormat.kRGB, timestampUs);
        } catch {
          /* A corrupt frame is skipped. */
        } finally {
          queued--;
        }
      });
    });
  });

  const address = server.address();
  send({
    type: 'ready',
    framesPort: typeof address === 'object' && address ? address.port : 0,
  });

  sdk.useCustomInput();
  sdk.start();
  send({ type: 'status', state: 'starting' });

  const shutdown = async (): Promise<void> => {
    try {
      await sdk.stopAsync();
      await sdk.destroy();
    } finally {
      process.exit(0);
    }
  };
  process.on('message', (m) => {
    if (m === 'shutdown') void shutdown();
  });
  process.on('disconnect', () => void shutdown());
}

main().catch((err: Error) => {
  send({ type: 'error', code: -1, message: err.message, retryable: true });
  process.exit(1);
});
