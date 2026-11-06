import { motion, useReducedMotion } from 'motion/react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from './api';
import { Art, Disclaimer, Logo, type AssetId } from './ui/kit';

const STEPS: { art: AssetId; title: string; body: string }[] = [
  {
    art: 'how_athlete',
    title: 'Athletes check in',
    body: 'A private link, a phone propped up, 75 still seconds and two taps. Nothing to wear or charge.',
  },
  {
    art: 'how_coach',
    title: 'You see the board',
    body: 'Everyone sorted by how far they are from their own usual, with plain reasons, before you’ve finished your coffee.',
  },
  {
    art: 'how_send',
    title: 'You decide and send',
    body: 'Keep the plan or swap it. AI drafts a note from the numbers only, you edit it, and nothing goes without you pressing Send.',
  },
];

const SIGNALS = [
  ['Pulse', 'Resting pulse against their usual, read over a 12-second window.'],
  ['Breathing', 'Breathing rate over a 30-second window.'],
  ['HRV', 'RMSSD and the stress index over 60 seconds. That’s why a check-in takes 75.'],
  ['Stillness', 'Talking and moving pause the check-in politely, so readings stay honest.'],
];

export function Landing() {
  const navigate = useNavigate();
  const still = useReducedMotion();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const startDemo = async (): Promise<void> => {
    setBusy(true);
    setError('');
    try {
      await api('/api/demo/start', { method: 'POST' });
      navigate('/coach');
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="min-h-dvh bg-paper">
      <header className="relative overflow-hidden border-b-2 border-indigo">
        <Art id="hero" alt="" eager className="block h-[62dvh] min-h-[420px] w-full object-cover object-[12%_bottom] sm:h-[72dvh] sm:object-bottom" />
        <div className="absolute inset-x-0 top-0 z-3 flex flex-col items-center px-4 pt-4 text-center sm:pt-8">
          <motion.div initial={still ? false : { y: -12, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
            <div className="rounded-2xl bg-paper/90 px-4 py-2">
              <Logo className="w-[min(70vw,400px)]" />
            </div>
          </motion.div>
          <h1 className="mt-2 rounded-xl bg-paper/90 px-3 py-1 text-2xl text-indigo sm:text-4xl">
            Every athlete, checked in by sunrise.
          </h1>
          <p className="mt-2 rounded-lg bg-paper/90 px-3 py-1 font-semibold text-indigo">No wearables.</p>
        </div>
      </header>

      <main id="content" className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <section className="mx-auto max-w-2xl text-center">
          <p className="text-lg leading-relaxed">
            A coach with twelve athletes has a phone full of “feeling 6/10 I guess”. Roll Call gives you a 30-second answer to <strong>who should train hard today?</strong> using only each athlete’s phone camera.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <button className="btn btn-coral text-lg" onClick={() => void startDemo()} disabled={busy} data-testid="judge-mode">
              {busy ? 'Setting up the demo…' : 'Try it now with demo data'}
            </button>
            <Link to="/coach" className="btn">
              Coach sign in
            </Link>
          </div>
          <p className="mt-2 text-sm text-mute">No camera, no account. Fictional athletes, clearly labelled.</p>
          {error && (
            <p role="alert" className="mt-2 font-semibold text-coral-ink">
              {error}
            </p>
          )}
        </section>

        <section aria-labelledby="how" className="mt-14">
          <h2 id="how" className="text-center text-3xl">
            How it works
          </h2>
          <ol className="mt-6 grid gap-6 sm:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title} className="card flex flex-col items-center p-5 text-center">
                <Art id={s.art} alt="" className="h-40 w-auto" />
                <h3 className="mt-3 text-xl">
                  {i + 1}. {s.title}
                </h3>
                <p className="mt-1 text-sm leading-relaxed text-mute">{s.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="signals" className="mt-14 grid items-center gap-8 sm:grid-cols-[1fr_1.4fr]">
          <Art id="rollo_clipboard" alt="" className="mx-auto w-52" />
          <div>
            <h2 id="signals" className="text-3xl">
              Everyone against their own usual
            </h2>
            <p className="mt-2 leading-relaxed text-mute">
              There’s no scary single number and no league table. Roll Call spends the first five check-ins learning each athlete, then shows how far today is from a rolling two-week usual. Anything it couldn’t read well says “not read today”, never a guess.
            </p>
            <dl className="mt-4 grid gap-3 sm:grid-cols-2">
              {SIGNALS.map(([term, text]) => (
                <div key={term} className="rounded-xl bg-paper-2 p-3">
                  <dt className="font-display font-bold text-indigo">{term}</dt>
                  <dd className="text-sm text-ink">{text}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-sm text-mute">Powered by the Presage SmartSpectra SDK.</p>
          </div>
        </section>

        <section aria-labelledby="privacy" className="card mt-14 grid items-center gap-6 p-6 sm:grid-cols-[auto_1fr]">
          <Art id="how_privacy" alt="" className="mx-auto w-32" />
          <div>
            <h2 id="privacy" className="text-2xl">
              The camera only measures
            </h2>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed">
              <li>Video is processed in memory and thrown away. Only the numbers are saved.</li>
              <li>The measuring SDK contacts Presage to check its key and usage, and to load its models.</li>
              <li>AI drafts see numbers and the coach’s choice. Never names, video or notes.</li>
              <li>Athletes can export or delete everything, any time.</li>
            </ul>
          </div>
        </section>

        <footer className="mt-10 border-t-2 border-indigo/20 pt-5 text-center">
          <Disclaimer />
        </footer>
      </main>
    </div>
  );
}
