import { z } from 'zod';

const waveform = z.object({
  samples: z.array(z.number()),
  hz: z.number().positive(),
  /** SDK `stable` verdict. Traces have no confidence of their own; it is inherited from the rate. */
  stable: z.boolean().optional(),
});

/** The one signal contract between every source and the check-in logic. See docs/SDK_NOTES.md. */
export const VitalsFrameSchema = z.object({
  t: z.number().nonnegative(),
  source: z.enum(['live', 'replay', 'sim']),
  facePresent: z.boolean().optional(),
  quality: z
    .object({
      ok: z.boolean(),
      reason: z.string().optional(),
      /** SDK ValidationCode, when the reason came from the SDK. */
      code: z.number().optional(),
    })
    .optional(),
  pulse: z.object({ bpm: z.number(), conf: z.number().min(0).max(1) }).optional(),
  pleth: waveform.optional(),
  breath: z
    .object({
      bpm: z.number(),
      conf: z.number().min(0).max(1),
      ieRatio: z.number().optional(),
      amplitude: z.number().optional(),
      apnea: z.boolean().optional(),
    })
    .optional(),
  breathTrace: waveform.optional(),
  /** SDK `cardio.hrv[]`. Units are not stated in the SDK docs; see docs/SDK_NOTES.md. */
  hrv: z
    .object({
      rmssd: z.number(),
      sdnn: z.number().optional(),
      meanNn: z.number().optional(),
      /** Baevsky Stress Index. Only meaningful against the same person's own usual. */
      baevsky: z.number().optional(),
      conf: z.number().min(0).max(1),
    })
    .optional(),
  expression: z.record(z.string(), z.number()).optional(),
  talking: z.boolean().optional(),
  blink: z.boolean().optional(),
  head: z
    .object({
      x: z.number(),
      y: z.number(),
      scale: z.number(),
      yaw: z.number().optional(),
      pitch: z.number().optional(),
    })
    .optional(),
});

export type VitalsFrame = z.infer<typeof VitalsFrameSchema>;
export type SourceKind = VitalsFrame['source'];

/** Parse JSONL text. Malformed lines are skipped and counted, never thrown at the caller. */
export function parseSession(jsonl: string): { frames: VitalsFrame[]; skipped: number } {
  const frames: VitalsFrame[] = [];
  let skipped = 0;
  for (const line of jsonl.split('\n')) {
    if (!line.trim()) continue;
    try {
      frames.push(VitalsFrameSchema.parse(JSON.parse(line)));
    } catch {
      skipped++;
    }
  }
  return { frames, skipped };
}
