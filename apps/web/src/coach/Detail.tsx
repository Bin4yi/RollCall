import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError, type Detail } from '../api';
import { Avatar, Problem, Spinner } from '../ui/kit';
import { StatusSun, STATUS_LABEL, type Status } from '../ui/StatusSun';
import type { CoachSession } from './CoachApp';

const Trends = lazy(() => import('./Trends'));

type Action = 'keep' | 'easy' | 'rest' | 'custom';

const ACTIONS: { key: Action; label: string }[] = [
  { key: 'keep', label: 'Keep plan' },
  { key: 'easy', label: 'Swap to easy' },
  { key: 'rest', label: 'Rest day' },
  { key: 'custom', label: 'Custom' },
];

function Decide({ detail, onSent }: { detail: Detail; onSent: () => void }) {
  const [action, setAction] = useState<Action | null>(null);
  const [body, setBody] = useState('');
  const [custom, setCustom] = useState('');
  const [source, setSource] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const id = detail.athlete.id;

  const choose = (next: Action): void => {
    setAction(next);
    setSent(false);
    setError('');
    setBusy(true);
    api<{ body: string; source: string }>(`/api/coach/athletes/${id}/draft`, { json: { action: next } })
      .then((d) => {
        setBody(d.body);
        setSource(d.source);
      })
      .catch((err: ApiError) => setError(err.message))
      .finally(() => setBusy(false));
  };

  return (
    <section aria-labelledby="decide" className="card mt-4 p-5">
      <h2 id="decide" className="text-xl">
        Decide and send
      </h2>
      {detail.today?.plan && (
        <p className="mt-1 text-sm">
          Today’s plan: <strong data-testid="detail-plan">{detail.today.plan.title}</strong>
        </p>
      )}
      <div role="group" aria-label="What should happen today?" className="mt-3 flex flex-wrap gap-2">
        {ACTIONS.map((a) => (
          <button
            key={a.key}
            aria-pressed={action === a.key}
            data-testid={`action-${a.key}`}
            onClick={() => choose(a.key)}
            className={`btn ${action === a.key ? 'btn-primary' : ''}`}
          >
            {a.label}
          </button>
        ))}
      </div>
      {action && (
        <div className="mt-4 space-y-3">
          {action === 'custom' && (
            <div>
              <label htmlFor="custom-title" className="text-sm font-semibold">
                New session
              </label>
              <input id="custom-title" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Easy swim, 2 km" />
            </div>
          )}
          <div>
            <label htmlFor="draft" className="text-sm font-semibold">
              Your message. Edit it however you like: nothing goes until you press Send.
            </label>
            <textarea id="draft" rows={4} value={body} disabled={busy} data-testid="draft" onChange={(e) => setBody(e.target.value)} />
            <p className="text-xs text-mute" data-testid="draft-source">
              {busy
                ? 'Drafting…'
                : source === 'template'
                  ? 'Draft from a template.'
                  : 'Drafted by AI from numbers and your choice only. It never saw a name or your notes.'}
            </p>
          </div>
          {error && (
            <p role="alert" className="text-sm font-semibold text-coral-ink">
              {error}
            </p>
          )}
          {sent ? (
            <p role="status" className="font-semibold text-teal-ink" data-testid="sent">
              Sent to {detail.athlete.name}.
            </p>
          ) : (
            <button
              className="btn btn-coral"
              disabled={busy || !body.trim() || (action === 'custom' && !custom.trim())}
              data-testid="send"
              onClick={() => {
                setBusy(true);
                api(`/api/coach/athletes/${id}/send`, {
                  json: { action, body, ...(action === 'custom' ? { customTitle: custom } : {}) },
                })
                  .then(() => {
                    setSent(true);
                    onSent();
                  })
                  .catch((err: ApiError) => setError(err.message))
                  .finally(() => setBusy(false));
              }}
            >
              Send to {detail.athlete.name}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function Notes({ detail }: { detail: Detail }) {
  const [notes, setNotes] = useState(detail.athlete.notes);
  const [saved, setSaved] = useState(false);
  return (
    <section className="card mt-4 p-5">
      <label htmlFor="notes" className="font-display text-xl font-bold">
        Your notes
      </label>
      <p className="text-xs text-mute">Private to you. Never sent to AI.</p>
      <textarea
        id="notes"
        rows={3}
        className="mt-2"
        value={notes}
        onChange={(e) => {
          setNotes(e.target.value);
          setSaved(false);
        }}
        onBlur={() => {
          if (notes !== detail.athlete.notes) {
            void api(`/api/coach/athletes/${detail.athlete.id}`, { method: 'PATCH', json: { notes } }).then(() => setSaved(true));
          }
        }}
      />
      <p className="h-4 text-xs text-teal-ink" aria-live="polite">
        {saved ? 'Saved.' : ''}
      </p>
    </section>
  );
}

function Sharing({ detail, session, onChange }: { detail: Detail; session: CoachSession; onChange: () => void }) {
  const [link, setLink] = useState(detail.athlete.link);
  const [confirm, setConfirm] = useState(false);
  const full = `${location.origin}${link}`;
  return (
    <section className="card mt-4 p-5">
      <h2 className="text-xl">Athlete settings</h2>
      <label className="mt-2 flex min-h-11 items-center gap-3 font-semibold">
        <input
          type="checkbox"
          className="h-5 w-5 shrink-0"
          style={{ width: 20 }}
          checked={detail.athlete.showNumbers}
          data-testid="show-numbers"
          onChange={(e) => {
            void api(`/api/coach/athletes/${detail.athlete.id}`, { method: 'PATCH', json: { showNumbers: e.target.checked } }).then(onChange);
          }}
        />
        Show {detail.athlete.name} their numbers after a check-in
      </label>
      <p className="mt-2 text-sm font-semibold">Private link</p>
      <p className="break-all rounded-lg bg-paper-2 p-2 text-xs">{full}</p>
      {session.workspace === 'real' && (
        <div className="mt-2">
          {confirm ? (
            <button
              className="btn btn-coral text-sm"
              onClick={() => {
                void api<{ link: string }>(`/api/coach/athletes/${detail.athlete.id}/rotate-link`, { method: 'POST' }).then((r) => {
                  setLink(r.link);
                  setConfirm(false);
                });
              }}
            >
              Yes, the old link stops working
            </button>
          ) : (
            <button className="btn text-sm" onClick={() => setConfirm(true)}>
              Make a new link
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function Sessions({ detail }: { detail: Detail }) {
  if (!detail.sessions.length && !detail.settle.length) return null;
  return (
    <section className="card mt-4 p-5">
      <h2 className="text-xl">How sessions landed</h2>
      {detail.settle.length > 0 && (
        <>
          <h3 className="mt-2 text-sm font-semibold text-mute">Settle checks: pulse shortly after training</h3>
          <ul className="mt-1 grid gap-2 sm:grid-cols-3" data-testid="settle-summary">
            {detail.settle.map((s) => (
              <li key={s.intensity} className="rounded-xl bg-paper-2 p-3 text-sm">
                <strong className="capitalize">{s.intensity}</strong>
                <br />
                {s.pulseAboveUsual === null ? 'Not read' : `${s.pulseAboveUsual} above usual`}
                {s.minutesAfter !== null && `, about ${s.minutesAfter} min after`}
                <br />
                <span className="text-xs text-mute">
                  {s.count} {s.count === 1 ? 'check' : 'checks'}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {detail.sessions.length > 0 && (
        <>
          <h3 className="mt-4 text-sm font-semibold text-mute">The morning after harder sessions</h3>
          <ul className="mt-1 divide-y divide-indigo/10">
            {detail.sessions.map((s) => (
              <li key={s.date} className="flex items-center justify-between gap-2 py-2 text-sm">
                <span className="min-w-0">
                  <span className="text-xs text-mute">{s.date}</span>
                  <br />
                  {s.title}
                </span>
                <span className="flex shrink-0 items-center gap-1 text-xs font-semibold">
                  {s.nextDay ? (
                    <>
                      <StatusSun status={s.nextDay as Status} size={26} />
                      {STATUS_LABEL[s.nextDay as Status]}
                    </>
                  ) : (
                    'No check-in'
                  )}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

export function DetailPage({ session }: { session: CoachSession }) {
  const { id = '' } = useParams();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    api<Detail>(`/api/coach/athletes/${id}`)
      .then(setDetail)
      .catch((err: ApiError) => setError(err.message));
  }, [id]);
  useEffect(load, [load]);

  if (error) return <Problem title="We couldn’t find that athlete"><p className="text-mute">{error}</p></Problem>;
  if (!detail) return <Spinner />;
  const { athlete, today } = detail;

  return (
    <main id="content" className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <Link to="/coach" className="inline-block rounded px-1 py-2 text-sm font-semibold text-indigo">
        ← Back to the board
      </Link>
      <div className="mt-1 flex items-center gap-4">
        <Avatar name={athlete.name} avatar={athlete.avatar} size={72} />
        <div className="min-w-0">
          <h1 className="text-3xl">{athlete.name}</h1>
          <p className="text-sm capitalize text-mute">
            {athlete.sport}
            {athlete.squad ? ` · ${athlete.squad}` : ''}
          </p>
        </div>
        {today && (
          <div className="ml-auto flex flex-col items-center text-center">
            <StatusSun status={today.status} size={56} />
            <span className="text-xs font-semibold">{STATUS_LABEL[today.status]}</span>
          </div>
        )}
      </div>
      {today && (today.reasons.length > 0 || today.gentleNudge) && (
        <div className="mt-3 rounded-xl bg-apricot/40 p-3 text-sm">
          {today.reasons.length > 0 && <p data-testid="detail-reasons">{today.reasons.join(' · ')}</p>}
          {today.gentleNudge && <p className="font-semibold">Feels 1/5 three days running. Maybe check in personally.</p>}
        </div>
      )}

      <div className="grid gap-x-4 lg:grid-cols-[1.25fr_1fr]">
        <div>
          <Suspense fallback={<Spinner label="Drawing trends" />}>
            <Trends detail={detail} />
          </Suspense>
          <Sessions detail={detail} />
        </div>
        <div>
          <Decide detail={detail} onSent={load} />
          <Notes key={athlete.notes} detail={detail} />
          {detail.messages.length > 0 && (
            <section className="card mt-4 p-5">
              <h2 className="text-xl">Messages sent</h2>
              <ul className="mt-2 space-y-2 text-sm">
                {detail.messages.slice(0, 5).map((m) => (
                  <li key={m.id} className="rounded-xl bg-paper-2 p-3">
                    <p>{m.body}</p>
                    <p className="mt-1 text-xs text-mute">
                      {m.date} · {m.readAt ? 'Read' : 'Not read yet'}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <Sharing detail={detail} session={session} onChange={load} />
        </div>
      </div>
    </main>
  );
}
