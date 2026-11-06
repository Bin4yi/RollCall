import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Workspace } from '@rollcall/db';

const DAY_SECONDS = 86_400;
const LIFETIME = 30 * DAY_SECONDS;

const sign = (secret: string, payload: string): string =>
  createHmac('sha256', secret).update(payload).digest('base64url');

export function makeSession(secret: string, workspace: Workspace, nowSeconds = Date.now() / 1000): string {
  const payload = `${workspace}.${Math.floor(nowSeconds + LIFETIME)}`;
  return `${payload}.${sign(secret, payload)}`;
}

export function readSession(
  secret: string,
  value: string | undefined,
  nowSeconds = Date.now() / 1000,
): Workspace | null {
  if (!value) return null;
  const [workspace, expires, signature] = value.split('.');
  if (!workspace || !expires || !signature) return null;
  const expected = Buffer.from(sign(secret, `${workspace}.${expires}`));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  if (Number(expires) < nowSeconds) return null;
  return workspace === 'real' || workspace === 'demo' ? workspace : null;
}

/** Constant-time passphrase check. */
export function passphraseMatches(expected: string, given: string): boolean {
  const a = createHmac('sha256', 'passphrase').update(expected).digest();
  const b = createHmac('sha256', 'passphrase').update(given).digest();
  return timingSafeEqual(a, b);
}
