import { dist, pair, pt } from './geometry';
import { L, type PoseFrame } from './types';

export interface FramingHint {
  ok: boolean;
  text: string;
  code: 'no-person' | 'feet' | 'head' | 'far' | 'close' | 'turn-side' | 'turn-front' | 'ok';
}

export type View = 'side' | 'front' | 'either';

/** Share of the frame height that counts as too small to read. */
const MIN_BODY = 0.42;
const SIDE_MAX_SHOULDER_RATIO = 0.5;
const FRONT_MIN_SHOULDER_RATIO = 0.35;

/** Words mapped from what's actually visible. `lying` skips the standing-height checks. */
export function framingHint(
  frame: PoseFrame | null,
  view: View = 'either',
  exerciseName = 'this one',
  lying = false,
): FramingHint {
  const hint = (code: FramingHint['code'], text: string): FramingHint => ({ ok: code === 'ok', code, text });
  if (!frame) return hint('no-person', 'I can’t see you yet. Step into view.');
  const hip = pair(frame, L.lHip, L.rHip);
  const shoulder = pair(frame, L.lShoulder, L.rShoulder);
  const ankle = pair(frame, L.lAnkle, L.rAnkle);
  if (!hip || !shoulder) return hint('no-person', 'I can’t see you yet. Step into view.');
  if (!ankle) return hint('feet', 'Step back a little, your feet are cut off.');
  const nose = pt(frame, L.nose);
  if (!nose) return hint('head', 'Step back a little, your head is cut off.');
  if (!lying) {
    const size = dist(nose, ankle);
    if (size < MIN_BODY) return hint('far', 'Come a bit closer, you’re quite small in the picture.');
    if (size > 0.97) return hint('close', 'Step back a little so there’s room to move.');
    const l = pt(frame, L.lShoulder);
    const r = pt(frame, L.rShoulder);
    const torso = dist(shoulder, hip);
    if (l && r && torso > 0) {
      const ratio = dist(l, r) / torso;
      if (view === 'side' && ratio > SIDE_MAX_SHOULDER_RATIO) {
        return hint('turn-side', `Turn a bit to the side for ${exerciseName}.`);
      }
      if (view === 'front' && ratio < FRONT_MIN_SHOULDER_RATIO) {
        return hint('turn-front', `Face the camera for ${exerciseName}.`);
      }
    }
  }
  return hint('ok', 'That’s it. Stay right there.');
}
