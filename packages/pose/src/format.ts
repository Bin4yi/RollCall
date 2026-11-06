import { BODY, type Lm, type PoseFrame } from './types';

export interface PoseHeader {
  pose: 1;
  label: string;
  /** True for generated files. They're never presented as a real person. */
  synthetic: boolean;
  aspect: number;
  fps: number;
}

export interface PoseSession {
  header: PoseHeader;
  frames: PoseFrame[];
}

const r3 = (v: number): number => Math.round(v * 1000) / 1000;

/** One JSON header, then one line per frame: x, y and visibility for each landmark in BODY order. */
export function toPoseJsonl(header: PoseHeader, frames: readonly PoseFrame[]): string {
  const lines = frames.map((f) => {
    const p: number[] = [];
    for (const id of BODY) {
      const m = f.lm[id];
      p.push(m ? r3(m.x) : 0, m ? r3(m.y) : 0, m ? r3(m.v) : 0);
    }
    return JSON.stringify({ t: Math.round(f.t * 10) / 10, p });
  });
  return `${JSON.stringify(header)}\n${lines.join('\n')}\n`;
}

export function parsePoseJsonl(text: string): PoseSession {
  const [head, ...rest] = text.split(/\r?\n/).filter(Boolean);
  if (!head) throw new Error('Empty pose session');
  const header = JSON.parse(head) as PoseHeader;
  if (header.pose !== 1) throw new Error('Not a pose session');
  const frames = rest.map((line): PoseFrame => {
    const { t, p } = JSON.parse(line) as { t: number; p: number[] };
    const lm: (Lm | undefined)[] = [];
    BODY.forEach((id, i) => {
      const v = p[i * 3 + 2] ?? 0;
      if (v > 0) lm[id] = { x: p[i * 3]!, y: p[i * 3 + 1]!, v };
    });
    return { t, aspect: header.aspect, lm };
  });
  return { header, frames };
}

/** Plays frames against a clock. The same in the browser and in tests. */
export class PoseReplay {
  private index = 0;
  constructor(private readonly session: PoseSession) {}

  /** Frames due by `ms` since the replay began. */
  framesUntil(ms: number): PoseFrame[] {
    const out: PoseFrame[] = [];
    const frames = this.session.frames;
    const base = frames[0]?.t ?? 0;
    while (this.index < frames.length && frames[this.index]!.t - base <= ms) out.push(frames[this.index++]!);
    return out;
  }

  get finished(): boolean {
    return this.index >= this.session.frames.length;
  }
}
