import { eq } from 'drizzle-orm';
import webpush from 'web-push';
import { pushSubscriptions, type Db } from '@rollcall/db';
import type { Env } from './env';

export interface Notifier {
  /** Tells the athlete a coach's message is waiting. Never throws: messaging must not depend on it. */
  messageWaiting(athlete: { id: string; email: string | null; token: string }, baseUrl: string): Promise<void>;
  /** A teammate's "Rollo's waiting for you". Push only, and never throws. */
  nudge?(athlete: { id: string; token: string }, fromName: string): Promise<void>;
}

export const silentNotifier: Notifier = { messageWaiting: async () => undefined };

const TITLE = 'Your coach has a note for you';
const BODY = 'Open Roll Call to read it.';

export function makeNotifier(db: Db, env: Env): Notifier {
  if (env.vapidPublic && env.vapidPrivate) {
    webpush.setVapidDetails(env.vapidSubject, env.vapidPublic, env.vapidPrivate);
  }
  const push = async (athleteId: string, payload: { title: string; body: string; url: string }): Promise<void> => {
    if (!env.vapidPublic || !env.vapidPrivate) return;
    const subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.athleteId, athleteId));
    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload));
        } catch (err) {
          // 404 and 410 mean the browser has dropped this subscription.
          const status = (err as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) {
            await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, s.endpoint));
          }
        }
      }),
    );
  };
  return {
    async nudge(athlete, fromName) {
      await push(athlete.id, { title: 'Rollo’s waiting for you', body: `${fromName} gave you a nudge. Two minutes, then you’re done.`, url: `/a/${athlete.token}` });
    },
    async messageWaiting(athlete, baseUrl) {
      const url = `/a/${athlete.token}`;
      await push(athlete.id, { title: TITLE, body: BODY, url });
      if (env.resendKey && env.emailFrom && athlete.email) {
        // https://resend.com/docs/api-reference/emails/send-email
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${env.resendKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: env.emailFrom,
            to: athlete.email,
            subject: TITLE,
            text: `${BODY}\n\n${baseUrl}${url}`,
          }),
          signal: AbortSignal.timeout(10_000),
        }).catch(() => undefined);
      }
    },
  };
}
