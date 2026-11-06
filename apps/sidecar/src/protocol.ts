import type { VitalsFrame } from '@hush/signals';

export const VITALS_PORT = 8765;
export const FRAMES_PORT = 8766;

/**
 * Binary frame header sent by the browser to the worker's frame socket.
 * Mirrors packages/signals/src/browser/frameCapture.ts.
 * Layout (little endian): u32 width, u32 height, u32 stride, u32 pixelFormat, f64 timestampUs.
 */
export const FRAME_HEADER_BYTES = 24;

export interface FrameHeader {
  width: number;
  height: number;
  stride: number;
  pixelFormat: number;
  timestampUs: number;
}

export function parseFrameHeader(data: Buffer): FrameHeader | null {
  if (data.length < FRAME_HEADER_BYTES) return null;
  const header = {
    width: data.readUInt32LE(0),
    height: data.readUInt32LE(4),
    stride: data.readUInt32LE(8),
    pixelFormat: data.readUInt32LE(12),
    timestampUs: data.readDoubleLE(16),
  };
  return header.width > 0 && header.height > 0 ? header : null;
}

/** Messages from the SDK worker up to the supervisor. */
export type WorkerMessage =
  | { type: 'frame'; frame: VitalsFrame }
  | { type: 'status'; state: string; detail?: string }
  | { type: 'validation'; code: number; hint: string }
  | { type: 'error'; code: number; message: string; retryable: boolean };

/** Session names become file names, so only allow a safe character set. */
export function safeSessionName(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  return /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(name) ? name : null;
}

/** Coalesces SDK packets to the ~10 Hz frame rate in the signal contract. */
export function mergeFrames(pending: VitalsFrame | null, next: VitalsFrame): VitalsFrame {
  if (!pending) return next;
  const merged: VitalsFrame = { ...pending, ...next };
  // Waveforms hold "new samples since last frame", so they must accumulate, not overwrite.
  for (const key of ['pleth', 'breathTrace'] as const) {
    const a = pending[key];
    const b = next[key];
    if (a && b) merged[key] = { ...b, samples: [...a.samples, ...b.samples] };
  }
  return merged;
}

/** Decides when a start request has failed silently (probed: auth timeouts raise no error event). */
export class StartWatchdog {
  private startedAt: number | null = null;
  private running = false;

  constructor(private readonly timeoutMs: number) {}

  begin(now: number): void {
    this.startedAt = now;
    this.running = false;
  }

  markRunning(): void {
    this.running = true;
  }

  clear(): void {
    this.startedAt = null;
  }

  expired(now: number): boolean {
    return this.startedAt !== null && !this.running && now - this.startedAt > this.timeoutMs;
  }
}
