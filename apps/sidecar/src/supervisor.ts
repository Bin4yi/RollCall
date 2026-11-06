/**
 * Owns the vitals socket and the SDK worker's lifecycle. The worker only runs while a client wants
 * it, because live SDK time is scarce on the free trial.
 *
 * Control messages: {type:'start'} {type:'stop'} {type:'record',name,secs}
 */
import { fork, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Recorder, type VitalsFrame } from '@hush/signals';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  isAuthFailure,
  isLogNoise,
  safeSessionName,
  StartWatchdog,
  VITALS_PORT,
  type WorkerMessage,
} from './protocol';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');

/** Minimal .env loader, so `pnpm sidecar` works without another dependency. */
function loadEnv(): void {
  const path = resolve(repoRoot, '.env');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (match?.[1] && match[2] && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  }
}
loadEnv();

const RESTART_DELAY_MS = 2000;
const MAX_RAPID_RESTARTS = 5;
const IDLE_STOP_MS = 10_000;
const START_TIMEOUT_MS = 45_000;

const server = new WebSocketServer({ host: '127.0.0.1', port: VITALS_PORT });
const wanted = new Set<WebSocket>();
let worker: ChildProcess | null = null;
let rapidRestarts = 0;
let idleTimer: NodeJS.Timeout | null = null;
const watchdog = new StartWatchdog(START_TIMEOUT_MS);
let recording: { name: string; recorder: Recorder; until: number; startT?: number } | null = null;

const broadcast = (message: unknown): void => {
  const text = JSON.stringify(message);
  for (const client of server.clients) if (client.readyState === 1) client.send(text);
};

function startWorker(): void {
  if (worker) return;
  watchdog.begin(Date.now());
  // Inherit tsx through execArgv so the forked worker can run TypeScript too.
  const child = fork(resolve(here, 'worker.ts'), [], {
    execArgv: process.execArgv,
    env: process.env,
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  worker = child;
  child.stderr?.on('data', (chunk: Buffer) => onWorkerLog(chunk.toString()));
  child.on('message', (message: WorkerMessage) => onWorkerMessage(message));
  child.on('exit', (code) => {
    if (worker !== child) return;
    worker = null;
    watchdog.clear();
    console.log(`[sidecar] worker exited (${code})`);
    if (wanted.size === 0) return;
    if (++rapidRestarts > MAX_RAPID_RESTARTS) {
      broadcast({ type: 'status', state: 'failed', detail: 'SDK worker keeps stopping.' });
      return;
    }
    broadcast({ type: 'status', state: 'restarting' });
    setTimeout(() => {
      if (wanted.size > 0) startWorker();
    }, RESTART_DELAY_MS);
  });
}

/**
 * A rejected key doesn't reliably raise an error event: with a 401 and no frames being pushed, the
 * session stayed in "starting" with only log output (probed). Without this the player would wait
 * for the watchdog.
 */
function onWorkerLog(text: string): void {
  if (isAuthFailure(text)) {
    watchdog.clear();
    broadcast({
      type: 'status',
      state: 'failed',
      detail: 'SmartSpectra rejected the API key. Check SMARTSPECTRA_API_KEY in .env.',
    });
  }
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() && !isLogNoise(line)) console.error(line.slice(0, 300));
  }
}

function stopWorker(): void {
  const child = worker;
  worker = null;
  watchdog.clear();
  if (!child) return;
  child.send('shutdown');
  const killer = setTimeout(() => child.kill(), 5000);
  child.once('exit', () => clearTimeout(killer));
}

function onWorkerMessage(message: WorkerMessage): void {
  if (message.type === 'frame') {
    rapidRestarts = 0;
    addToRecording(message.frame);
    broadcast(message);
    return;
  }
  if (message.type === 'status' && message.state === 'running') watchdog.markRunning();
  if (message.type === 'error')
    console.error(`[sidecar] SDK error ${message.code}: ${message.message}`);
  broadcast(message);
}

function addToRecording(frame: VitalsFrame): void {
  if (!recording) return;
  // Sessions start at t=0 from the moment recording began.
  recording.startT ??= frame.t;
  recording.recorder.add({ ...frame, t: frame.t - recording.startT });
  if (Date.now() >= recording.until) finishRecording();
}

function finishRecording(): void {
  if (!recording) return;
  const { name, recorder } = recording;
  recording = null;
  const dir = resolve(repoRoot, 'data/sessions');
  mkdirSync(dir, { recursive: true });
  const path = resolve(dir, `${name}.jsonl`);
  writeFileSync(path, recorder.toJsonl());
  console.log(`[sidecar] saved ${path} (${recorder.count} frames)`);
  broadcast({ type: 'recording', name, state: 'saved', path, frames: recorder.count });
}

server.on('connection', (socket) => {
  socket.on('message', (raw) => {
    let control: { type?: string; name?: unknown; secs?: unknown };
    try {
      control = JSON.parse(raw.toString()) as typeof control;
    } catch {
      return;
    }
    if (control.type === 'start') {
      wanted.add(socket);
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = null;
      rapidRestarts = 0;
      startWorker();
    } else if (control.type === 'stop') {
      release(socket);
    } else if (control.type === 'record') {
      const name = safeSessionName(control.name);
      const secs = typeof control.secs === 'number' ? Math.min(300, Math.max(1, control.secs)) : 60;
      if (!name) {
        socket.send(JSON.stringify({ type: 'status', state: 'bad-session-name' }));
        return;
      }
      recording = { name, recorder: new Recorder(), until: Date.now() + secs * 1000 };
      broadcast({ type: 'recording', name, state: 'started' });
    }
  });
  socket.on('close', () => release(socket));
});

function release(socket: WebSocket): void {
  wanted.delete(socket);
  if (wanted.size > 0 || idleTimer) return;
  idleTimer = setTimeout(() => {
    idleTimer = null;
    if (wanted.size === 0) stopWorker();
  }, IDLE_STOP_MS);
}

setInterval(() => {
  if (watchdog.expired(Date.now())) {
    watchdog.clear();
    broadcast({
      type: 'status',
      state: 'start-timeout',
      detail: 'SmartSpectra did not start. Check your internet connection and API key.',
    });
  }
}, 1000);

const quit = (): void => {
  stopWorker();
  setTimeout(() => process.exit(0), 500);
};
process.on('SIGINT', quit);
process.on('SIGTERM', quit);

server.on('listening', () => console.log(`[sidecar] vitals on ws://127.0.0.1:${VITALS_PORT}`));
