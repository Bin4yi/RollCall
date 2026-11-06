import {
  EXERCISE_SESSION,
  exercisesForPlan,
  FORM_CUE,
  framingHint,
  HoldTimer,
  PoseSmoother,
  RepCounter,
  TRAIN,
  type ExerciseConfig,
  type PoseFrame,
  type Rep,
  type SetSummary,
} from '@rollcall/pose';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type AthleteHome } from '../api';
import { MODE_LABEL, PoseStage } from '../pose/PoseStage';
import { say, usePose, type PoseMode } from '../pose/usePose';
import { Art, type AssetId } from '../ui/kit';

const REST_SECONDS = 90;

interface DoneSet {
  exercise: ExerciseConfig;
  summary: SetSummary | null;
  holdSeconds?: number;
  sagShare?: number;
}

function SetScreen({
  exercise,
  mode,
  speed,
  fatigueDrop,
  onEnd,
}: {
  exercise: ExerciseConfig;
  mode: PoseMode;
  speed: number;
  fatigueDrop: number;
  onEnd: (done: DoneSet, reps: Rep[]) => void;
}) {
  const hold = exercise.kind === 'hold';
  const counter = useRef(hold ? null : new RepCounter(exercise, fatigueDrop));
  const timer = useRef(hold ? new HoldTimer(exercise) : null);
  const smoother = useRef(new PoseSmoother());
  const [count, setCount] = useState(0);
  const [cue, setCue] = useState('');
  const [drop, setDrop] = useState(0);
  const [stop, setStop] = useState(false);
  const [framed, setFramed] = useState(false);
  const [hint, setHint] = useState('');
  const still = useReducedMotion();
  const ended = useRef(false);

  const end = useCallback(() => {
    if (ended.current) return;
    ended.current = true;
    if (timer.current) {
      const s = timer.current.summary();
      onEnd({ exercise, summary: null, holdSeconds: s.holdSeconds, sagShare: s.sagShare }, []);
    } else if (counter.current) {
      onEnd({ exercise, summary: counter.current.summary() }, counter.current.reps);
    }
  }, [exercise, onEnd]);

  const onFrame = useCallback(
    (raw: PoseFrame) => {
      const frame = smoother.current.next(raw);
      const h = framingHint(frame, exercise.view, exercise.plural, exercise.lying);
      setFramed(h.ok);
      setHint(h.ok ? '' : h.text);
      if (timer.current) {
        timer.current.push(frame);
        const seconds = Math.floor(timer.current.seconds);
        setCount((was) => {
          if (seconds !== was && seconds > 0 && seconds % 10 === 0) say(`${seconds} seconds`);
          return seconds;
        });
        setCue(timer.current.sagging ? FORM_CUE['hips-sagging'] : '');
        return;
      }
      const rep = counter.current?.push(frame);
      if (!rep || !counter.current) return;
      setCount(rep.n);
      say(String(rep.n));
      setDrop(rep.drop);
      setCue(rep.flags[0] ? FORM_CUE[rep.flags[0]] : '');
      if (counter.current.stopSuggested && !stopRef.current) {
        stopRef.current = true;
        setStop(true);
        say('That’s the set. Good work.');
      }
    },
    [exercise],
  );
  const stopRef = useRef(false);
  const pose = usePose({ mode, session: EXERCISE_SESSION[exercise.id] ?? 'squats_good', speed, active: true, onFrame });
  useEffect(() => {
    if (pose.status === 'finished') end();
  }, [pose.status, end]);

  return (
    <div className="fixed inset-0 flex flex-col bg-indigo text-paper">
      <div className="px-3 py-1 text-center text-xs font-bold tracking-wide">{MODE_LABEL[mode]}</div>
      <PoseStage stream={pose.stream} latest={pose.latest} mode={mode} ok={framed} lying={exercise.lying}>
        <div className="absolute inset-x-0 top-0 z-10 flex flex-col items-center gap-2 p-3 text-center">
          <div className="rounded-2xl bg-ink/75 px-4 py-2">
            <h1 className="text-xl" data-testid="set-title">
              {exercise.name}
            </h1>
            <p className="min-h-6" aria-live="polite" data-testid="set-hint">
              {pose.status === 'failed' ? pose.message : pose.status === 'loading' ? 'Waking up the movement tracker…' : hint || cue || 'Go when you’re ready.'}
            </p>
          </div>
        </div>
        <div className="absolute inset-x-0 bottom-3 z-10 flex flex-col items-center gap-2 px-3">
          <AnimatePresence>
            {stop && (
              <motion.div initial={still ? false : { y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="flex items-center gap-2 rounded-2xl bg-paper px-3 py-2 text-indigo" data-testid="fatigue-stop">
                <Art id="rollo_rack" alt="" eager className="h-14 w-auto" />
                <div className="text-left">
                  <p className="font-display text-lg font-bold">That’s the set. Good work.</p>
                  <p className="text-xs text-mute">Your rep speed has dropped. It’s only a suggestion: carry on if you like.</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          <motion.output
            key={count}
            initial={still ? false : { scale: 1.3 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 400, damping: 15 }}
            className="rounded-3xl bg-ink/75 px-8 py-2 font-display text-7xl font-extrabold text-apricot"
            aria-live="off"
            data-testid="rep-count"
          >
            {hold ? `${count}s` : count}
          </motion.output>
          {!hold && count > 0 && (
            <div className="w-full max-w-xs rounded-full bg-ink/60 px-3 py-1 text-center text-xs" data-testid="rep-speed">
              Rep speed: {drop < 0.02 ? 'your fastest' : `${Math.round(drop * 100)}% below your fastest`}
            </div>
          )}
        </div>
      </PoseStage>
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <span className="text-xs">{mode === 'live' && pose.fps ? `${pose.fps} fps` : ''}</span>
        <button className="btn btn-coral" data-testid="end-set" onClick={end}>
          End set
        </button>
      </div>
    </div>
  );
}

const flagWords = (summary: SetSummary): string[] =>
  (Object.keys(summary.flagCounts) as (keyof typeof FORM_CUE)[]).map((f) => FORM_CUE[f]);

function SetSummaryCard({ done }: { done: DoneSet }) {
  if (!done.summary) {
    return (
      <p className="font-semibold" data-testid="set-summary">
        {done.exercise.name}: held {Math.round(done.holdSeconds ?? 0)} seconds.
      </p>
    );
  }
  const s = done.summary;
  return (
    <div data-testid="set-summary">
      <p className="font-semibold">
        {done.exercise.name}: {s.reps} {s.reps === 1 ? 'rep' : 'reps'}
        {s.partials > 0 ? `, plus ${s.partials} that didn’t reach full range` : ''}.
      </p>
      {s.reps >= 2 && <p className="text-sm text-mute">Rep speed fell {Math.round(s.speedDrop * 100)}% from your fastest.</p>}
      {flagWords(s).map((w) => (
        <p key={w} className="text-sm text-mute">
          {w}
        </p>
      ))}
    </div>
  );
}

export function TrainScreen({
  token,
  home,
  mode,
  speed,
  onSettle,
  onDone,
}: {
  token: string;
  home: AthleteHome;
  mode: PoseMode;
  speed: number;
  onSettle: () => void;
  onDone: () => void;
}) {
  const chosen = home.today.chosen;
  const swapped = chosen?.choice === 'upper';
  const intensity = chosen?.intensity ?? home.today.plan.intensity;
  const exercises = exercisesForPlan(home.today.plan.title, intensity === 'rest' ? 'moderate' : intensity, swapped);
  const [step, setStep] = useState<'pick' | 'set' | 'rest' | 'finished'>('pick');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [current, setCurrent] = useState<ExerciseConfig | null>(null);
  const [sets, setSets] = useState<DoneSet[]>([]);
  const [left, setLeft] = useState(REST_SECONDS);
  const [fatigue, setFatigue] = useState<number>(TRAIN.fatigueDrop);
  const [error, setError] = useState('');

  useEffect(() => {
    if (step !== 'rest') return undefined;
    setLeft(REST_SECONDS);
    const id = window.setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearInterval(id);
  }, [step]);

  const start = async (exercise: ExerciseConfig): Promise<void> => {
    setError('');
    let id = sessionId;
    if (!id) {
      try {
        id = (await api<{ id: string }>(`/api/a/${token}/train`, { json: { source: mode } })).id;
        setSessionId(id);
      } catch (err) {
        setError((err as Error).message);
        return;
      }
    }
    setCurrent(exercise);
    setStep('set');
  };

  const save = useCallback(
    (done: DoneSet, reps: Rep[]) => {
      setSets((all) => [...all, done]);
      setStep('rest');
      const s = done.summary;
      void api(`/api/a/${token}/train/${sessionIdRef.current}/sets`, {
        json: {
          exercise: done.exercise.id,
          reps: s?.reps ?? 0,
          partials: s?.partials ?? 0,
          fastest: s?.fastest ?? 0,
          slowest: s?.slowest ?? 0,
          speedDrop: s?.speedDrop ?? 0,
          avgDepth: s?.avgDepth ?? 0,
          flagCounts: s?.flagCounts ?? {},
          stopSuggestedAt: s?.stopSuggestedAt ?? null,
          holdSeconds: done.holdSeconds,
          sagShare: done.sagShare,
          durationMs: s?.durationMs ?? (done.holdSeconds ?? 0) * 1000,
          repList: reps.map((r) => ({ n: r.n, speed: r.speed, drop: r.drop, depth: r.depth, durationMs: r.durationMs, flags: r.flags })),
        },
      }).catch((err: Error) => setError(err.message));
    },
    [token],
  );
  const sessionIdRef = useRef<string | null>(null);
  sessionIdRef.current = sessionId;

  if (step === 'set' && current) {
    return <SetScreen key={sets.length} exercise={current} mode={mode} speed={speed} fatigueDrop={fatigue} onEnd={save} />;
  }

  if (step === 'finished') {
    return (
      <main id="content" className="mx-auto max-w-md px-4 py-6 text-center">
        <Art id="rollo_cheer" alt="" eager className="mx-auto h-40 w-auto" />
        <h1 className="mt-2 text-3xl" data-testid="session-finished">
          Session done
        </h1>
        <ul className="card mt-4 space-y-3 p-4 text-left">
          {sets.map((d, i) => (
            <li key={i}>
              <SetSummaryCard done={d} />
            </li>
          ))}
        </ul>
        <section className="mt-4 rounded-2xl border-2 border-dashed border-indigo/40 p-4">
          <h2 className="text-lg">Settle check in 3 to 5 minutes?</h2>
          <p className="text-sm text-mute">Sit down, get your breath back, then a 60-second reading shows how this kind of session settles.</p>
          <button className="btn mt-2 text-sm" data-testid="train-settle" onClick={onSettle}>
            I’m seated, do it now
          </button>
        </section>
        <button className="btn btn-primary mt-4 w-full" data-testid="train-home" onClick={onDone}>
          Back to today
        </button>
      </main>
    );
  }

  const artFor = (e: ExerciseConfig): AssetId => `ex_${e.id}_${e.view === 'front' ? 'front' : 'side'}` as AssetId;

  const picker = (
    <ul className="mt-3 space-y-2">
      {exercises.map((e) => (
        <li key={e.id}>
          <button className="card flex w-full items-center gap-3 p-3 text-left" data-testid={`exercise-${e.id}`} onClick={() => void start(e)}>
            <Art id={artFor(e)} alt="" className="h-16 w-16 shrink-0 rounded-xl bg-paper object-contain p-1" />
            <span className="min-w-0 flex-1">
              <span className="block font-display text-lg font-bold">{e.name}</span>
              <span className="flex items-center gap-1 text-xs text-mute">
                <Art id={e.view === 'front' ? 'camera_front' : 'camera_side'} alt="" className="h-7 w-auto" />
                {e.view === 'front' ? 'Face the camera' : 'Side-on to the camera'}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );

  if (step === 'rest') {
    const last = sets.at(-1)!;
    const target = last.summary && last.summary.reps > 0 ? `Aim for about ${last.summary.reps} again.` : 'Same again if it feels good.';
    return (
      <main id="content" className="mx-auto max-w-md px-4 py-6">
        <div className="flex items-center gap-3">
          <Art id="rollo_water" alt="" eager className="h-24 w-auto" />
          <div>
            <h1 className="text-3xl">Rest</h1>
            <p className="font-display text-4xl font-extrabold text-coral-ink" role="timer" data-testid="rest-timer">
              {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}
            </p>
          </div>
        </div>
        <div className="card mt-3 p-4">
          <SetSummaryCard done={last} />
        </div>
        {error && (
          <p role="alert" className="mt-2 font-semibold text-coral-ink">
            {error}
          </p>
        )}
        <h2 className="mt-4 text-xl">Next set</h2>
        <p className="text-sm text-mute">{target}</p>
        {picker}
        <button
          className="btn btn-primary mt-4 w-full"
          data-testid="finish-session"
          onClick={() => {
            void api(`/api/a/${token}/train/${sessionId}/finish`, { method: 'POST' })
              .then(() => setStep('finished'))
              .catch((err: Error) => setError(err.message));
          }}
        >
          Finish session
        </button>
      </main>
    );
  }

  return (
    <main id="content" className="mx-auto max-w-md px-4 py-6">
      <div className="flex items-center gap-3">
        <Art id="rollo_count" alt="" eager className="h-24 w-auto" />
        <div>
          <p className="text-sm font-semibold text-mute">Today’s session</p>
          <h1 className="text-2xl" data-testid="train-title">
            {swapped ? 'Easy upper body' : home.today.plan.title}
          </h1>
        </div>
      </div>
      {error && (
        <p role="alert" className="mt-2 font-semibold text-coral-ink">
          {error}
        </p>
      )}
      <h2 className="mt-4 text-xl">Pick an exercise</h2>
      <p className="text-sm text-mute">Prop your phone up where your whole body shows. I’ll count your reps out loud.</p>
      {picker}
      <div className="card mt-4 p-4">
        <label htmlFor="fatigue" className="font-semibold">
          Suggest ending a set when rep speed falls: {Math.round(fatigue * 100)}%
        </label>
        <input id="fatigue" type="range" min={0.1} max={0.4} step={0.05} value={fatigue} onChange={(e) => setFatigue(Number(e.target.value))} />
        <p className="text-xs text-mute">Rollo only suggests. You can always carry on.</p>
      </div>
      <button className="mt-3 rounded-lg px-4 py-3 text-sm underline" onClick={onDone}>
        Back
      </button>
    </main>
  );
}
