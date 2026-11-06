export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Time-constant EMA that behaves the same at any tick rate. Seeds from the first sample. */
export class Ema {
  value: number | null = null;
  constructor(private readonly tauSeconds: number) {}

  update(sample: number, dtSeconds: number): number {
    if (this.value === null) this.value = sample;
    else this.value += (sample - this.value) * (1 - Math.exp(-dtSeconds / this.tauSeconds));
    return this.value;
  }
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Coefficient of variation; 0 when there's too little data to judge. */
export function cv(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean <= 0) return 0;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}
