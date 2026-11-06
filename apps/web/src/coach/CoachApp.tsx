import { useCallback, useEffect, useState } from 'react';
import { Link, Route, Routes, useNavigate } from 'react-router-dom';
import { api, ApiError, type AppConfig } from '../api';
import { Art, DemoBanner, Logo, LogoMark, Spinner } from '../ui/kit';
import { BoardPage } from './Board';
import { DetailPage } from './Detail';
import { SettingsPage } from './Settings';

export interface CoachSession {
  workspace: 'real' | 'demo';
  style: 'warm' | 'direct' | 'funny';
}

function Login({ onDone }: { onDone: () => void }) {
  const navigate = useNavigate();
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState('');
  const [config, setConfig] = useState<AppConfig | null>(null);
  useEffect(() => {
    void api<AppConfig>('/api/config').then(setConfig);
  }, []);
  return (
    <main id="content" className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center px-4 py-8">
      <Logo className="w-64" />
      <Art id="rollo_whistle" alt="" className="mt-2 w-32" eager />
      <form
        className="card mt-4 w-full space-y-3 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          api('/api/coach/login', { json: { passphrase } })
            .then(onDone)
            .catch((err: ApiError) => setError(err.message));
        }}
      >
        <h1 className="text-2xl">Morning, coach.</h1>
        <div>
          <label htmlFor="passphrase" className="text-sm font-semibold">
            Passphrase
          </label>
          <input id="passphrase" type="password" autoComplete="current-password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
        </div>
        {config && !config.coachLoginEnabled && <p className="text-sm text-mute">Set COACH_PASSPHRASE on the server to turn on sign-in.</p>}
        {error && (
          <p role="alert" className="text-sm font-semibold text-coral-ink">
            {error}
          </p>
        )}
        <button className="btn btn-primary w-full">Sign in</button>
      </form>
      <button
        className="btn mt-3 w-full"
        onClick={() => {
          void api('/api/demo/start', { method: 'POST' }).then(() => {
            onDone();
            navigate('/coach');
          });
        }}
      >
        Look around with demo data
      </button>
    </main>
  );
}

function Header({ session, onSignOut }: { session: CoachSession; onSignOut: () => void }) {
  return (
    <>
      {session.workspace === 'demo' && (
        <DemoBanner>
          <Link to="/a/demo-hana?mode=replay" className="underline" data-testid="try-checkin">
            Try Hana’s check-in (replay)
          </Link>
          <button
            className="underline"
            data-testid="reset-demo"
            onClick={() => {
              void api('/api/demo/start', { method: 'POST' }).then(() => location.assign('/coach'));
            }}
          >
            Reset the demo
          </button>
        </DemoBanner>
      )}
      <header className="border-b-2 border-indigo bg-white">
        <nav aria-label="Main" className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-4 py-2 sm:px-6">
          <Link to="/coach" className="flex items-center gap-2 rounded font-display text-xl font-bold text-indigo no-underline">
            <LogoMark size={34} />
            Roll Call
          </Link>
          <div className="flex items-center gap-1">
            <Link to="/coach/settings" className="rounded-lg px-3 py-2.5 text-sm font-semibold text-indigo hover:bg-paper-2">
              Settings
            </Link>
            <button className="rounded-lg px-3 py-2.5 text-sm font-semibold text-indigo hover:bg-paper-2" onClick={onSignOut}>
              Sign out
            </button>
          </div>
        </nav>
      </header>
    </>
  );
}

export default function CoachApp() {
  const [session, setSession] = useState<CoachSession | null | 'loading'>('loading');
  const load = useCallback(() => {
    api<CoachSession>('/api/coach/me')
      .then(setSession)
      .catch(() => setSession(null));
  }, []);
  useEffect(load, [load]);

  if (session === 'loading') return <Spinner />;
  if (!session) return <Login onDone={load} />;
  return (
    <div className="min-h-dvh bg-paper">
      <Header
        session={session}
        onSignOut={() => {
          void api('/api/coach/logout', { method: 'POST' }).then(() => setSession(null));
        }}
      />
      <Routes>
        <Route index element={<BoardPage session={session} />} />
        <Route path="a/:id" element={<DetailPage session={session} />} />
        <Route path="settings" element={<SettingsPage session={session} onChange={load} />} />
      </Routes>
    </div>
  );
}
