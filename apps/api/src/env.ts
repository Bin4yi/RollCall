import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export const REPO_ROOT = resolve(import.meta.dirname, '../../..');

export interface Env {
  production: boolean;
  port: number;
  databaseUrl: string;
  coachPassphrase: string | null;
  sessionSecret: string;
  liveAvailable: boolean;
  smartSpectraKey: string | null;
  maxLiveSessions: number;
  /** Replay and sim check-ins for the real workspace. Off in production. */
  allowSimForReal: boolean;
  openAiKey: string | null;
  openAiDraftModel: string;
  ollamaUrl: string | null;
  ollamaModel: string | null;
  vapidPublic: string | null;
  vapidPrivate: string | null;
  vapidSubject: string;
  resendKey: string | null;
  emailFrom: string | null;
  timeZone: string | undefined;
}

const blank = (v: string | undefined): string | null => (v && v.trim() ? v.trim() : null);

export function loadEnv(): Env {
  const file = resolve(REPO_ROOT, '.env');
  if (existsSync(file)) process.loadEnvFile(file);
  const e = process.env;
  const production = e.NODE_ENV === 'production';
  const smartSpectraKey = blank(e.SMARTSPECTRA_API_KEY);
  const sdkInstalled = existsSync(
    resolve(REPO_ROOT, 'apps/vitals-worker/runtime/node_modules/@smartspectra/node-sdk'),
  );
  return {
    production,
    port: Number(e.PORT) || 8787,
    databaseUrl: blank(e.DATABASE_URL) ?? `file:${resolve(REPO_ROOT, 'rollcall.db').replaceAll('\\', '/')}`,
    coachPassphrase: blank(e.COACH_PASSPHRASE),
    // Without a configured secret, sign-ins just don't survive a restart.
    sessionSecret: blank(e.SESSION_SECRET) ?? randomBytes(32).toString('hex'),
    liveAvailable: !!smartSpectraKey && sdkInstalled,
    smartSpectraKey,
    maxLiveSessions: Number(e.MAX_LIVE_SESSIONS) || 2,
    allowSimForReal: !production,
    openAiKey: blank(e.OPENAI_API_KEY),
    openAiDraftModel: blank(e.OPENAI_DRAFT_MODEL) ?? 'gpt-5-nano',
    ollamaUrl: blank(e.OLLAMA_URL),
    ollamaModel: blank(e.OLLAMA_MODEL),
    vapidPublic: blank(e.VAPID_PUBLIC_KEY),
    vapidPrivate: blank(e.VAPID_PRIVATE_KEY),
    vapidSubject: blank(e.VAPID_SUBJECT) ?? 'mailto:coach@example.com',
    resendKey: blank(e.RESEND_API_KEY),
    emailFrom: blank(e.EMAIL_FROM),
    timeZone: blank(e.APP_TIMEZONE) ?? undefined,
  };
}

/** The coach's calendar day, so an evening settle check doesn't land on tomorrow's UTC date. */
export function localDate(timeZone: string | undefined, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
