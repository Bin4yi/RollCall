import type { VitalsFrame } from './schema';

/**
 * Structural subset of the decoded SmartSpectra `Metrics` protobuf.
 * Field names and meanings: SDK docs/data-types.md and nodejs/docs/metrics.md (see SDK_NOTES.md).
 * protobufjs may hand `timestamp` (int64) over as a number, Long or string, hence `unknown`.
 */
export interface SdkMeasurement {
  value?: number;
  stable?: boolean;
  confidence?: number;
  timestamp?: unknown;
}
export interface SdkDetection {
  detected?: boolean;
  stable?: boolean;
  timestamp?: unknown;
}
export interface SdkMetrics {
  breathing?: {
    rate?: SdkMeasurement[];
    upperTrace?: SdkMeasurement[];
    amplitude?: SdkMeasurement[];
    apnea?: SdkDetection[];
    inhaleExhaleRatio?: SdkMeasurement[];
  };
  cardio?: {
    pulseRate?: SdkMeasurement[];
    arterialPressureTrace?: SdkMeasurement[];
    hrv?: { rmssd?: number; confidence?: number; stable?: boolean; timestamp?: unknown }[];
  };
  face?: {
    landmarks?: { value?: { x?: number; y?: number }[]; timestamp?: unknown }[];
    blinking?: SdkDetection[];
    talking?: SdkDetection[];
    expression?: { scores?: { type?: number | string; confidence?: number }[] }[];
  };
}

/** ExpressionType enum order from docs/data-types.md. */
const EXPRESSION_NAMES = [
  'unspecified',
  'angry',
  'contempt',
  'disgust',
  'fear',
  'happy',
  'neutral',
  'sad',
  'surprise',
];

/** The SDK reports confidence as a 0–100 percentage; the VitalsFrame contract uses 0..1. */
const conf01 = (c: number | undefined): number => Math.max(0, Math.min(1, (c ?? 0) / 100));

function toNumber(ts: unknown): number {
  if (typeof ts === 'number') return ts;
  if (typeof ts === 'string') return Number(ts);
  if (ts && typeof (ts as { toNumber?: unknown }).toNumber === 'function') {
    return (ts as { toNumber(): number }).toNumber();
  }
  return 0;
}

/** Validated face-size range guard: landmark frames may be pixels or normalised (unclear in docs). */
function headFromLandmarks(
  points: { x?: number; y?: number }[],
  frameSize: { width: number; height: number } | null,
): VitalsFrame['head'] | undefined {
  if (points.length < 10) return undefined;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    const x = p.x ?? 0;
    const y = p.y ?? 0;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  // Coordinates above 2 can only be pixels, so scale by the frame size when we know it.
  const pixels = maxX > 2 || maxY > 2;
  const w = pixels ? (frameSize?.width ?? 1280) : 1;
  const h = pixels ? (frameSize?.height ?? 720) : 1;
  return {
    x: (minX + maxX) / 2 / w,
    y: (minY + maxY) / 2 / h,
    scale: (maxX - minX) / w,
  };
}

/**
 * Stateful SDK → VitalsFrame mapper. `metrics` packets can batch several samples, and later
 * packets may repeat earlier timestamps, so waveforms are de-duplicated by timestamp here.
 */
export class MetricsNormalizer {
  private lastPlethTs = -Infinity;
  private lastTraceTs = -Infinity;
  private plethHz = 30;
  private traceHz = 30;
  private validation: { ok: boolean; reason?: string } = { ok: true };
  private facePresent = true;

  constructor(private readonly frameSize: { width: number; height: number } | null = null) {}

  /** Feed `validationStatus` events; code 0 is kOk and code 1 is kNoFaceFound. */
  setValidation(code: number, hint: string): void {
    this.validation = code === 0 ? { ok: true } : { ok: false, reason: hint };
    this.facePresent = code !== 1;
  }

  toFrame(metrics: SdkMetrics, tMs: number): VitalsFrame {
    const frame: VitalsFrame = {
      t: tMs,
      source: 'live',
      facePresent: this.facePresent,
      quality: this.validation,
    };

    const rate = metrics.cardio?.pulseRate?.at(-1);
    if (rate?.value !== undefined) frame.pulse = { bpm: rate.value, conf: conf01(rate.confidence) };

    const pressure = metrics.cardio?.arterialPressureTrace;
    if (pressure?.length) {
      const fresh = this.fresh(pressure, this.lastPlethTs);
      if (fresh.samples.length) {
        this.lastPlethTs = fresh.lastTs;
        this.plethHz = fresh.hz ?? this.plethHz;
        frame.pleth = { samples: fresh.samples, hz: this.plethHz, stable: pressure.at(-1)?.stable };
      }
    }

    const breathing = metrics.breathing;
    const br = breathing?.rate?.at(-1);
    if (br?.value !== undefined) {
      frame.breath = {
        bpm: br.value,
        conf: conf01(br.confidence),
        ieRatio: breathing?.inhaleExhaleRatio?.at(-1)?.value,
        amplitude: breathing?.amplitude?.at(-1)?.value,
        apnea: breathing?.apnea?.at(-1)?.detected,
      };
    }
    const upper = breathing?.upperTrace;
    if (upper?.length) {
      const fresh = this.fresh(upper, this.lastTraceTs);
      if (fresh.samples.length) {
        this.lastTraceTs = fresh.lastTs;
        this.traceHz = fresh.hz ?? this.traceHz;
        frame.breathTrace = {
          samples: fresh.samples,
          hz: this.traceHz,
          stable: upper.at(-1)?.stable,
        };
      }
    }

    const hrv = metrics.cardio?.hrv?.at(-1);
    if (hrv?.rmssd !== undefined) {
      frame.hrv = { value: hrv.rmssd, unit: 'ms', conf: conf01(hrv.confidence) };
    }

    const face = metrics.face;
    const talking = face?.talking?.at(-1);
    if (talking) frame.talking = !!talking.detected;
    const blink = face?.blinking?.at(-1);
    if (blink) frame.blink = !!blink.detected;
    const scores = face?.expression?.at(-1)?.scores;
    if (scores?.length) {
      frame.expression = {};
      for (const s of scores) {
        const name = typeof s.type === 'number' ? EXPRESSION_NAMES[s.type] : s.type?.toLowerCase();
        if (name) frame.expression[name] = conf01(s.confidence);
      }
    }
    const points = face?.landmarks?.at(-1)?.value;
    if (points?.length) {
      const head = headFromLandmarks(points, this.frameSize);
      if (head) frame.head = head;
    }
    return frame;
  }

  private fresh(
    items: SdkMeasurement[],
    lastTs: number,
  ): { samples: number[]; lastTs: number; hz: number | null } {
    const samples: number[] = [];
    const stamps: number[] = [];
    let latest = lastTs;
    for (const item of items) {
      const ts = toNumber(item.timestamp);
      if (ts > lastTs && item.value !== undefined) {
        samples.push(item.value);
        stamps.push(ts);
        latest = Math.max(latest, ts);
      }
    }
    let hz: number | null = null;
    const first = stamps[0];
    const last = stamps.at(-1);
    if (stamps.length >= 3 && first !== undefined && last !== undefined && last > first) {
      hz = ((stamps.length - 1) * 1e6) / (last - first); // timestamps are microseconds
    }
    return { samples, lastTs: latest, hz };
  }
}
