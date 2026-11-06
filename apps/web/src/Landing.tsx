import { motion, useReducedMotion } from 'motion/react';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from './api';
import { Art, Avatar, Disclaimer, Logo, LogoMark, RolloWave, type AssetId } from './ui/kit';
import { StatusSun, STATUS_LABEL, type Status } from './ui/StatusSun';

const FACTS = [
  ['75', 'still seconds to check in'],
  ['2', 'taps after the reading'],
  ['30', 'seconds to read your board'],
  ['0', 'wearables to buy or charge'],
];

const EXAMPLE_BOARD: { name: string; avatar: AssetId; status: Status; reason: string }[] = [
  { name: 'Mei', avatar: 'avatar_mei', status: 'check-in', reason: 'Pulse above usual · HRV below usual' },
  { name: 'Jonah', avatar: 'avatar_jonah', status: 'watch', reason: 'Breathing a little above usual' },
  { name: 'Hana', avatar: 'avatar_hana', status: 'ready', reason: 'Close to their usual' },
  { name: 'Amara', avatar: 'avatar_amara', status: 'ready', reason: 'Close to their usual' },
  { name: 'Tomasz', avatar: 'avatar_tomasz', status: 'waiting', reason: 'Not checked in yet today' },
];

const DAILY: { art: AssetId; when: string; title: string; tool: string; body: string }[] = [
  { art: 'onboard_still', when: 'Morning, seated', title: 'Heart', tool: 'SmartSpectra', body: 'Pulse, breathing and HRV in 75 still seconds.' },
  { art: 'jump_air', when: 'Morning, standing', title: 'Legs', tool: 'MediaPipe Pose', body: 'Three jumps timed by your phone, against your own usual.' },
  { art: 'rollo_count', when: 'During training', title: 'Train', tool: 'MediaPipe Pose', body: 'Rollo counts your reps, gives gentle form cues and spots when rep speed drops.' },
  { art: 'rollo_mug', when: 'After training', title: 'Settle', tool: 'SmartSpectra', body: 'A 60-second reading shows how each kind of session settles.' },
];

const CHAT: { who: string; avatar: AssetId; text: string }[] = [
  { who: 'Amara', avatar: 'avatar_amara', text: 'feeling 6/10 I guess' },
  { who: 'Jonah', avatar: 'avatar_jonah', text: 'legs ok?? slept badly' },
  { who: 'Hana', avatar: 'avatar_hana', text: 'all good coach 👍' },
];

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

const USUAL_EXAMPLE = [
  { label: 'Pulse', today: 84, word: 'Above usual' },
  { label: 'Breathing', today: 54, word: 'Close to usual' },
  { label: 'HRV', today: 16, word: 'Below usual' },
];

const SIGNALS = [
  ['Pulse', 'Resting pulse against their usual, read over a 12-second window.'],
  ['Breathing', 'Breathing rate over a 30-second window.'],
  ['HRV', 'RMSSD and the stress index over 60 seconds. That’s why a check-in takes 75.'],
  ['Stillness', 'Talking and moving pause the check-in politely, so readings stay honest.'],
];

const SPORTS = ['running', 'cycling', 'swimming', 'triathlon', 'lifting', 'rowing', 'football', 'climbing'];

const PRIVACY = [
  'Video is processed in memory and thrown away. Only the numbers are saved.',
  'The measuring SDK contacts Presage to check its key and usage, and to load its models.',
  'AI drafts see numbers and the coach’s choice. Never names, video or notes.',
  'Athletes can export or delete everything, any time.',
];

/** Slides in only, never fades, so nothing is hidden if the observer doesn't fire. */
function Reveal({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const still = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={still ? false : { y: 22 }}
      whileInView={{ y: 0 }}
      viewport={{ once: true, amount: 0.15 }}
      transition={{ type: 'spring', stiffness: 170, damping: 22, delay }}
    >
      {children}
    </motion.div>
  );
}

function ExampleBoard() {
  const still = useReducedMotion();
  return (
    <figure className="card relative w-full max-w-[540px] overflow-hidden shadow-riso">
      <div className="riso-grain bg-indigo px-5 py-4 text-paper">
        <p className="text-sm font-semibold text-apricot">This morning</p>
        <p className="mt-0.5 font-display text-2xl font-bold leading-tight">10 of 12 checked in, 2 to look at.</p>
      </div>
      <ul className="divide-y-2 divide-indigo/10">
        {EXAMPLE_BOARD.map((row, i) => (
          <motion.li
            key={row.name}
            className="flex items-center gap-3 px-4 py-2.5"
            initial={still ? false : { x: 18, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ delay: 0.35 + i * 0.09, type: 'spring', stiffness: 220, damping: 24 }}
          >
            <StatusSun status={row.status} size={38} />
            <Avatar name={row.name} avatar={row.avatar} size={42} />
            <div className="min-w-0">
              <p className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-display font-bold text-ink">{row.name}</span>
                <span className="text-xs font-semibold text-mute">{STATUS_LABEL[row.status]}</span>
              </p>
              <p className="text-sm leading-snug text-ink">{row.reason}</p>
            </div>
          </motion.li>
        ))}
      </ul>
      <figcaption className="border-t-2 border-indigo/10 bg-paper px-4 py-2 text-xs font-semibold text-mute">
        Example board. Fictional athletes.
      </figcaption>
    </figure>
  );
}

export function Landing() {
  const navigate = useNavigate();
  const still = useReducedMotion();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const startDemo = async (to = '/a/demo-amara?speed=4'): Promise<void> => {
    setBusy(true);
    setError('');
    try {
      await api('/api/demo/start', { method: 'POST' });
      navigate(to);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="min-h-dvh overflow-x-clip bg-paper">
      <main id="content">
        {/* Hero */}
        <section className="hero relative isolate overflow-hidden border-b-2 border-indigo">
          <Art
            id="hero"
            alt=""
            eager
            className="hero-art absolute left-0 -z-20 w-full max-w-none object-cover"
          />
          <div aria-hidden className="hero-scrim absolute inset-0 -z-10" />

          <div className="mx-auto max-w-[1400px] px-4 pt-4 sm:px-6 xl:px-10 xl:pt-5">
            <nav aria-label="Main" className="flex items-center justify-between gap-3 rounded-2xl border-2 border-indigo bg-paper/95 py-1.5 pl-3 pr-2 shadow-riso-sm">
              <Link to="/" aria-label="Roll Call home" className="block">
                <Logo className="w-28 sm:w-32" />
              </Link>
              <div className="flex items-center gap-1 sm:gap-2">
                <a href="#how" className="hidden rounded-lg px-3 py-2 font-semibold text-indigo no-underline hover:bg-paper-2 sm:block">
                  How it works
                </a>
                <a href="#privacy" className="hidden rounded-lg px-3 py-2 font-semibold text-indigo no-underline hover:bg-paper-2 sm:block">
                  Privacy
                </a>
                <Link to="/coach" className="btn">
                  Coach sign in
                </Link>
              </div>
            </nav>
          </div>

          <div className="mx-auto max-w-[1400px] px-4 pb-[305px] pt-7 sm:px-6 sm:pb-[290px] xl:px-10 xl:pb-0 xl:pt-7">
            <motion.div className="mx-auto flex max-w-4xl flex-col items-center text-center" initial={still ? false : { y: 16, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
              <p className="inline-flex items-center gap-2 rounded-full border-2 border-indigo bg-apricot px-3 py-1 text-sm font-bold text-ink">
                <LogoMark size={22} />
                No wearable, just your phone.
              </p>
              <h1 className="mt-3 max-w-[14em] text-[clamp(2.6rem,4.5vw,5rem)] font-extrabold leading-[1] tracking-tight text-balance text-indigo">
                Heart and legs, checked by sunrise.
              </h1>
              <p className="mt-3 max-w-[38em] text-lg font-medium leading-snug text-ink">
                A morning check against your own usual, a training partner that counts your reps, and <strong>the fitness competition where resting can win.</strong>
              </p>
              <div className="mt-4 flex flex-col items-center gap-1.5">
                <button className="btn btn-coral px-6 py-3 text-lg shadow-riso" onClick={() => void startDemo()} disabled={busy} data-testid="judge-mode">
                  {busy ? 'Setting up the demo…' : 'Follow Amara’s morning'}
                </button>
                <p className="text-sm font-semibold text-ink">Demo data. No camera, no account.</p>
              </div>
              {error && (
                <p role="alert" className="mt-2 font-semibold text-coral-ink">
                  {error}
                </p>
              )}
            </motion.div>

            <motion.div
              className="hero-board relative mx-auto mt-8 w-full max-w-[540px]"
              initial={still ? false : { y: 26, rotate: 0 }}
              animate={{ y: 0, rotate: still ? 0 : 1 }}
              transition={{ type: 'spring', stiffness: 120, damping: 18 }}
            >
              <ExampleBoard />
            </motion.div>
          </div>
        </section>

        {/* Facts */}
        <section aria-label="Roll Call in numbers" className="riso-grain overflow-hidden bg-indigo text-paper">
          <dl className="relative z-3 mx-auto grid max-w-[1400px] grid-cols-2 gap-x-4 gap-y-6 px-4 py-9 sm:px-6 lg:grid-cols-4 lg:px-10">
            {FACTS.map(([value, label]) => (
              <div key={label} className="flex flex-col-reverse gap-1 sm:flex-row-reverse sm:items-center sm:justify-end sm:gap-3">
                <dd className="max-w-[10em] text-sm font-semibold leading-snug sm:text-base">{label}</dd>
                <dt className="font-display text-6xl font-extrabold leading-none text-apricot">{value}</dt>
              </div>
            ))}
          </dl>
          <svg aria-hidden viewBox="0 0 1200 48" preserveAspectRatio="none" className="relative z-3 block h-10 w-full">
            <path
              className="pulse-line"
              pathLength="1"
              d="M0 30H170l14-14 14 14h34l10 12 18-38 16 26h130l14-14 14 14h34l10 12 18-38 16 26h130l14-14 14 14h34l10 12 18-38 16 26h130l14-14 14 14h34l10 12 18-38 16 26H1200"
              fill="none"
              stroke="#FF6B5B"
              strokeWidth="3"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        </section>

        {/* The whole day */}
        <section aria-labelledby="day" className="mx-auto max-w-6xl px-4 pt-16 sm:px-6 lg:pt-24">
          <h2 id="day" className="text-center text-4xl leading-tight text-indigo sm:text-5xl">
            One daily system, the right tool for each moment
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-center text-lg leading-relaxed">
            Camera vital signs need you still. Pose tracking needs you moving. So Roll Call uses each one where it works best.
          </p>
          <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {DAILY.map((d, i) => (
              <li key={d.title}>
                <Reveal className="card flex h-full flex-col p-5" delay={i * 0.05}>
                  <Art id={d.art} alt="" className="mx-auto h-32 w-auto" />
                  <p className="mt-3 text-xs font-bold tracking-wide text-coral-ink uppercase">{d.when}</p>
                  <h3 className="text-2xl text-indigo">{d.title}</h3>
                  <p className="mt-1 flex-1 text-sm leading-relaxed">{d.body}</p>
                  <p className="mt-3 text-xs font-semibold text-mute">{d.tool}</p>
                </Reveal>
              </li>
            ))}
          </ol>
        </section>

        {/* Crews */}
        <section aria-labelledby="crews" className="mt-16 border-y-2 border-indigo lg:mt-24">
          <div className="valley-reveal relative">
            <Art id="valley_unlit" alt="" className="block w-full" />
            <Art id="valley_lit" alt="" className="valley-lit absolute inset-0 w-full" />
          </div>
          <div className="mx-auto grid max-w-6xl items-center gap-8 px-4 py-12 sm:px-6 lg:grid-cols-[1.2fr_1fr] lg:gap-14">
            <Reveal>
              <h2 id="crews" className="text-4xl leading-tight text-indigo sm:text-5xl">
                The fitness competition where resting can win
              </h2>
              <p className="mt-3 text-lg leading-relaxed">
                Crews score smart decisions, never vitals or performance. Going hard on a good day earns points. So does easing off when your morning says to. Your crew’s points spread sunrise light across a shared valley, and nobody ever sees your numbers.
              </p>
              <ul className="mt-4 space-y-2 leading-relaxed">
                <li><strong>+3</strong> for listening to your body, the biggest score in the game</li>
                <li><strong>Consistency beats bursts:</strong> light fades only when a crew stops checking in</li>
                <li><strong>Rest days keep streaks alive,</strong> and your camp never shrinks</li>
              </ul>
            </Reveal>
            <Reveal delay={0.05}>
              <Art id="rollo_crew" alt="" className="mx-auto w-64" />
            </Reveal>
          </div>
        </section>

        {/* The problem */}
        <section aria-labelledby="problem" className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:gap-16 lg:py-24">
          <Reveal className="order-2 lg:order-1">
            <div className="relative mx-auto max-w-md rounded-[28px] bg-paper-2 p-6 pb-8">
              <ul className="space-y-3">
                {CHAT.map(({ who, avatar, text }, i) => (
                  <li key={who} className={`flex items-end gap-2 ${i === 1 ? 'pl-6' : ''}`}>
                    <Avatar name={who} avatar={avatar} size={38} />
                    <p className="card rounded-bl-sm px-4 py-2 font-medium">
                      <span className="block text-xs font-semibold text-mute">{who}</span>
                      {text}
                    </p>
                  </li>
                ))}
              </ul>
              <p className="mt-4 pr-16 text-sm font-semibold text-mute sm:pr-10">…and nine more before the first session.</p>
              <Art id="rollo_mug" alt="" className="absolute -bottom-6 -right-3 w-24 sm:-right-8 sm:w-28" />
            </div>
          </Reveal>
          <Reveal className="order-1 lg:order-2" delay={0.05}>
            <h2 id="problem" className="text-4xl leading-tight text-indigo sm:text-5xl">
              A phone full of “6/10” can’t plan a session.
            </h2>
            <p className="mt-4 text-lg leading-relaxed">
              A coach with twelve athletes spends the morning reading replies and guessing. Roll Call swaps that for one board, measured the same way each morning and compared with each athlete’s own usual.
            </p>
          </Reveal>
        </section>

        {/* How it works */}
        <section aria-labelledby="how" className="scroll-mt-4 border-y-2 border-indigo bg-paper-2 px-4 py-16 sm:px-6 lg:py-20" id="how-section">
          <div className="mx-auto max-w-6xl">
            <h2 id="how" className="scroll-mt-6 text-center text-4xl text-indigo sm:text-5xl">
              How it works
            </h2>
            <ol className="mt-10 grid gap-6 lg:grid-cols-3">
              {STEPS.map((s, i) => (
                <li key={s.title} className="h-full">
                  <Reveal className="card flex h-full flex-col items-center p-6 text-center shadow-riso" delay={i * 0.06}>
                    <span aria-hidden className="flex h-11 w-11 items-center justify-center rounded-full border-2 border-indigo bg-coral font-display text-xl font-extrabold text-ink">
                      {i + 1}
                    </span>
                    <Art id={s.art} alt="" className="mt-3 w-40 sm:w-60" />
                    <h3 className="mt-3 text-2xl text-indigo">{s.title}</h3>
                    <p className="mt-2 leading-relaxed text-mute">{s.body}</p>
                  </Reveal>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Own usual */}
        <section aria-labelledby="signals" className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[1fr_1.1fr] lg:gap-16 lg:py-24">
          <Reveal>
            <figure className="card relative mx-auto max-w-md p-6 pt-5 shadow-riso">
              <figcaption className="flex items-center gap-3">
                <Avatar name="Mei" avatar="avatar_mei" size={46} />
                <span>
                  <span className="block font-display text-xl font-bold text-indigo">Mei, today</span>
                  <span className="block text-xs font-semibold text-mute">Example with invented values</span>
                </span>
              </figcaption>
              <div className="mt-5 space-y-5 pb-10">
                {USUAL_EXAMPLE.map((m) => (
                  <div key={m.label}>
                    <p className="flex items-baseline justify-between text-sm">
                      <span className="font-bold">{m.label}</span>
                      <span className="font-semibold text-mute">{m.word}</span>
                    </p>
                    <div aria-hidden className="relative mt-1.5 h-4 rounded-full bg-paper-2">
                      <span className="absolute inset-y-0 left-[32%] w-[36%] rounded-full bg-teal/55" />
                      <span className="absolute top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-indigo bg-coral" style={{ left: `${m.today}%` }} />
                    </div>
                  </div>
                ))}
                <p className="text-xs font-semibold text-mute">
                  <span aria-hidden className="mr-1.5 inline-block h-2.5 w-6 rounded-full bg-teal/55 align-middle" />
                  Mei’s usual, from the last two weeks
                </p>
              </div>
              <Art id="rollo_clipboard" alt="" className="absolute -bottom-8 -right-3 w-24 sm:-right-10 sm:w-32" />
            </figure>
          </Reveal>
          <Reveal delay={0.05}>
            <h2 id="signals" className="text-4xl leading-tight text-indigo sm:text-5xl">
              Everyone against their own usual
            </h2>
            <p className="mt-4 text-lg leading-relaxed">
              There’s no scary single number and no league table. Roll Call spends the first five check-ins learning each athlete, then shows how far today is from a rolling two-week usual. Anything it couldn’t read well says “not read today”, never a guess.
            </p>
            <dl className="mt-6 grid gap-3 sm:grid-cols-2">
              {SIGNALS.map(([term, text]) => (
                <div key={term} className="rounded-2xl border-2 border-indigo/15 bg-paper-2 p-4">
                  <dt className="font-display text-lg font-bold text-indigo">{term}</dt>
                  <dd className="mt-0.5 text-sm leading-relaxed text-ink">{text}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-sm text-mute">Powered by the Presage SmartSpectra SDK.</p>
          </Reveal>
        </section>

        {/* Sports */}
        <section aria-labelledby="sports" className="border-y-2 border-indigo bg-teal/20 px-4 py-10 sm:px-6">
          <div className="mx-auto max-w-6xl">
            <h2 id="sports" className="text-center text-2xl text-indigo sm:text-3xl">
              The check-in is the same for every sport
            </h2>
            <ul className="mt-6 grid grid-cols-4 items-end gap-x-3 gap-y-5 lg:grid-cols-8">
              {SPORTS.map((sport) => (
                <li key={sport} className="flex flex-col items-center gap-2 text-center text-xs font-semibold capitalize text-ink sm:text-sm">
                  <Art id={`sport_${sport}` as AssetId} alt="" className="w-12 sm:w-16" />
                  {sport}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Privacy */}
        <section aria-labelledby="privacy" className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-24">
          <Reveal className="grid items-center gap-8 rounded-[28px] border-2 border-indigo bg-white p-6 shadow-riso sm:p-10 lg:grid-cols-[auto_1fr] lg:gap-12">
            <Art id="how_privacy" alt="" className="mx-auto w-40 lg:w-56" />
            <div>
              <h2 id="privacy" className="scroll-mt-6 text-4xl text-indigo">
                The camera only measures
              </h2>
              <ul className="mt-5 grid gap-x-8 gap-y-4 sm:grid-cols-2">
                {PRIVACY.map((line) => (
                  <li key={line} className="flex gap-3 leading-relaxed">
                    <svg aria-hidden viewBox="0 0 24 24" className="mt-0.5 h-6 w-6 shrink-0">
                      <circle cx="12" cy="12" r="10" fill="#3FB8AF" stroke="#2B2A6B" strokeWidth="2" />
                      <path d="m7.5 12.5 3 3 6-6.5" fill="none" stroke="#2B2A6B" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
        </section>

        {/* Closing call to action */}
        <section aria-labelledby="try" className="riso-grain border-t-2 border-indigo bg-gradient-to-t from-apricot to-paper px-4 pb-14 pt-10 text-center sm:px-6">
          <div className="relative z-3 mx-auto max-w-2xl">
            <RolloWave size={140} />
            <h2 id="try" className="mt-2 text-4xl leading-tight text-indigo sm:text-5xl">
              See a whole morning in two minutes.
            </h2>
            <p className="mt-3 text-lg font-medium text-ink">Twelve fictional athletes and four crews, clearly labelled. Heart, legs, a smart call, and a contested tile.</p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <button className="btn btn-primary px-6 py-3 text-lg shadow-riso" onClick={() => void startDemo()} disabled={busy}>
                {busy ? 'Setting up the demo…' : 'Follow Amara’s morning'}
              </button>
              <button className="btn px-6 py-3 text-lg" onClick={() => void startDemo('/coach')} disabled={busy} data-testid="judge-coach">
                See the coach’s board
              </button>
              <Link to="/coach" className="btn px-6 py-3 text-lg">
                Coach sign in
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="bg-indigo px-4 py-7 text-center sm:px-6">
        <Disclaimer className="mx-auto max-w-3xl !text-paper" />
      </footer>
    </div>
  );
}
