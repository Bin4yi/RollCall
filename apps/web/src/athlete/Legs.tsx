import {
  BALANCE,
  BalanceTest,
  framingHint,
  JUMP,
  JUMP_PROBLEM_TEXT,
  LegsCheck,
  PoseSmoother,
  swapSides,
  type BalanceResult,
  type JumpResult,
  type PoseFrame,
} from '@rollcall/pose';
import { motion, useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../api';
import { Confetti, MODE_LABEL, PoseStage } from '../pose/PoseStage';
import { say, usePose, type PoseMode } from '../pose/usePose';
import { Art } from '../ui/kit';

type Step = 'offer' | 'jumps' | 'balance' | 'result';

function Stage({ title, status, children }: { title: string; status: string; children?: React.ReactNode }) {
  return (
    <div className="absolute inset-x-0 top-0 z-10 flex flex-col items-center p-3 text-center text-paper">
      <div className="rounded-2xl bg-ink/75 px-5 py-3">
        <h1 className="text-2xl" data-testid="pose-title">
          {title}
        </h1>
        <p className="min-h-6 text-lg" aria-live="polite" data-testid="pose-status">
          {status}
        </p>
        {children}
      </div>
    </div>
  );
}

function JumpFlow({ mode, session, speed, onDone, onBack }: { mode: PoseMode; session: string; speed: number; onDone: (jumps: JumpResult[]) => void; onBack: () => void }) {
  const check = useRef(new LegsCheck());
  const smoother = useRef(new PoseSmoother());
  const [valid, setValid] = useState(0);
  const [note, setNote] = useState('');
  const [phase, setPhase] = useState('standing');
  const [framed, setFramed] = useState(false);
  const finished = useRef(false);

  const finish = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    onDone(check.current.jumps);
  }, [onDone]);

  const onFrame = useCallback(
    (raw: PoseFrame) => {
      const frame = smoother.current.next(raw);
      setFramed(framingHint(frame, 'front').ok);
      const jump = check.current.push(frame);
      setPhase(check.current.phase);
      if (jump) {
        setValid(check.current.valid.length);
        if (jump.valid) {
          setNote('');
          say(check.current.valid.length >= JUMP.targetJumps ? 'That’s three. Lovely.' : `${check.current.valid.length}. Rest, then go again.`);
        } else {
          const text = JUMP_PROBLEM_TEXT[jump.problem ?? 'too-few-frames'];
          setNote(text);
          say(text);
        }
      }
      if (check.current.done) finish();
    },
    [finish],
  );

  const pose = usePose({ mode, session, speed, active: true, onFrame });
  useEffect(() => {
    // A recording that ends early still shows what it found.
    if (pose.status === 'finished') finish();
  }, [pose.status, finish]);

  const status =
    pose.status === 'failed'
      ? pose.message
      : pose.status === 'loading'
        ? 'Waking up the movement tracker…'
        : note || (phase === 'standing' ? (framed ? 'Hands on hips. Stand still for a moment.' : framingHint(pose.latest.current, 'front').text) : 'Quick dip, jump as high as you can, land with straight legs.');

  return (
    <div className="fixed inset-0 flex flex-col bg-indigo">
      <div className="bg-indigo px-3 py-1 text-center text-xs font-bold tracking-wide text-paper">{MODE_LABEL[mode]}</div>
      <PoseStage stream={pose.stream} latest={pose.latest} mode={mode} ok={framed}>
        <Stage title={`Jump ${Math.min(valid + 1, JUMP.targetJumps)} of ${JUMP.targetJumps}`} status={status} />
        <div className="absolute inset-x-0 bottom-3 z-10 flex justify-center gap-2" aria-hidden>
          {Array.from({ length: JUMP.targetJumps }, (_, i) => (
            <span key={i} className={`h-4 w-4 rounded-full border-2 border-paper ${i < valid ? 'bg-apricot' : 'bg-transparent'}`} />
          ))}
        </div>
      </PoseStage>
      <div className="flex items-center justify-between gap-2 bg-indigo px-4 py-3 text-paper">
        <span className="text-xs" data-testid="pose-fps">
          {mode === 'live' && pose.fps ? `${pose.fps} fps` : ''}
        </span>
        <button className="rounded-lg px-4 py-2 text-sm underline" onClick={onBack}>
          {pose.status === 'failed' ? 'Back' : 'Stop and go back'}
        </button>
      </div>
    </div>
  );
}

function BalanceLeg({ side, mode, speed, onDone, onBack }: { side: 'left' | 'right'; mode: PoseMode; speed: number; onDone: (r: BalanceResult) => void; onBack: () => void }) {
  const test = useRef(new BalanceTest(side));
  const [seconds, setSeconds] = useState(0);
  const finished = useRef(false);
  const onFrame = useCallback(
    (frame: PoseFrame) => {
      if (finished.current) return;
      // One recording covers both legs in replay. A live person really does swap legs.
      test.current.push(mode !== 'live' && side === 'right' ? swapSides(frame) : frame);
      setSeconds(test.current.seconds);
      if (test.current.done) {
        finished.current = true;
        onDone(test.current.result());
      }
    },
    [mode, onDone, side],
  );
  const pose = usePose({ mode, session: 'balance_steady', speed, active: true, onFrame });
  return (
    <div className="fixed inset-0 flex flex-col bg-indigo">
      <div className="bg-indigo px-3 py-1 text-center text-xs font-bold tracking-wide text-paper">{MODE_LABEL[mode]}</div>
      <PoseStage stream={pose.stream} latest={pose.latest} mode={mode} ok={test.current.started}>
        <Stage
          title={`Stand on your ${side} leg`}
          status={pose.status === 'failed' ? pose.message : test.current.started ? `${Math.max(0, Math.ceil(BALANCE.seconds - seconds))} seconds to go` : 'Lift the other foot when you’re ready.'}
        />
      </PoseStage>
      <div className="flex justify-end bg-indigo px-4 py-3 text-paper">
        <button className="rounded-lg px-4 py-2 text-sm underline" onClick={onBack}>
          Stop and go back
        </button>
      </div>
    </div>
  );
}

function BalanceFlow({ mode, speed, onDone, onBack }: { mode: PoseMode; speed: number; onDone: (r: BalanceResult[]) => void; onBack: () => void }) {
  const [first, setFirst] = useState<BalanceResult | null>(null);
  if (!first) {
    return (
      <BalanceLeg
        key="left"
        side="left"
        mode={mode}
        speed={speed}
        onBack={onBack}
        onDone={(r) => {
          say('Other leg.');
          setFirst(r);
        }}
      />
    );
  }
  return <BalanceLeg key="right" side="right" mode={mode} speed={speed} onBack={onBack} onDone={(r) => onDone([first, r])} />;
}

/** Straight after the heart check-in, because jumping raises the pulse. */
export function LegsScreen({ token, mode, speed, poseSession, onDone, onBack }: { token: string; mode: PoseMode; speed: number; poseSession: string | null; onDone: () => void; onBack: () => void }) {
  const [step, setStep] = useState<Step>('offer');
  const [line, setLine] = useState('');
  const [problemCount, setProblemCount] = useState(0);
  const [error, setError] = useState('');
  const still = useReducedMotion();
  const session = useMemo(() => poseSession ?? 'jumps_tired', [poseSession]);

  const finishWith = (path: string, json?: unknown): void => {
    setError('');
    api<{ today: { legs: { kind: string; pct: number | null; have: number; need: number } } }>(`/api/a/${token}${path}`, json === undefined ? { method: 'POST' } : { json })
      .then(({ today }) => {
        const l = today.legs;
        if (path.endsWith('skip')) return onDone();
        if (path.endsWith('balance')) {
          setLine('Balance test saved. It keeps its own trend.');
        } else if (l.kind === 'learning') {
          setLine(`Learning your usual: ${l.have} of ${l.need}.`);
        } else if (l.kind === 'none') {
          setLine('None of those jumps could count today. That’s fine, try again tomorrow.');
        } else if (l.kind === 'usual') {
          setLine('Legs: close to your usual.');
        } else if (l.kind === 'up') {
          setLine(`Legs: ${l.pct}% above your usual.`);
        } else {
          setLine(`Legs: ${Math.abs(l.pct ?? 0)}% below your usual.`);
        }
        setStep('result');
        return undefined;
      })
      .catch((err: ApiError) => setError(err.message));
  };

  if (step === 'jumps') {
    return (
      <JumpFlow
        mode={mode}
        session={session}
        speed={speed}
        onBack={() => setStep('offer')}
        onDone={(jumps) => {
          if (!jumps.length) {
            setError('I didn’t see any jumps that time. Stand where your whole body shows and try again.');
            setStep('offer');
            return;
          }
          setProblemCount(jumps.filter((j) => !j.valid).length);
          // The server works height out again from flight time, and ignores this copy.
          finishWith('/legs', { jumps, source: mode });
        }}
      />
    );
  }
  if (step === 'balance') {
    return <BalanceFlow mode={mode} speed={speed} onBack={() => setStep('offer')} onDone={(results) => finishWith('/balance', { results, source: mode })} />;
  }
  if (step === 'result') {
    return (
      <main id="content" className="relative mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center overflow-hidden px-5 py-8 text-center">
        <Confetti />
        <motion.div initial={still ? false : { y: 30, scale: 0.8 }} animate={{ y: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 220, damping: 14 }}>
          <Art id="jump_air" alt="" eager className="mx-auto h-44 w-auto" />
        </motion.div>
        <h1 className="mt-3 text-3xl" data-testid="legs-result">
          {line}
        </h1>
        <p className="mt-2 text-sm text-mute">A camera estimate, compared only with your own usual. Typical error is about ±5%, so small changes don’t mean much.</p>
        {problemCount > 0 && <p className="mt-1 text-sm text-mute">{problemCount} jump{problemCount === 1 ? '' : 's'} didn’t count.</p>}
        <button className="btn btn-primary mt-5 w-full max-w-xs text-lg" data-testid="legs-continue" onClick={onDone}>
          See today’s call
        </button>
      </main>
    );
  }
  return (
    <main id="content" className="mx-auto max-w-md px-4 py-6 text-center">
      <h1 className="text-3xl">Want to check your legs too?</h1>
      <p className="mt-1 text-lg text-mute">20 seconds. Three jumps.</p>
      <div className="mt-3 grid grid-cols-3 items-end gap-1">
        <Art id="jump_dip" alt="Dip" eager className="w-full" />
        <Art id="jump_air" alt="Jump" eager className="w-full" />
        <Art id="jump_land" alt="Land with straight legs" eager className="w-full" />
      </div>
      <ol className="card mt-4 space-y-2 p-4 text-left text-sm leading-relaxed">
        <li className="flex items-center gap-3">
          <Art id="camera_front" alt="" className="w-14 shrink-0" />
          Prop your phone up and step back about 2.5 m, so your whole body shows.
        </li>
        <li className="flex items-center gap-3">
          <Art id="floor_marker" alt="" className="w-14 shrink-0" />
          Hands on hips. Quick dip, jump as high as you can, land with straight legs. Rest about 5 seconds between jumps.
        </li>
      </ol>
      {mode === 'live' && <p className="mt-2 text-xs text-mute">The movement tracker runs on this phone. Its frames never leave it: only the jump numbers are saved.</p>}
      {error && (
        <p role="alert" className="mt-2 font-semibold text-coral-ink">
          {error}
        </p>
      )}
      <button className="btn btn-coral mt-4 w-full text-lg" data-testid="legs-start" onClick={() => setStep('jumps')}>
        Check my legs
      </button>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button className="card flex flex-col items-center p-3 text-sm font-semibold" data-testid="legs-balance" onClick={() => setStep('balance')}>
          <Art id="balance_pose" alt="" className="h-20 w-auto" />
          Low impact: balance test instead
        </button>
        <button className="card flex flex-col items-center p-3 text-sm font-semibold" data-testid="legs-skip" onClick={() => finishWith('/legs/skip')}>
          <Art id="card_skip" alt="" className="h-20 w-auto" />
          Skip today: sore or injured
        </button>
      </div>
      <button className="mt-3 rounded-lg px-4 py-3 text-sm underline" onClick={onBack}>
        Back
      </button>
    </main>
  );
}
