import { existsSync, readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { closeDueSeasons, openDb } from '@rollcall/db';
import { createApp } from './app';
import { loadEnv, localDate, REPO_ROOT } from './env';
import { makeNotifier } from './notify';
import { attachSockets } from './ws';

const env = loadEnv();
const db = await openDb(env.databaseUrl);
const today = (): string => process.env.ROLLCALL_TODAY || localDate(env.timeZone);
const app = createApp({ db, env, today, notifier: makeNotifier(db, env) });

const dist = resolve(REPO_ROOT, 'apps/web/dist');
if (existsSync(dist)) {
  const root = 'apps/web/dist';
  const index = readFileSync(resolve(dist, 'index.html'), 'utf8');
  app.use('/*', serveStatic({ root: resolve(REPO_ROOT, root).replaceAll('\\', '/') }));
  // Any other page is a client-side route.
  app.get('*', (c) => (c.req.path.startsWith('/api/') ? c.notFound() : c.html(index)));
}

const server = serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(`Roll Call API on http://localhost:${info.port}`);
  console.log(
    env.liveAvailable
      ? 'Live check-ins available.'
      : 'Live check-ins off: set SMARTSPECTRA_API_KEY and run pnpm vitals:setup. Judge Mode still works.',
  );
});
attachSockets(server as unknown as Server, db, env, today);

// The season job: closes finished weeks, moves crews between leagues and writes recap cards.
const seasonJob = (): void => {
  void Promise.all([closeDueSeasons(db, 'real', today()), closeDueSeasons(db, 'demo', today())]).catch((err: unknown) => {
    console.error('[seasons]', err);
  });
};
seasonJob();
setInterval(seasonJob, 3_600_000).unref();
