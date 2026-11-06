import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useCheckin } from './athlete/useCheckin';
import { Disclaimer } from './ui/kit';

const SESSIONS = [
  { name: 'calm_seated_90s', how: 'Sit still, breathe normally.' },
  { name: 'after_coffee_90s', how: 'Within 30 minutes of a coffee. Sit still.' },
  { name: 'poor_light_60s', how: 'Turn the lights down first. Keep your face in view.' },
  { name: 'talking_60s', how: 'Talk on and off. The check-in should pause.' },
  { name: 'leaning_away_60s', how: 'Lean out of frame twice.' },
];

function Run({ token, name, onDone }: { token: string; name: string; onDone: () => void }) {
  const { state, stream, liveMode } = useCheckin({ token, kind: 'morning', mode: 'live', session: null, speed: null, record: name });
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (video.current) video.current.srcObject = stream;
  }, [stream]);
  return (
    <section className="card mt-4 p-4">
      <h2 className="text-xl">Recording {name}</h2>
      <p>Mode: {liveMode ?? 'connecting'}</p>
      <video ref={video} autoPlay muted playsInline className="mt-2 w-64 -scale-x-100 rounded-xl" aria-label="Camera preview, not recorded" />
      <pre className="mt-2 overflow-auto rounded-lg bg-paper-2 p-2 text-xs" data-testid="recorder-state">
        {JSON.stringify(state, null, 1)}
      </pre>
      <button className="btn mt-2" onClick={onDone}>
        Close
      </button>
    </section>
  );
}

/** Development tool: records reference sessions as numbers only, to data/sessions/. */
export default function Recorder() {
  const [params] = useSearchParams();
  const [name, setName] = useState<string | null>(null);
  const [token, setToken] = useState(params.get('token') ?? '');
  return (
    <main id="content" className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="text-3xl">Record reference sessions</h1>
      <p className="mt-1 text-sm text-mute">Development only. Saves numbers to data/sessions/, never video. Each one uses live SDK time.</p>
      <label htmlFor="token" className="mt-4 block text-sm font-semibold">
        A real athlete’s link token (their consent is needed; the recording isn’t added to their history)
      </label>
      <input id="token" value={token} onChange={(e) => setToken(e.target.value)} />
      <ul className="mt-4 space-y-2">
        {SESSIONS.map((s) => (
          <li key={s.name} className="card flex items-center justify-between gap-3 p-3">
            <span>
              <strong>{s.name}</strong>
              <br />
              <span className="text-sm text-mute">{s.how}</span>
            </span>
            <button className="btn shrink-0" disabled={!token || !!name} onClick={() => setName(s.name)}>
              Record
            </button>
          </li>
        ))}
      </ul>
      {name && <Run token={token} name={name} onDone={() => setName(null)} />}
      <Disclaimer className="mt-5" />
    </main>
  );
}
