/**
 * SDK worker: the only process that touches SmartSpectra native code. The supervisor restarts it
 * if it dies. Every SDK call is documented in docs/SDK_NOTES.md.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { MetricsNormalizer, type SdkMetrics } from '@hush/signals';
import { WebSocketServer } from 'ws';
import {
  FRAMES_PORT,
  FRAME_HEADER_BYTES,
  mergeFrames,
  parseFrameHeader,
  type WorkerMessage,
} from './protocol';

interface SdkInstance {
  on(event: string, callback: (...args: never[]) => void): SdkInstance;
  useCamera(selection: unknown, options?: unknown): SdkInstance;
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
  CameraSelection: { default: unknown };
  ProcessingStatus: { kRunning: number; kError: number };
  breathingMetrics: number[];
  cardioMetrics: number[];
  faceMetrics: number[];
}

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
      detail: `SmartSpectra SDK not installed. Run: pnpm sidecar:setup (${(err as Error).message})`,
    });
    return null;
  }
}

async function main(): Promise<void> {
  const apiKey = process.env.SMARTSPECTRA_API_KEY;
  if (!apiKey) {
    send({
      type: 'status',
      state: 'no-key',
      detail: 'Set SMARTSPECTRA_API_KEY in .env (Replay and Sim modes need no key).',
    });
    return;
  }
  const loaded = loadSdk();
  if (!loaded) return;
  const { sdk: mod, decode } = loaded;
  const inputMode = process.env.HUSH_INPUT === 'camera' ? 'camera' : 'frames';

  const sdk = new mod.SmartSpectraSDK({
    apiKey,
    enableTelemetry: false,
    requestedMetrics: [...mod.breathingMetrics, ...mod.cardioMetrics, ...mod.faceMetrics],
  });

  let frameSize: { width: number; height: number } | null = null;
  let normalizer = new MetricsNormalizer(frameSize);
  const startedAt = performance.now();
  let pending: ReturnType<MetricsNormalizer['toFrame']> | null = null;

  sdk.on('processingStatus', ((status: number) => {
    const name =
      status === mod.ProcessingStatus.kRunning
        ? 'running'
        : status === mod.ProcessingStatus.kError
          ? 'error'
          : `status-${status}`;
    send({ type: 'status', state: name });
  }) as never);
  sdk.on('validationStatus', ((code: number, _ts: number, hint: string) => {
    normalizer.setValidation(code, hint);
    send({ type: 'validation', code, hint });
  }) as never);
  sdk.on('metrics', ((buf: Buffer) => {
    const decoded = decode(buf);
    if (Buffer.isBuffer(decoded)) return;
    const frame = normalizer.toFrame(
      decoded as SdkMetrics,
      Math.round(performance.now() - startedAt),
    );
    pending = mergeFrames(pending, frame);
  }) as never);
  sdk.on('error', ((code: number, message: string, retryable: boolean) => {
    send({ type: 'error', code, message, retryable });
  }) as never);

  setInterval(() => {
    if (pending) {
      send({ type: 'frame', frame: pending });
      pending = null;
    }
  }, 100);

  if (inputMode === 'camera') {
    sdk.useCamera(mod.CameraSelection.default);
    sdk.start();
  } else {
    sdk.useCustomInput();
    sdk.start();
    const server = new WebSocketServer({ host: '127.0.0.1', port: FRAMES_PORT, maxPayload: 16e6 });
    let lastTs = -1;
    server.on('connection', (socket) => {
      socket.on('message', (data: Buffer) => {
        const header = parseFrameHeader(data);
        if (!header) return;
        if (!frameSize || frameSize.width !== header.width) {
          frameSize = { width: header.width, height: header.height };
          normalizer = new MetricsNormalizer(frameSize);
        }
        // The SDK rejects non-monotonic timestamps; a reconnecting tab can restart its clock.
        const timestampUs = Math.max(header.timestampUs, lastTs + 1);
        lastTs = timestampUs;
        sdk.sendFrame(
          data.subarray(FRAME_HEADER_BYTES),
          header.width,
          header.height,
          header.stride,
          header.pixelFormat,
          timestampUs,
        );
      });
    });
  }
  send({ type: 'status', state: 'starting', detail: inputMode });

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
