import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError, type Board, type BoardRow } from '../api';
import { Art, Avatar, Problem, Spinner, type AssetId } from '../ui/kit';
import { StatusSun, STATUS_LABEL, type Status } from '../ui/StatusSun';
import type { CoachSession } from './CoachApp';

const SPORT_ART = new Set(['running', 'cycling', 'swimming', 'triathlon', 'lifting', 'rowing', 'football', 'climbing']);

function reasonLine(row: BoardRow): string {
  if (row.learning) return `Learning their usual: ${row.learning.have} of ${row.learning.need} check-ins`;
  if (row.status === 'waiting') {
    if (row.daysAway === null) return 'No check-ins yet';
    return row.daysAway <= 1 ? 'Not checked in yet today' : `Last check-in ${row.daysAway} days ago`;
  }
  if (row.status === 'ready') return 'Close to their usual';
  return row.reasons.join(' · ') || 'A little off their usual';
}

function BoardRowItem({ row, focused, onFocus }: { row: BoardRow; focused: boolean; onFocus: () => void }) {
  const ref = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (focused) ref.current?.focus();
  }, [focused]);
  return (
    <li data-testid={`row-${row.name}`}>
      <Link
        ref={ref}
        to={`/coach/a/${row.id}`}
        onFocus={onFocus}
        className="card flex items-center gap-3 p-3 text-ink no-underline transition-transform hover:-translate-y-px sm:gap-4 sm:p-4"
      >
        <StatusSun status={row.status} />
        <Avatar name={row.name} avatar={row.avatar} size={52} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-display text-lg font-bold">{row.name}</span>
            <span className="text-xs font-semibold text-mute" data-testid="status-label">
              {STATUS_LABEL[row.status]}
            </span>
            {row.decided && <span className="rounded bg-teal/20 px-1.5 text-xs font-semibold text-teal-ink">Message sent</span>}
          </div>
          <p className="text-sm text-ink" data-testid="reasons">
            {reasonLine(row)}
          </p>
          {row.gentleNudge && (
            <p className="mt-0.5 text-sm font-semibold text-coral-ink">Maybe check in personally.</p>
          )}
          {row.plan && (
            <p className="truncate text-xs text-mute" data-testid="plan">
              Today: {row.plan.title}
              {row.plan.changed ? ' (changed)' : ''}
            </p>
          )}
        </div>
        {SPORT_ART.has(row.sport) && (
          <Art id={`sport_${row.sport}` as AssetId} alt={row.sport} className="hidden w-11 shrink-0 sm:block" />
        )}
      </Link>
    </li>
  );
}

const FILTERS: { key: 'all' | Status; label: string }[] = [
  { key: 'all', label: 'Everyone' },
  { key: 'check-in', label: 'Check in' },
  { key: 'watch', label: 'Watch' },
  { key: 'ready', label: 'Ready' },
  { key: 'waiting', label: 'Not in yet' },
  { key: 'learning', label: 'Learning' },
];

function AddAthlete({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [sport, setSport] = useState('running');
  const [link, setLink] = useState('');
  const [error, setError] = useState('');
  if (!open) {
    return (
      <button className="btn" data-testid="add-athlete" onClick={() => setOpen(true)}>
        Add an athlete
      </button>
    );
  }
  if (link) {
    const full = `${location.origin}${link}`;
    return (
      <div className="card w-full p-4" role="status">
        <p className="font-semibold">Send this private link to {name}:</p>
        <p className="mt-1 break-all rounded-lg bg-paper-2 p-2 text-sm" data-testid="new-link">
          {full}
        </p>
        <div className="mt-2 flex gap-2">
          <button className="btn text-sm" onClick={() => void navigator.clipboard?.writeText(full)}>
            Copy link
          </button>
          <button
            className="btn text-sm"
            onClick={() => {
              setOpen(false);
              setLink('');
              setName('');
            }}
          >
            Done
          </button>
        </div>
      </div>
    );
  }
  return (
    <form
      className="card flex w-full flex-wrap items-end gap-3 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        api<{ link: string }>('/api/coach/athletes', { json: { name, sport } })
          .then((r) => {
            setLink(r.link);
            onAdded();
          })
          .catch((err: ApiError) => setError(err.message));
      }}
    >
      <div className="min-w-40 flex-1">
        <label htmlFor="new-name" className="text-sm font-semibold">
          Name
        </label>
        <input id="new-name" required value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="min-w-32">
        <label htmlFor="new-sport" className="text-sm font-semibold">
          Sport
        </label>
        <select id="new-sport" value={sport} onChange={(e) => setSport(e.target.value)}>
          {[...SPORT_ART].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </div>
      <button className="btn btn-primary">Create link</button>
      {error && (
        <p role="alert" className="w-full text-sm font-semibold text-coral-ink">
          {error}
        </p>
      )}
    </form>
  );
}

export function BoardPage({ session }: { session: CoachSession }) {
  const navigate = useNavigate();
  const still = useReducedMotion();
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'all' | Status>('all');
  const [squad, setSquad] = useState('all');
  const [sport, setSport] = useState('all');
  const [focus, setFocus] = useState(-1);
  const [bulk, setBulk] = useState<'idle' | 'confirm' | 'busy' | number>('idle');

  const load = useCallback(() => {
    api<Board>('/api/coach/board')
      .then(setBoard)
      .catch((err: ApiError) => setError(err.message));
  }, []);
  useEffect(() => {
    load();
    // Check-ins arrive through the morning, so the board keeps itself current.
    const timer = window.setInterval(load, 15_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const rows = useMemo(
    () =>
      (board?.rows ?? []).filter(
        (r) =>
          (filter === 'all' || r.status === filter) &&
          (squad === 'all' || r.squad === squad) &&
          (sport === 'all' || r.sport === sport),
      ),
    [board, filter, squad, sport],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, select') || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'j') {
        e.preventDefault();
        setFocus((f) => Math.min(rows.length - 1, f + 1));
      } else if (e.key === 'k') {
        e.preventDefault();
        setFocus((f) => Math.max(0, f - 1));
      } else if (e.key === 'Enter' && focus >= 0 && !target.closest('a, button')) {
        const row = rows[focus];
        if (row) navigate(`/coach/a/${row.id}`);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rows, focus, navigate]);

  if (error) return <Problem title="The board didn’t load"><p className="text-mute">{error}</p></Problem>;
  if (!board) return <Spinner label="Calling the roll" />;

  const squads = [...new Set(board.rows.map((r) => r.squad).filter(Boolean))].sort();
  const sports = [...new Set(board.rows.map((r) => r.sport))].sort();
  const readyUnsent = board.rows.filter((r) => r.status === 'ready' && !r.decided).length;
  const empty = board.rows.length === 0;
  const allIn = !empty && board.counts.checkedIn === board.counts.total && board.counts.toLook === 0;

  return (
    <main id="content" className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <section className="riso-grain relative overflow-hidden rounded-2xl border-2 border-indigo bg-gradient-to-b from-indigo via-coral to-apricot p-5 text-paper">
        <p className="text-sm font-semibold">{new Date(`${board.date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</p>
        <h1 className="mt-1 text-2xl sm:text-3xl" data-testid="board-summary">
          {board.summary}
        </h1>
        <div aria-hidden className="mt-3 flex gap-1.5">
          {board.rows.map((r) => (
            <span key={r.id} className={`h-3 w-3 rounded-full border-2 border-paper ${r.checkedIn ? 'bg-paper' : 'bg-transparent'}`} />
          ))}
        </div>
      </section>

      {empty ? (
        <section className="mt-8 flex flex-col items-center text-center">
          <Art id="empty_athletes" alt="" className="w-48" />
          <h2 className="mt-3 text-2xl">No athletes yet</h2>
          <p className="text-mute">Add your first and send them their private link.</p>
        </section>
      ) : (
        <>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-1">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  aria-pressed={filter === f.key}
                  data-testid={`filter-${f.key}`}
                  onClick={() => setFilter(f.key)}
                  className={`min-h-9 rounded-full border-2 px-3 py-1 text-sm font-semibold ${filter === f.key ? 'border-indigo bg-indigo text-paper' : 'border-indigo/30 bg-white text-indigo'}`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-1 text-sm font-semibold">
              Squad
              <select className="w-auto py-1" value={squad} onChange={(e) => setSquad(e.target.value)}>
                <option value="all">All</option>
                {squads.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1 text-sm font-semibold">
              Sport
              <select className="w-auto py-1" value={sport} onChange={(e) => setSport(e.target.value)}>
                <option value="all">All</option>
                {sports.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
          </div>

          {allIn && (
            <div className="mt-4 flex items-center gap-3 rounded-2xl bg-paper-2 p-3">
              <Art id="empty_done" alt="" className="w-20" />
              <p className="font-semibold">Everyone’s checked in and close to their usual. Sun’s up.</p>
            </div>
          )}

          <AnimatePresence initial={false}>
            <motion.ul layout={!still} className="mt-4 space-y-2" data-testid="board">
              {rows.map((row, i) => (
                <BoardRowItem key={row.id} row={row} focused={focus === i} onFocus={() => setFocus(i)} />
              ))}
            </motion.ul>
          </AnimatePresence>
          {rows.length === 0 && <p className="mt-4 text-center text-mute">Nobody matches that filter.</p>}

          <div className="mt-5 flex flex-wrap items-center gap-3">
            {typeof bulk === 'number' ? (
              <p role="status" className="font-semibold text-teal-ink" data-testid="bulk-result">
                Sent to {bulk} {bulk === 1 ? 'athlete' : 'athletes'}.
              </p>
            ) : bulk === 'confirm' || bulk === 'busy' ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">Send “all good, train as planned” to {readyUnsent}?</span>
                <button
                  className="btn btn-primary"
                  disabled={bulk === 'busy'}
                  data-testid="bulk-confirm"
                  onClick={() => {
                    setBulk('busy');
                    void api<{ sent: number }>('/api/coach/bulk-ready', { method: 'POST' }).then((r) => {
                      setBulk(r.sent);
                      load();
                    });
                  }}
                >
                  Send
                </button>
                <button className="btn" onClick={() => setBulk('idle')}>
                  Cancel
                </button>
              </div>
            ) : (
              <button className="btn" disabled={readyUnsent === 0} data-testid="bulk-start" onClick={() => setBulk('confirm')}>
                All good to everyone Ready ({readyUnsent})
              </button>
            )}
          </div>
          <p className="mt-4 hidden text-xs text-mute sm:block">
            Keyboard: <kbd>j</kbd> and <kbd>k</kbd> to move, <kbd>Enter</kbd> to open.
          </p>
        </>
      )}
      {/* One fixed position: it holds the new athlete's link, so it must survive the board changing. */}
      {session.workspace === 'real' && (
        <div className={`mt-5 flex ${empty ? 'justify-center' : ''}`}>
          <AddAthlete onAdded={load} />
        </div>
      )}
    </main>
  );
}
