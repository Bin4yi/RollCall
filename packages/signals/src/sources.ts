import type { SignalBus, SignalSource, SourceStatus } from './bus';
import { VitalsFrameSchema, type VitalsFrame } from './schema';

/** Plays recorded frames at real speed against the caller's clock. Loopable and seekable. */
export class ReplaySource implements SignalSource {
  readonly kind = 'replay' as const;
  status: SourceStatus = 'idle';
  private bus: SignalBus | null = null;
  private cursor = 0;
  private time = 0;
  private loopOffset = 0;
  private readonly duration: number;

  constructor(
    readonly name: string,
    private readonly frames: VitalsFrame[],
    private readonly loop = true,
  ) {
    this.duration = frames.at(-1)?.t ?? 0;
  }

  get label(): string {
    return `REPLAY · ${this.name}`;
  }

  get finished(): boolean {
    return !this.loop && this.cursor >= this.frames.length;
  }

  start(bus: SignalBus): void {
    this.bus = bus;
    this.status = this.frames.length ? 'streaming' : 'error';
  }

  seek(tMs: number): void {
    this.time = Math.max(0, Math.min(tMs, this.duration));
    this.loopOffset = 0;
    const next = this.frames.findIndex((f) => f.t >= this.time);
    this.cursor = next === -1 ? this.frames.length : next;
  }

  advance(dtMs: number): void {
    if (!this.bus || !this.frames.length) return;
    this.time += dtMs;
    // A subscriber may stop this source from inside publish, so the bus is checked every time.
    while (this.bus) {
      const frame = this.frames[this.cursor];
      if (!frame) {
        // A zero-length session has nothing to loop over and must not spin forever.
        if (!this.loop || this.duration <= 0) return;
        this.loopOffset += this.duration;
        this.cursor = 0;
        continue;
      }
      const at = frame.t + this.loopOffset;
      if (at > this.time) return;
      this.bus.publish({ ...frame, t: at, source: 'replay' });
      this.cursor++;
    }
  }

  stop(): void {
    this.bus = null;
    this.status = 'idle';
  }
}

export interface WebSocketLike {
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  readonly readyState: number;
  send(data: string): void;
  close(): void;
}

export type SidecarEvent =
  | { type: 'status'; state: string; detail?: string }
  | { type: 'validation'; code: number; hint: string }
  | { type: 'error'; code: number; message: string; retryable: boolean }
  | { type: 'recording'; name: string; state: 'started' | 'saved'; path?: string; frames?: number };

export interface LiveSourceOptions {
  url?: string;
  socketFactory: (url: string) => WebSocketLike;
  staleAfterMs?: number;
  reconnectAfterMs?: number;
  onEvent?: (event: SidecarEvent) => void;
}

/** WebSocket client for the sidecar: reconnects forever and flags stale data. */
export class LiveSource implements SignalSource {
  readonly kind = 'live' as const;
  readonly label = 'LIVE · SmartSpectra';
  status: SourceStatus = 'idle';
  private bus: SignalBus | null = null;
  private socket: WebSocketLike | null = null;
  private sinceFrame = 0;
  private sinceAttempt = 0;
  private readonly url: string;
  private readonly staleAfterMs: number;
  private readonly reconnectAfterMs: number;

  constructor(private readonly options: LiveSourceOptions) {
    this.url = options.url ?? 'ws://127.0.0.1:8765';
    this.staleAfterMs = options.staleAfterMs ?? 2500;
    this.reconnectAfterMs = options.reconnectAfterMs ?? 2000;
  }

  start(bus: SignalBus): void {
    this.bus = bus;
    this.connect();
  }

  private connect(): void {
    this.status = 'connecting';
    this.sinceAttempt = 0;
    const socket = this.options.socketFactory(this.url);
    this.socket = socket;
    socket.onopen = () => {
      this.send({ type: 'start' });
    };
    socket.onmessage = (ev) => this.handle(ev.data);
    socket.onerror = () => {
      /* onclose always follows and drives the reconnect */
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      if (this.bus) this.status = 'connecting';
    };
  }

  private handle(data: unknown): void {
    if (typeof data !== 'string') return;
    let message: unknown;
    try {
      message = JSON.parse(data);
    } catch {
      return;
    }
    if (typeof message !== 'object' || message === null) return;
    const candidate = message as { type?: string; frame?: unknown };
    if (candidate.type === 'frame') {
      const parsed = VitalsFrameSchema.safeParse(candidate.frame);
      if (parsed.success) {
        this.sinceFrame = 0;
        this.status = 'streaming';
        this.bus?.publish(parsed.data);
      }
    } else {
      this.options.onEvent?.(message as SidecarEvent);
    }
  }

  send(control: Record<string, unknown>): void {
    if (this.socket?.readyState === 1) this.socket.send(JSON.stringify(control));
  }

  advance(dtMs: number): void {
    if (!this.bus) return;
    if (this.socket) {
      this.sinceFrame += dtMs;
      if (this.status === 'streaming' && this.sinceFrame > this.staleAfterMs) {
        this.status = 'stale';
      }
    } else {
      this.sinceAttempt += dtMs;
      if (this.sinceAttempt >= this.reconnectAfterMs) this.connect();
    }
  }

  stop(): void {
    this.bus = null;
    this.status = 'idle';
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      if (socket.readyState === 1) socket.send(JSON.stringify({ type: 'stop' }));
      socket.close();
    }
  }
}

/** Collects any source's frames and renders them as JSONL. */
export class Recorder {
  private lines: string[] = [];

  add(frame: VitalsFrame): void {
    this.lines.push(JSON.stringify(frame));
  }

  get count(): number {
    return this.lines.length;
  }

  toJsonl(): string {
    return this.lines.length ? this.lines.join('\n') + '\n' : '';
  }
}
