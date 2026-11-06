import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, ApiError, type AppConfig, type AthleteHome } from '../api';
import { Art, Avatar, DemoBanner, Disclaimer, Problem, RolloWave, Spinner, type AssetId } from '../ui/kit';
import { skyFor, SunriseCanvas } from './Sunrise';
import { useCheckin, type CheckinResult, type Progress } from './useCheckin';

const POSE: Record<NonNullable<Progress['hint']>['pose'], AssetId> = {
  lamp: 'rollo_lamp',
  phone: 'rollo_phone',
  still: 'rollo_still',
  shh: 'rollo_shh',
  wave: 'rollo_wave',
};

const FEELS = [
  { value: 1, label: 'Wrecked', art: 'feel_1' },
  { value: 2, label: 'Tired', art: 'feel_2' },
  { value: 3, label: 'Okay', art: 'feel_3' },
  { value: 4, label: 'Good', art: 'feel_4' },
  { value: 5, label: 'Flying', art: 'feel_5' },
] as const;

const BADGES = [3, 7, 14, 30, 60, 100] as const;

const ONBOARDING: { art: AssetId; title: string; body: string }[] = [
  { art: 'onboard_prop', title: 'Prop your phone up', body: 'Against a bottle or a book, about arm’s length away.' },
  { art: 'onboard_frame', title: 'Face and upper chest in view', body: 'I’ll tell you if you need to move.' },
  { art: 'onboard_light', title: 'Light in front of you', body: 'A window or lamp you’re facing. Not behind you.' },
  { art: 'onboard_still', title: 'Sit still for 75 seconds', body: 'Stay quiet and breathe normally. Not straight after exercise.' },
];

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? 'Morning' : h < 18 ? 'Afternoon' : 'Evening';
}

function Consent({ home, token, onDone }: { home: AthleteHome; token: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <main id="content" className="mx-auto max-w-lg px-4 py-6">
      <RolloWave />
      <h1 className="mt-2 text-center text-3xl">{greeting()}, {home.name}.</h1>
      <p className="mt-1 text-center text-mute">Before your first check-in, here’s the deal.</p>
      <div className="card mt-5 space-y-4 p-5 text-sm leading-relaxed">
        <section>
          <h2 className="text-lg">What’s measured</h2>
          <p>Your camera is used to estimate your resting pulse, breathing rate and heart-rate variability, and to notice if you’re talking or moving. You also tap in your sleep and how you feel.</p>
        </section>
        <section>
          <h2 className="text-lg">What’s kept</h2>
          <p>Video goes to the Roll Call server over an encrypted connection, is processed in memory and thrown away. It’s never saved. Only the numbers are stored. The measuring SDK from Presage contacts Presage’s servers to check its key and usage, and to load its models.</p>
        </section>
        <section>
          <h2 className="text-lg">Who sees it</h2>
          <p>Your coach sees your numbers and how they compare with your own usual. When they ask for a draft message, an AI service sees numbers only: never your name, your video or your coach’s notes.</p>
        </section>
        <section>
          <h2 className="text-lg">Your choice</h2>
          <p>You can download or delete everything at any time from this page.</p>
        </section>
        <Disclaimer />
      </div>
      <button
        className="btn btn-primary mt-5 w-full text-lg"
        disabled={busy}
        data-testid="consent-accept"
        onClick={() => {
          setBusy(true);
          void api(`/api/a/${token}/consent`, { method: 'POST' }).then(onDone);
        }}
      >
        I’m 18 or over, and I agree
      </button>
    </main>
  );
}

function Onboarding({ onDone }: { onDone: () => void }) {
  const [index, setIndex] = useState(0);
  const card = ONBOARDING[index]!;
  const still = useReducedMotion();
  return (
    <main id="content" className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-5 py-6 text-center">
      <AnimatePresence mode="wait">
        <motion.div
          key={card.title}
          initial={still ? false : { x: 30, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={still ? undefined : { x: -30, opacity: 0 }}
          className="flex flex-col items-center"
        >
          <Art id={card.art} alt="" eager className="h-56 w-auto" />
          <h1 className="mt-4 text-3xl">{card.title}</h1>
          <p className="mt-2 text-lg text-mute">{card.body}</p>
        </motion.div>
      </AnimatePresence>
      <p className="mt-5 text-sm text-mute" aria-live="polite">
        Step {index + 1} of {ONBOARDING.length}
      </p>
      <button
        className="btn btn-primary mt-3 w-full max-w-xs text-lg"
        data-testid="onboarding-next"
        onClick={() => (index + 1 < ONBOARDING.length ? setIndex(index + 1) : onDone())}
      >
        {index + 1 < ONBOARDING.length ? 'Next' : 'I’m ready'}
      </button>
    </main>
  );
}

/** Shows what the camera sees during framing, so people can line themselves up. Never recorded. */
function CameraPreview({ stream }: { stream: MediaStream | null }) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (video.current) video.current.srcObject = stream;
  }, [stream]);
  if (!stream) return null;
  return (
    <video
      ref={video}
      autoPlay
      muted
      playsInline
      aria-label="Your camera preview. It isn't recorded."
      className="h-44 w-auto max-w-[85vw] -scale-x-100 rounded-2xl border-4 border-paper object-cover shadow-lg"
    />
  );
}

const PAUSE_WORDS: Record<NonNullable<Progress['pause']>, string> = {
  talking: 'Paused while you’re talking',
  moving: 'Paused while you’re moving',
  framing: 'Paused for a moment',
  'no-face': 'Paused: I can’t see you',
  'no-signal': 'Paused for a moment',
};

function Measuring({
  token,
  kind,
  streak,
  demo,
  onResult,
  onCancel,
}: {
  token: string;
  kind: 'morning' | 'settle';
  streak: number;
  demo: boolean;
  onResult: (result: CheckinResult) => void;
  onCancel: () => void;
}) {
  const [params] = useSearchParams();
  const { state, stream, waves, liveMode, retry } = useCheckin({
    token,
    kind,
    mode: params.get('mode') ?? (demo ? 'replay' : null),
    session: params.get('session'),
    speed: params.get('speed'),
    frames: params.get('frames') === 'jpeg' ? 'jpeg' : undefined,
  });
  const handled = useRef(false);
  useEffect(() => {
    if (state.step === 'result' && !handled.current) {
      handled.current = true;
      onResult(state.result);
    }
  }, [state, onResult]);

  if (state.step === 'failed') {
    return (
      <Problem title="That one didn’t work">
        <p className="text-mute">{state.message}</p>
        <div className="flex flex-wrap justify-center gap-2">
          <button className="btn btn-primary" onClick={() => retry()}>
            Try again
          </button>
          <button className="btn" onClick={onCancel}>
            Back
          </button>
        </div>
      </Problem>
    );
  }

  const progress = state.step === 'measuring' ? state.progress : null;
  const framing = !progress || progress.phase === 'framing';
  const share = progress ? progress.seconds / progress.target : 0;
  const left = progress ? Math.ceil(progress.target - progress.seconds) : 0;
  const hint = progress?.hint;

  return (
    <SunriseCanvas share={share} waves={waves} sky={skyFor(streak)}>
      {liveMode && liveMode !== 'live' && (
        <div className="bg-indigo px-3 py-1 text-center text-xs font-bold tracking-wide text-paper">
          {demo ? 'DEMO DATA · ' : ''}
          {liveMode === 'replay' ? 'REPLAY: recorded signal, no camera in use' : 'SIMULATED signal, no camera in use'}
        </div>
      )}
      <main id="content" className="flex flex-1 flex-col items-center px-4 pt-5 text-center text-paper">
        {/* A dark plate keeps the words readable on every sky, from pre-dawn to full morning. */}
        <div className="rounded-2xl bg-ink/70 px-5 py-3">
          <h1 className="text-3xl" data-testid="checkin-title">
            {framing ? 'Let’s get you lined up' : 'Just breathe normally'}
          </h1>
          <p className="mt-1 min-h-6 text-lg" aria-live="polite" data-testid="checkin-status">
            {framing
              ? (hint?.text ?? 'Hold still. Starting in a moment.')
              : progress?.pause
                ? (hint?.text ?? PAUSE_WORDS[progress.pause])
                : `${left} seconds to go`}
          </p>
        </div>
        {framing && (
          <div className="mt-4">
            <CameraPreview stream={stream} />
          </div>
        )}
        {hint && (
          <Art id={POSE[hint.pose]} alt="" eager className="mt-3 h-28 w-auto drop-shadow-lg" />
        )}
      </main>
      <footer className="flex flex-col items-center gap-2 px-4 pb-6 text-paper">
        {progress && !framing && (
          <div
            role="progressbar"
            aria-label="Check-in progress"
            aria-valuemin={0}
            aria-valuemax={progress.target}
            aria-valuenow={Math.round(progress.seconds)}
            className="h-2 w-full max-w-xs overflow-hidden rounded-full bg-paper/25"
          >
            <div className="h-full bg-apricot" style={{ width: `${share * 100}%` }} />
          </div>
        )}
        <button className="rounded-lg px-4 py-3 text-sm underline" onClick={onCancel}>
          Stop and go back
        </button>
      </footer>
    </SunriseCanvas>
  );
}

function Answers({ token, onDone }: { token: string; onDone: () => void }) {
  const [sleep, setSleep] = useState(7.5);
  const [feel, setFeel] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <main id="content" className="mx-auto max-w-md px-4 py-6">
      <h1 className="text-center text-3xl">Two quick taps</h1>
      <div className="card mt-5 p-5">
        <label htmlFor="sleep" className="font-display text-xl font-bold">
          Hours slept: <span data-testid="sleep-value">{sleep}</span>
        </label>
        <input
          id="sleep"
          type="range"
          min={0}
          max={12}
          step={0.5}
          value={sleep}
          onChange={(e) => setSleep(Number(e.target.value))}
          className="mt-2"
        />
      </div>
      <fieldset className="card mt-4 p-5">
        <legend className="px-1 font-display text-xl font-bold">How do you feel?</legend>
        <div className="mt-2 grid grid-cols-5 gap-1">
          {FEELS.map((f) => (
            <button
              key={f.value}
              type="button"
              aria-pressed={feel === f.value}
              data-testid={`feel-${f.value}`}
              onClick={() => setFeel(f.value)}
              className={`flex min-h-20 flex-col items-center justify-end rounded-xl border-2 p-1 text-xs font-semibold ${feel === f.value ? 'border-indigo bg-apricot' : 'border-transparent hover:bg-paper-2'}`}
            >
              <Art id={f.art} alt="" eager className="h-12 w-auto" />
              {f.label}
            </button>
          ))}
        </div>
      </fieldset>
      {error && (
        <p role="alert" className="mt-2 text-center font-semibold text-coral-ink">
          {error}
        </p>
      )}
      <button
        className="btn btn-primary mt-5 w-full text-lg"
        disabled={feel === null || busy}
        data-testid="answers-done"
        onClick={() => {
          setBusy(true);
          api(`/api/a/${token}/answers`, { json: { sleep, feel } })
            .then(onDone)
            .catch((err: ApiError) => {
              setError(err.message);
              setBusy(false);
            });
        }}
      >
        Done
      </button>
    </main>
  );
}

function Inbox({ token, home, onRead }: { token: string; home: AthleteHome; onRead: () => void }) {
  if (!home.messages.length) return null;
  return (
    <section aria-labelledby="inbox" className="mt-5">
      <h2 id="inbox" className="text-xl">
        {home.messages.some((m) => !m.read) ? 'Your coach has a note for you' : 'From your coach'}
      </h2>
      <ul className="mt-2 space-y-2">
        {home.messages.slice(0, 4).map((m) => (
          <li key={m.id} className={`card p-4 ${m.read ? '' : 'bg-apricot/40'}`} data-testid="inbox-message">
            <p className="leading-relaxed">{m.body}</p>
            <div className="mt-2 flex items-center justify-between text-xs text-mute">
              <span>{m.date}</span>
              {!m.read && (
                <button className="btn min-h-9 px-3 py-1 text-xs" onClick={() => void api(`/api/a/${token}/messages/${m.id}/read`, { method: 'POST' }).then(onRead)}>
                  Got it
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function urlBase64ToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.padEnd(value.length + ((4 - (value.length % 4)) % 4), '=').replaceAll('-', '+').replaceAll('_', '/');
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function PushOptIn({ token }: { token: string }) {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [state, setState] = useState<'idle' | 'on' | 'off'>('idle');
  useEffect(() => {
    void api<AppConfig>('/api/config').then(setConfig);
  }, []);
  if (!config?.vapidPublicKey || !('PushManager' in window) || !('serviceWorker' in navigator)) return null;
  if (state === 'on') return <p className="text-sm text-teal-ink">You’ll get a notification when your coach writes.</p>;
  return (
    <button
      className="btn text-sm"
      onClick={() => {
        void (async () => {
          try {
            const permission = await Notification.requestPermission();
            if (permission !== 'granted') return setState('off');
            const reg = await navigator.serviceWorker.ready;
            const sub = await reg.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: urlBase64ToUint8Array(config.vapidPublicKey!),
            });
            await api(`/api/a/${token}/push`, { json: sub.toJSON() });
            return setState('on');
          } catch {
            return setState('off');
          }
        })();
      }}
    >
      {state === 'off' ? 'Notifications are off' : 'Notify me when my coach writes'}
    </button>
  );
}

function MyData({ token, onDeleted }: { token: string; onDeleted: () => void }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <details className="mt-8 text-sm">
      <summary className="cursor-pointer py-2 font-semibold text-indigo">My data and privacy</summary>
      <div className="mt-2 space-y-3 leading-relaxed text-mute">
        <p>Video is processed in memory and thrown away. Only your numbers and answers are kept.</p>
        <Disclaimer />
        <div className="flex flex-wrap gap-2">
          <a className="btn text-sm" href={`/api/a/${token}/export`} download>
            Download my data
          </a>
          {confirming ? (
            <button
              className="btn btn-coral text-sm"
              data-testid="delete-confirm"
              onClick={() => void api(`/api/a/${token}`, { method: 'DELETE' }).then(onDeleted)}
            >
              Yes, delete everything
            </button>
          ) : (
            <button className="btn text-sm" data-testid="delete-start" onClick={() => setConfirming(true)}>
              Delete everything
            </button>
          )}
        </div>
      </div>
    </details>
  );
}

function SmallSun() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden className="ml-0.5 inline-block align-[-3px]">
      <circle cx="12" cy="12" r="5" fill="#FF6B5B" />
      <g stroke="#2B2A6B" strokeWidth="2" strokeLinecap="round">
        {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
          <line key={a} x1="12" y1="2" x2="12" y2="4.5" transform={`rotate(${a} 12 12)`} />
        ))}
      </g>
    </svg>
  );
}

function Numbers({ home }: { home: AthleteHome }) {
  if (!home.numbers) return null;
  const items: [string, number | null, string][] = [
    ['Pulse', home.numbers.pulse, 'bpm'],
    ['Breathing', home.numbers.breath, '/min'],
    ['HRV', home.numbers.rmssd, 'RMSSD'],
    ['Stress index', home.numbers.stress, ''],
  ];
  return (
    <dl className="mt-4 grid grid-cols-2 gap-2">
      {items.map(([label, value, unit]) => (
        <div key={label} className="card p-3">
          <dt className="text-xs font-semibold text-mute">{label}</dt>
          <dd className="font-display text-xl font-bold">
            {value === null ? <span className="text-sm font-normal text-mute">Not read today</span> : `${Math.round(value)} ${unit}`}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Home({
  home,
  token,
  onStart,
  onSettle,
  refresh,
  onDeleted,
}: {
  home: AthleteHome;
  token: string;
  onStart: () => void;
  onSettle: () => void;
  refresh: () => void;
  onDeleted: () => void;
}) {
  const earned = BADGES.filter((b) => home.streak >= b).at(-1);
  return (
    <main id="content" className="mx-auto max-w-md px-4 py-6">
      <div className="flex items-center gap-3">
        <Avatar name={home.name} avatar={home.avatar} size={56} />
        <div>
          <h1 className="text-3xl">
            {greeting()}, {home.name}.
          </h1>
          <p className="text-sm text-mute" data-testid="streak">
            {home.streak === 0 ? 'Your streak starts today.' : `${home.streak} ${home.streak === 1 ? 'sunrise' : 'sunrises'} in a row`}
          </p>
        </div>
      </div>

      {home.checkedIn ? (
        <section className="riso-grain mt-5 overflow-hidden rounded-2xl border-2 border-indigo text-center" style={{ background: `linear-gradient(${skyFor(home.streak).join(',')})` }}>
          <Art id={home.streak >= 3 ? 'rollo_celebrate' : 'rollo_whistle'} alt="" eager className="mx-auto mt-3 h-36 w-auto" />
          <p className="mx-3 mb-4 inline-block rounded-lg bg-paper px-3 py-1 font-display text-2xl font-bold text-indigo" data-testid="checked-in">
            Checked in <SmallSun />
          </p>
        </section>
      ) : (
        <section className="card mt-5 p-5 text-center">
          <Art id="rollo_clipboard" alt="" eager className="float mx-auto h-36 w-auto" />
          <p className="mt-2 text-lg">Sit still for 75 seconds, tap twice, and you’re done.</p>
          <button className="btn btn-coral mt-4 w-full text-lg" onClick={onStart} data-testid="start-checkin">
            Start my check-in
          </button>
        </section>
      )}

      <Numbers home={home} />

      {home.plan && (
        <section className="card mt-4 flex items-center gap-3 p-4">
          <Art id={home.plan.intensity === 'rest' ? 'rollo_stretch' : home.plan.intensity === 'hard' ? 'rollo_sprint' : 'rollo_mug'} alt="" className="h-16 w-auto" />
          <div>
            <h2 className="text-sm font-semibold text-mute">Today’s session</h2>
            <p className="font-display text-lg font-bold" data-testid="plan-title">
              {home.plan.title}
            </p>
          </div>
        </section>
      )}

      <Inbox token={token} home={home} onRead={refresh} />

      {earned && (
        <section className="mt-4 flex items-center gap-3 rounded-2xl bg-paper-2 p-3">
          <div className="relative">
            <Art id={`badge_${earned}` as AssetId} alt="" className="h-20 w-auto" />
            <span className="absolute inset-0 flex items-center justify-center pt-1 font-display text-lg font-bold text-indigo">{earned}</span>
          </div>
          <p className="font-semibold">{earned} sunrises badge. Coach says go.</p>
        </section>
      )}

      {home.checkedIn && !home.settleDone && (
        <section className="mt-4 rounded-2xl border-2 border-dashed border-indigo/40 p-4">
          <h2 className="text-lg">Finished training?</h2>
          <p className="text-sm text-mute">Once you’re seated and calm, a 60-second reading shows how long each kind of session takes to settle.</p>
          <button className="btn mt-2 text-sm" onClick={onSettle} data-testid="start-settle">
            Do a settle check
          </button>
        </section>
      )}

      <div className="mt-5">
        <PushOptIn token={token} />
      </div>
      <MyData token={token} onDeleted={onDeleted} />
    </main>
  );
}

function SettleDetails({ token, result, onDone }: { token: string; result: CheckinResult; onDone: () => void }) {
  const choices = [5, 10, 20, 30];
  return (
    <main id="content" className="mx-auto max-w-md px-4 py-8 text-center">
      <Art id="rollo_mug" alt="" eager className="mx-auto h-36 w-auto" />
      <h1 className="mt-2 text-3xl">Nicely settled</h1>
      <p className="mt-1 text-mute">{result.pulse ? `Pulse read ${Math.round(result.pulse.value)} bpm.` : 'Pulse wasn’t read this time. That’s fine.'}</p>
      <h2 className="mt-5 text-xl">How long ago did you finish?</h2>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {choices.map((m) => (
          <button key={m} className="btn" data-testid={`settle-${m}`} onClick={() => void api(`/api/a/${token}/settle-details`, { json: { minutesAfter: m } }).then(onDone)}>
            {m} minutes
          </button>
        ))}
      </div>
    </main>
  );
}

export default function AthleteApp() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const [home, setHome] = useState<AthleteHome | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [deleted, setDeleted] = useState(false);
  const [view, setView] = useState<'home' | 'onboarding' | 'checkin' | 'answers' | 'settle' | 'settle-details'>('home');
  const [settleResult, setSettleResult] = useState<CheckinResult | null>(null);

  const load = useCallback(() => {
    api<AthleteHome>(`/api/a/${token}`)
      .then(setHome)
      .catch((err: ApiError) => setError(err));
  }, [token]);
  useEffect(load, [load]);

  if (deleted) {
    return (
      <main id="content" className="mx-auto max-w-md px-4 py-16 text-center">
        <Art id="rollo_asleep" alt="" className="mx-auto w-48" eager />
        <h1 className="mt-3 text-3xl">All gone</h1>
        <p className="mt-1 text-mute">Your data has been deleted and this link has stopped working.</p>
      </main>
    );
  }
  if (error) return <Problem title="This link isn’t working"><p className="text-mute">{error.message}</p></Problem>;
  if (!home) return <Spinner />;

  const banner = home.demo && (view === 'home' || view === 'answers') ? (
    <DemoBanner>
      <button className="underline" onClick={() => navigate('/coach')}>
        Back to the coach’s board
      </button>
    </DemoBanner>
  ) : null;

  if (!home.consented) return <Consent home={home} token={token} onDone={load} />;

  const seenOnboarding = (): boolean => {
    try {
      return localStorage.getItem('rc_onboarded') === '1';
    } catch {
      return false;
    }
  };

  const startCheckin = (): void => setView(home.demo || seenOnboarding() ? 'checkin' : 'onboarding');

  return (
    <Routes>
      <Route
        path="*"
        element={
          <>
            {banner}
            {view === 'onboarding' && (
              <Onboarding
                onDone={() => {
                  try {
                    localStorage.setItem('rc_onboarded', '1');
                  } catch {
                    /* Just shows the cards again next time. */
                  }
                  setView('checkin');
                }}
              />
            )}
            {view === 'checkin' && (
              <Measuring token={token} kind="morning" streak={home.streak} demo={home.demo} onCancel={() => setView('home')} onResult={() => setView('answers')} />
            )}
            {view === 'settle' && (
              <Measuring
                token={token}
                kind="settle"
                streak={home.streak}
                demo={home.demo}
                onCancel={() => setView('home')}
                onResult={(r) => {
                  setSettleResult(r);
                  setView('settle-details');
                }}
              />
            )}
            {view === 'settle-details' && settleResult && (
              <SettleDetails
                token={token}
                result={settleResult}
                onDone={() => {
                  load();
                  setView('home');
                }}
              />
            )}
            {view === 'answers' && (
              <Answers
                token={token}
                onDone={() => {
                  load();
                  setView('home');
                }}
              />
            )}
            {view === 'home' && (
              <Home home={home} token={token} onStart={startCheckin} onSettle={() => setView('settle')} refresh={load} onDeleted={() => setDeleted(true)} />
            )}
          </>
        }
      />
    </Routes>
  );
}
