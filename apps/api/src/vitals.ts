import { fork, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseSession, ReplaySource, SignalBus, SimSource, type VitalsFrame } from '@rollcall/signals';
import { WebSocket } from 'ws';
import { REPO_ROOT, type Env } from './env';

export interface VitalsCallbacks {
  onFrame: (frame: VitalsFrame) => void;
  onStatus: (state: string, detail?: string) => void;
}

/** One check-in's signal source. Live, replay and sim all look the same to the check-in. */
export interface VitalsStream {
  /** Frames from the browser. Forwarded and forgotten: never stored. */
  sendFrame(data: Buffer): void;
  stop(): void;
}

const WORKER = resolve(REPO_ROOT, 'apps/vitals-worker/src/worker.ts');
/** The SDK stopped about every 15 s with no face in view (probed), so this allows about 90 s to get framed. */
const MAX_RESTARTS = 6;
const START_TIMEOUT_MS = 45_000;
const AUTH_FAILED = /Invalid or missing API key|Status code: 401|API key or OAuth setup is correct/;
const LOG_NOISE = /inference_feedback_manager|absl::InitializeLog|timestamp gap/;

let liveSessions = 0;

export const liveSlotsFree = (env: Env): boolean => liveSessions < env.maxLiveSessions;

/** One process per session: native state is process-global in the SDK (see docs/SDK_NOTES.md). */
export function startLive(env: Env, cb: VitalsCallbacks): VitalsStream {
  liveSessions++;
  let stopped = false;
  let restarts = 0;
  let child: ChildProcess | null = null;
  let frames: WebSocket | null = null;
  let running = false;
  let lastT = 0;
  let baseT = 0;
  let startTimer: NodeJS.Timeout | null = null;

  const start = (): void => {
    running = false;
    baseT = lastT;
    const proc = fork(WORKER, [], {
      execArgv: process.execArgv,
      env: { ...process.env, SMARTSPECTRA_API_KEY: env.smartSpectraKey ?? '' },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    child = proc;
    proc.stdout?.resume();
    proc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      if (AUTH_FAILED.test(text)) {
        cb.onStatus('failed', 'SmartSpectra rejected the API key.');
      }
      for (const line of text.split(/\r?\n/)) {
        if (line.trim() && !LOG_NOISE.test(line)) console.error(`[vitals] ${line.slice(0, 240)}`);
      }
    });
    proc.on('message', (m: { type: string; [k: string]: unknown }) => {
      if (m.type === 'frame') {
        const frame = m.frame as VitalsFrame;
        lastT = baseT + frame.t;
        cb.onFrame({ ...frame, t: lastT });
      } else if (m.type === 'ready') {
        frames = new WebSocket(`ws://127.0.0.1:${m.framesPort as number}`);
        frames.on('error', () => undefined);
      } else if (m.type === 'status') {
        if (m.state === 'running') {
          running = true;
          if (startTimer) clearTimeout(startTimer);
        }
        cb.onStatus(m.state as string, m.detail as string | undefined);
      } else if (m.type === 'error') {
        console.error(`[vitals] SDK error ${String(m.code)}: ${String(m.message)}`);
        cb.onStatus(`error-${String(m.code)}`, m.message as string);
      }
    });
    proc.on('exit', () => {
      if (child !== proc || stopped) return;
      child = null;
      frames?.close();
      frames = null;
      if (++restarts > MAX_RESTARTS) {
        cb.onStatus('failed', 'SmartSpectra keeps stopping. Check the internet connection.');
        return;
      }
      cb.onStatus('restarting');
      setTimeout(() => {
        if (!stopped) start();
      }, 1500);
    });
    if (startTimer) clearTimeout(startTimer);
    startTimer = setTimeout(() => {
      if (!running && !stopped) cb.onStatus('failed', 'SmartSpectra didn’t start. Check the internet connection.');
    }, START_TIMEOUT_MS);
  };
  start();

  return {
    sendFrame(data) {
      if (frames?.readyState === WebSocket.OPEN) frames.send(data);
    },
    stop() {
      if (stopped) return;
      stopped = true;
      liveSessions--;
      if (startTimer) clearTimeout(startTimer);
      frames?.close();
      const proc = child;
      child = null;
      if (proc) {
        proc.send('shutdown');
        const killer = setTimeout(() => proc.kill(), 5000);
        proc.once('exit', () => clearTimeout(killer));
      }
    },
  };
}

/** Real recordings take priority over labelled synthetic stand-ins. */
export function loadSessionFile(name: string): VitalsFrame[] {
  if (!/^[a-z0-9_-]+$/i.test(name)) throw new Error('Bad session name');
  const base = resolve(REPO_ROOT, 'data/sessions');
  const real = resolve(base, `${name}.jsonl`);
  const synthetic = resolve(base, 'synthetic', `${name}.jsonl`);
  const file = existsSync(real) ? real : synthetic;
  return parseSession(readFileSync(file, 'utf8')).frames;
}

function clocked(
  source: ReplaySource | SimSource,
  cb: VitalsCallbacks,
  speed: number,
): VitalsStream {
  const bus = new SignalBus();
  bus.subscribe(cb.onFrame);
  source.start(bus);
  cb.onStatus('running');
  const timer = setInterval(() => source.advance(100 * speed), 100);
  return {
    sendFrame: () => undefined,
    stop() {
      clearInterval(timer);
      source.stop();
    },
  };
}

export function startReplay(name: string, cb: VitalsCallbacks, speed = 1): VitalsStream {
  return clocked(new ReplaySource(name, loadSessionFile(name), true), cb, speed);
}

export function startSim(cb: VitalsCallbacks, speed = 1): VitalsStream {
  return clocked(new SimSource(Date.now() & 0xffff), cb, speed);
}
