import { describe, expect, it } from 'vitest';
import {
  LiveSource,
  MetricsNormalizer,
  parseSession,
  Recorder,
  ReplaySource,
  SignalBus,
  SimSource,
  VitalsFrameSchema,
  type VitalsFrame,
  type WebSocketLike,
} from '../src';

const collect = (bus: SignalBus): VitalsFrame[] => {
  const frames: VitalsFrame[] = [];
  bus.subscribe((f) => frames.push(f));
  return frames;
};

describe('parseSession', () => {
  it('skips malformed lines and counts them', () => {
    const text =
      '{"t":0,"source":"sim"}\nnot json\n{"t":"x","source":"sim"}\n\n{"t":5,"source":"live"}\n';
    const { frames, skipped } = parseSession(text);
    expect(frames.map((f) => f.t)).toEqual([0, 5]);
    expect(skipped).toBe(2);
  });
});

describe('ReplaySource', () => {
  const frames: VitalsFrame[] = [0, 100, 200].map((t) => ({ t, source: 'live' }));

  it('plays at caller speed and relabels the source', () => {
    const bus = new SignalBus();
    const got = collect(bus);
    const src = new ReplaySource('s', frames, false);
    src.start(bus);
    src.advance(50);
    expect(got.map((f) => f.t)).toEqual([0]);
    src.advance(150);
    expect(got.map((f) => f.t)).toEqual([0, 100, 200]);
    expect(got.every((f) => f.source === 'replay')).toBe(true);
    expect(src.finished).toBe(true);
    expect(src.label).toBe('REPLAY · s');
  });

  it('loops with monotonic time and can seek', () => {
    const bus = new SignalBus();
    const got = collect(bus);
    const src = new ReplaySource('s', frames, true);
    src.start(bus);
    src.advance(450);
    const ts = got.map((f) => f.t);
    expect(ts).toEqual([...ts].sort((a, b) => a - b));
    expect(ts.at(-1)).toBeGreaterThanOrEqual(400);
    src.seek(100);
    got.length = 0;
    src.advance(0);
    expect(got[0]?.t).toBe(100);
  });

  it('does not hang on a single-frame session', () => {
    const bus = new SignalBus();
    const got = collect(bus);
    const src = new ReplaySource('s', [{ t: 0, source: 'live' }], true);
    src.start(bus);
    src.advance(1000);
    expect(got).toHaveLength(1);
  });
});

describe('SimSource', () => {
  it('emits schema-valid 10 Hz frames with SDK-like warm-up', () => {
    const bus = new SignalBus();
    const got = collect(bus);
    const sim = new SimSource(7);
    sim.start(bus);
    sim.advance(31_000);
    expect(got).toHaveLength(310);
    got.forEach((f) => VitalsFrameSchema.parse(f));
    expect(got[50]?.pulse?.conf).toBe(0);
    expect(got[50]?.breath?.conf).toBe(0);
    expect(got[200]?.pulse?.conf).toBeGreaterThan(0.4);
    expect(got[305]?.breath?.conf).toBeGreaterThan(0.45);
  });

  it('changing the body changes the frames', () => {
    const bus = new SignalBus();
    const got = collect(bus);
    const sim = new SimSource(7);
    sim.start(bus);
    sim.body.talking = true;
    sim.body.facePresent = false;
    sim.advance(200);
    expect(got.at(-1)?.facePresent).toBe(false);
    sim.body.facePresent = true;
    sim.advance(100);
    expect(got.at(-1)?.talking).toBe(true);
    expect(got.at(-1)?.facePresent).toBe(true);
  });

  it('reports every HRV field once its 60 s window fills', () => {
    const bus = new SignalBus();
    const got = collect(bus);
    const sim = new SimSource(7, { rmssd: 40, baevsky: 120 });
    sim.start(bus);
    sim.advance(61_000);
    expect(got[100]?.hrv?.conf).toBe(0);
    const { rmssd, baevsky, sdnn, meanNn, conf } = got.at(-1)!.hrv!;
    expect([rmssd, baevsky]).toEqual([40, 120]);
    expect(sdnn).toBeGreaterThan(0);
    expect(meanNn).toBeGreaterThan(0);
    expect(conf).toBeGreaterThan(0.5);
  });
});

describe('MetricsNormalizer', () => {
  it('maps SDK confidence percentages and enum expressions', () => {
    const n = new MetricsNormalizer();
    const frame = n.toFrame(
      {
        cardio: { pulseRate: [{ value: 71, confidence: 80 }] },
        breathing: {
          rate: [{ value: 13, confidence: 45 }],
          inhaleExhaleRatio: [{ value: 0.7 }],
          apnea: [{ detected: false }],
        },
        face: {
          talking: [{ detected: true }],
          expression: [
            {
              scores: [
                { type: 4, confidence: 35 },
                { type: 'NEUTRAL', confidence: 60 },
              ],
            },
          ],
        },
      },
      1234,
    );
    expect(frame.pulse).toEqual({ bpm: 71, conf: 0.8 });
    expect(frame.breath?.conf).toBeCloseTo(0.45);
    expect(frame.breath?.ieRatio).toBe(0.7);
    expect(frame.talking).toBe(true);
    expect(frame.expression?.fear).toBeCloseTo(0.35);
    expect(frame.expression?.neutral).toBeCloseTo(0.6);
    VitalsFrameSchema.parse(frame);
  });

  it('de-duplicates repeated trace samples and derives the rate from microsecond stamps', () => {
    const n = new MetricsNormalizer();
    const packet = (from: number) => ({
      breathing: {
        upperTrace: [0, 1, 2, 3].map((i) => ({
          value: i,
          stable: true,
          timestamp: from + i * 33_333,
        })),
      },
    });
    const a = n.toFrame(packet(1_000_000), 0);
    expect(a.breathTrace?.samples).toEqual([0, 1, 2, 3]);
    expect(a.breathTrace?.hz).toBeCloseTo(30, 0);
    expect(a.breathTrace?.stable).toBe(true);
    // Overlapping packet: only the two genuinely new samples should come through.
    const b = n.toFrame(packet(1_000_000 + 2 * 33_333), 100);
    expect(b.breathTrace?.samples).toEqual([2, 3]);
    expect(n.toFrame(packet(1_000_000), 200).breathTrace).toBeUndefined();
  });

  it('handles Long-style timestamps', () => {
    const n = new MetricsNormalizer();
    const f = n.toFrame(
      { breathing: { upperTrace: [{ value: 1, timestamp: { toNumber: () => 5 } }] } },
      0,
    );
    expect(f.breathTrace?.samples).toEqual([1]);
  });

  it('turns validation codes into quality and face presence', () => {
    const n = new MetricsNormalizer();
    n.setValidation(1, 'No face');
    let f = n.toFrame({}, 0);
    expect(f.facePresent).toBe(false);
    expect(f.quality).toEqual({ ok: false, reason: 'No face', code: 1 });
    n.setValidation(5, 'Too dark');
    f = n.toFrame({}, 0);
    expect(f.facePresent).toBe(true);
    expect(f.quality?.ok).toBe(false);
    n.setValidation(0, '');
    expect(n.toFrame({}, 0).quality?.ok).toBe(true);
  });

  it('derives head position from pixel and normalised landmarks', () => {
    const pts = (scale: number) =>
      Array.from({ length: 20 }, (_, i) => ({ x: (0.4 + (i % 2) * 0.2) * scale, y: 0.5 * scale }));
    const px = new MetricsNormalizer({ width: 1000, height: 1000 }).toFrame(
      { face: { landmarks: [{ value: pts(1000) }] } },
      0,
    );
    expect(px.head?.x).toBeCloseTo(0.5);
    expect(px.head?.scale).toBeCloseTo(0.2);
    const unit = new MetricsNormalizer().toFrame({ face: { landmarks: [{ value: pts(1) }] } }, 0);
    expect(unit.head?.x).toBeCloseTo(0.5);
  });
});

class FakeSocket implements WebSocketLike {
  onopen: WebSocketLike['onopen'] = null;
  onmessage: WebSocketLike['onmessage'] = null;
  onclose: WebSocketLike['onclose'] = null;
  onerror: WebSocketLike['onerror'] = null;
  readyState = 1;
  sent: string[] = [];
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
  }
}

describe('LiveSource', () => {
  it('starts the sidecar, forwards frames, flags stale data and reconnects', () => {
    const sockets: FakeSocket[] = [];
    const events: unknown[] = [];
    const src = new LiveSource({
      socketFactory: () => {
        const s = new FakeSocket();
        sockets.push(s);
        return s;
      },
      staleAfterMs: 1000,
      reconnectAfterMs: 500,
      onEvent: (e) => events.push(e),
    });
    const bus = new SignalBus();
    const got = collect(bus);
    src.start(bus);
    const first = sockets[0]!;
    first.onopen?.({});
    expect(first.sent[0]).toContain('"start"');

    first.onmessage?.({ data: JSON.stringify({ type: 'frame', frame: { t: 1, source: 'live' } }) });
    first.onmessage?.({ data: JSON.stringify({ type: 'frame', frame: { t: 'bad' } }) });
    first.onmessage?.({ data: 'garbage' });
    first.onmessage?.({ data: JSON.stringify({ type: 'validation', code: 5, hint: 'dark' }) });
    expect(got).toHaveLength(1);
    expect(events).toHaveLength(1);
    expect(src.status).toBe('streaming');

    src.advance(1100);
    expect(src.status).toBe('stale');

    first.onclose?.({});
    src.advance(600);
    expect(sockets).toHaveLength(2);
  });
});

describe('Recorder', () => {
  it('round-trips through JSONL', () => {
    const r = new Recorder();
    r.add({ t: 1, source: 'sim', pulse: { bpm: 70, conf: 1 } });
    r.add({ t: 2, source: 'sim' });
    expect(r.count).toBe(2);
    expect(parseSession(r.toJsonl()).frames[0]?.pulse?.bpm).toBe(70);
  });
});

describe('MetricsNormalizer.heartbeat', () => {
  it('carries validation state before the SDK has metrics', () => {
    const n = new MetricsNormalizer();
    n.setValidation(1, 'No face found.');
    expect(n.heartbeat(500)).toEqual({
      t: 500,
      source: 'live',
      facePresent: false,
      quality: { ok: false, reason: 'No face found.', code: 1 },
    });
  });
});
