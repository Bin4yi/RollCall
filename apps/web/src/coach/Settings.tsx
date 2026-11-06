import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Art, Disclaimer } from '../ui/kit';
import type { CoachSession } from './CoachApp';

const STYLES = [
  { key: 'warm', label: 'Warm', example: '“You’ve earned it, and it’ll help the weeks ahead.”' },
  { key: 'direct', label: 'Direct', example: '“Rest day today. No training.”' },
  { key: 'funny', label: 'Funny', example: '“Your official assignment today is doing nothing.”' },
] as const;

export function SettingsPage({ session, onChange }: { session: CoachSession; onChange: () => void }) {
  const [style, setStyle] = useState(session.style);
  return (
    <main id="content" className="mx-auto max-w-2xl px-4 py-6 sm:px-6">
      <Link to="/coach" className="inline-block rounded px-1 py-2 text-sm font-semibold text-indigo">
        ← Back to the board
      </Link>
      <h1 className="mt-1 text-3xl">Settings</h1>
      <fieldset className="card mt-4 p-5">
        <legend className="px-1 font-display text-xl font-bold">How your drafts should sound</legend>
        <div className="mt-2 space-y-2">
          {STYLES.map((s) => (
            <label key={s.key} className={`flex cursor-pointer items-start gap-3 rounded-xl border-2 p-3 ${style === s.key ? 'border-indigo bg-apricot/30' : 'border-indigo/20'}`}>
              <input
                type="radio"
                name="style"
                className="mt-1 shrink-0"
                style={{ width: 18 }}
                checked={style === s.key}
                data-testid={`style-${s.key}`}
                onChange={() => {
                  setStyle(s.key);
                  void api('/api/coach/settings', { method: 'PATCH', json: { style: s.key } }).then(onChange);
                }}
              />
              <span>
                <strong>{s.label}</strong>
                <br />
                <span className="text-sm text-mute">{s.example}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <section className="card mt-4 grid items-center gap-4 p-5 sm:grid-cols-[auto_1fr]">
        <Art id="how_privacy" alt="" className="mx-auto w-24" />
        <div>
          <h2 className="text-xl">What AI sees</h2>
          <p className="text-sm leading-relaxed">
            Numbers and your chosen action. Never a name, video, your notes or a session title. Every draft is checked against a list of banned wording, and you approve every message.
          </p>
        </div>
      </section>
      <Disclaimer className="mt-5" />
    </main>
  );
}
