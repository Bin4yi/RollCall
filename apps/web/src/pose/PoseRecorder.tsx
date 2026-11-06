import { toPoseJsonl, type PoseFrame } from '@rollcall/pose';
import { useCallback, useRef, useState } from 'react';
import { Disclaimer } from '../ui/kit';
import { PoseStage } from './PoseStage';
import { usePose } from './usePose';

const SESSIONS = [
  { name: 'jumps_fresh', how: 'Hands on hips. Three good jumps, about 5 seconds apart.' },
  { name: 'jumps_tired', how: 'Same, after a leg session.' },
  { name: 'jumps_tucked', how: 'One jump tucking your knees on landing, then two normal ones.' },
  { name: 'squats_good', how: 'Side-on. Ten steady squats.' },
  { name: 'squats_slowing', how: 'Side-on. Squats until they slow down.' },
  { name: 'pushups', how: 'Side-on. Push-ups until they slow down.' },
  { name: 'bad_framing', how: 'Stand too close, with your feet cut off.' },
];

/**
 * Records landmarks, never video, to a .pose.jsonl that downloads to this device. Put the file in
 * apps/web/public/poses/ to replace the synthetic session of the same name.
 */
export default function PoseRecorder() {
  const [active, setActive] = useState<string | null>(null);
  const [frames, setFrames] = useState(0);
  const buffer = useRef<PoseFrame[]>([]);
  const onFrame = useCallback((f: PoseFrame) => {
    buffer.current.push(f);
    if (buffer.current.length % 15 === 0) setFrames(buffer.current.length);
  }, []);
  const pose = usePose({ mode: 'live', session: '', active: active !== null, onFrame });

  const stop = (): void => {
    const data = buffer.current;
    if (active && data.length) {
      const base = data[0]!.t;
      const span = data.at(-1)!.t - base;
      const text = toPoseJsonl(
        { pose: 1, label: active, synthetic: false, aspect: data[0]!.aspect, fps: span > 0 ? Math.round(((data.length - 1) * 1000) / span) : 0 },
        data.map((f) => ({ ...f, t: f.t - base })),
      );
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: 'application/x-ndjson' }));
      a.download = `${active}.pose.jsonl`;
      a.click();
    }
    buffer.current = [];
    setFrames(0);
    setActive(null);
  };

  return (
    <main id="content" className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="text-3xl">Pose session recorder</h1>
      <p className="text-mute">Saves tracked landmarks only, to this device. No video, and nothing is uploaded.</p>
      {active ? (
        <section className="mt-4">
          <div className="flex h-[60dvh] flex-col overflow-hidden rounded-2xl">
            <PoseStage stream={pose.stream} latest={pose.latest} mode="live" ok={false} />
          </div>
          <p className="mt-2 font-semibold" data-testid="pose-recorder-state">
            {pose.status === 'failed' ? pose.message : `${active}: ${pose.status}, ${frames} frames, ${pose.fps} fps`}
          </p>
          <button className="btn btn-coral mt-2" onClick={stop}>
            Stop and save
          </button>
        </section>
      ) : (
        <ul className="mt-4 space-y-2">
          {SESSIONS.map((s) => (
            <li key={s.name} className="card flex items-center justify-between gap-3 p-3">
              <div>
                <p className="font-display font-bold">{s.name}</p>
                <p className="text-sm text-mute">{s.how}</p>
              </div>
              <button className="btn shrink-0" onClick={() => setActive(s.name)}>
                Record
              </button>
            </li>
          ))}
        </ul>
      )}
      <Disclaimer className="mt-6" />
    </main>
  );
}
