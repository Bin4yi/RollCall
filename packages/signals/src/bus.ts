import type { VitalsFrame, SourceKind } from './schema';

export type FrameListener = (frame: VitalsFrame) => void;

/** Fan-out point: one source publishes, the engine, HUD, audio and recorder subscribe. */
export class SignalBus {
  private listeners = new Set<FrameListener>();

  subscribe(listener: FrameListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  publish(frame: VitalsFrame): void {
    for (const listener of this.listeners) listener(frame);
  }
}

export type SourceStatus = 'idle' | 'connecting' | 'streaming' | 'stale' | 'error';

/**
 * Every source is driven by `advance(dtMs)` rather than its own timer, so the whole game
 * (including tests) runs deterministically from one clock.
 */
export interface SignalSource {
  readonly kind: SourceKind;
  /** Text for the always-visible source badge, e.g. "REPLAY · calm_60s". */
  readonly label: string;
  readonly status: SourceStatus;
  start(bus: SignalBus): void;
  advance(dtMs: number): void;
  stop(): void;
}
