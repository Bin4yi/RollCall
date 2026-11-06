import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, Server } from 'node:http';
import { resolve } from 'node:path';
import { athletes, awardPoints, checkins, crewMembers, crews, gameEvents, type Db } from '@rollcall/db';
import { CheckinSession, type CheckinKind, type CheckinResult } from '@rollcall/readiness';
import { Recorder, type VitalsFrame } from '@rollcall/signals';
import { and, eq } from 'drizzle-orm';
import { WebSocket, WebSocketServer } from 'ws';
import { REPO_ROOT, type Env } from './env';
import { liveSlotsFree, startLive, startReplay, startSim, type VitalsStream } from './vitals';

type Mode = 'live' | 'replay' | 'sim';

/** What the sidecar's status words mean to an athlete. Anything else stays internal. */
const FRIENDLY_FAILURE: Record<string, string> = {
  failed: 'We couldn’t reach the measuring service. Check your connection and try again.',
  'no-key': 'Live check-ins aren’t set up on this server yet.',
  'sdk-missing': 'Live check-ins aren’t set up on this server yet.',
};

const FAILURE_CODES = new Set(['error-2', 'error-4']);

export async function saveCheckin(
  db: Db,
  athleteId: string,
  date: string,
  result: CheckinResult,
  source: Mode,
): Promise<string> {
  const values = {
    source,
    pulse: result.pulse?.value ?? null,
    pulseConf: result.pulse?.conf ?? null,
    breath: result.breath?.value ?? null,
    breathConf: result.breath?.conf ?? null,
    rmssd: result.rmssd?.value ?? null,
    sdnn: result.sdnn?.value ?? null,
    meanNn: result.meanNn?.value ?? null,
    stress: result.stress?.value ?? null,
    hrvConf: result.rmssd?.conf ?? null,
    pulseOutOfRange: result.pulseOutOfRange,
    createdAt: new Date().toISOString(),
  };
  const [existing] = await db
    .select({ id: checkins.id })
    .from(checkins)
    .where(and(eq(checkins.athleteId, athleteId), eq(checkins.date, date), eq(checkins.kind, result.kind)));
  if (existing) {
    await db.update(checkins).set(values).where(eq(checkins.id, existing.id));
    return existing.id;
  }
  const id = randomUUID();
  await db.insert(checkins).values({ id, athleteId, date, kind: result.kind, ...values });
  return id;
}

const send = (socket: WebSocket, message: unknown): void => {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
};

/** Thin waveform and reading update for the check-in screen. */
function tickMessage(frame: VitalsFrame, session: CheckinSession) {
  return {
    type: 'tick',
    progress: session.progress(),
    source: frame.source,
    pulse: frame.pulse && frame.pulse.conf >= 0.4 ? frame.pulse.bpm : null,
    breath: frame.breath && frame.breath.conf >= 0.45 ? frame.breath.bpm : null,
    pleth: frame.pleth?.samples ?? [],
    trace: frame.breathTrace?.samples ?? [],
    conf: {
      pulse: frame.pulse?.conf ?? 0,
      breath: frame.breath?.conf ?? 0,
      hrv: frame.hrv?.conf ?? 0,
    },
    debug: { talking: frame.talking ?? false, quality: frame.quality },
  };
}

export function attachSockets(server: Server, db: Db, env: Env, today: () => string): void {
  const control = new WebSocketServer({ noServer: true });
  const frames = new WebSocketServer({ noServer: true, maxPayload: 16e6 });
  const crewSocket = new WebSocketServer({ noServer: true });
  const active = new Map<string, VitalsStream>();

  server.on('upgrade', (req: IncomingMessage, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/ws/checkin') {
      control.handleUpgrade(req, socket, head, (ws) => void onControl(ws, url));
    } else if (url.pathname === '/ws/crew') {
      crewSocket.handleUpgrade(req, socket, head, (ws) => void onCrew(ws, url));
    } else if (url.pathname === '/ws/frames') {
      frames.handleUpgrade(req, socket, head, (ws) => onFrames(ws, url));
    } else {
      socket.destroy();
    }
  });

  /** Tells a member's phone when their league changed. Carries no data: the phone fetches what it may see. */
  async function onCrew(ws: WebSocket, url: URL): Promise<void> {
    const [athlete] = await db.select().from(athletes).where(eq(athletes.token, url.searchParams.get('token') ?? ''));
    if (!athlete) {
      ws.close(4404);
      return;
    }
    const listener = (leagueId: string): void => {
      void (async () => {
        const [member] = await db.select().from(crewMembers).where(eq(crewMembers.athleteId, athlete.id));
        const [crew] = member ? await db.select().from(crews).where(eq(crews.id, member.crewId)) : [];
        if (crew?.leagueId === leagueId) send(ws, { type: 'update' });
      })();
    };
    gameEvents.on('league', listener);
    ws.on('close', () => gameEvents.off('league', listener));
  }

  function onFrames(ws: WebSocket, url: URL): void {
    const stream = active.get(url.searchParams.get('session') ?? '');
    if (!stream) {
      ws.close(4404);
      return;
    }
    // Forwarded to the worker and dropped. Frames are never written anywhere.
    ws.on('message', (data: Buffer) => stream.sendFrame(data));
  }

  async function onControl(ws: WebSocket, url: URL): Promise<void> {
    const fail = (message: string): void => {
      send(ws, { type: 'failed', message });
      ws.close();
    };
    const [athlete] = await db
      .select()
      .from(athletes)
      .where(eq(athletes.token, url.searchParams.get('token') ?? ''));
    // The browser may have left during that query; a stream started now would never be stopped.
    if (ws.readyState !== WebSocket.OPEN) return undefined;
    if (!athlete) return fail('This link isn’t active.');
    if (!athlete.consentAt) return fail('Consent is needed first.');

    const kind: CheckinKind = url.searchParams.get('kind') === 'settle' ? 'settle' : 'morning';
    const demo = athlete.workspace === 'demo';
    const requested = url.searchParams.get('mode');
    const mode: Mode =
      requested === 'replay' || requested === 'sim' || requested === 'live'
        ? requested
        : demo
          ? 'replay'
          : 'live';
    // Judge Mode can't spend live SDK credit, and real athletes can't fake a reading in production.
    if (demo && mode === 'live') return fail('Judge Mode uses recorded data.');
    if (!demo && mode !== 'live' && !env.allowSimForReal) return fail('Live check-ins only.');
    if (mode === 'live' && !env.liveAvailable) {
      return fail('Live check-ins aren’t set up on this server yet.');
    }
    if (mode === 'live' && !liveSlotsFree(env)) {
      return fail('A lot of people are checking in. Please try again in a minute.');
    }
    // Judge Mode can fast-forward a recording. A live check-in always runs at real speed.
    const speed = env.production && !demo ? 1 : Math.min(30, Math.max(1, Number(url.searchParams.get('speed')) || 1));

    const id = randomUUID();
    const session = new CheckinSession(kind);
    const recordName = !env.production ? url.searchParams.get('record') : null;
    const recorder = recordName && /^[a-z0-9_-]+$/i.test(recordName) ? new Recorder() : null;
    let finished = false;
    let stream: VitalsStream | null = null;

    const end = (): void => {
      finished = true;
      stream?.stop();
      active.delete(id);
    };

    const saveRecording = (): void => {
      if (!recorder?.count) return;
      const dir = resolve(REPO_ROOT, 'data/sessions');
      mkdirSync(dir, { recursive: true });
      writeFileSync(resolve(dir, `${recordName}.jsonl`), recorder.toJsonl());
    };

    const finish = async (): Promise<void> => {
      const result = session.result();
      const phase = session.progress().phase;
      end();
      saveRecording();
      if (!result.completed) {
        send(ws, {
          type: 'timed-out',
          message: 'That one didn’t settle. Find some light, sit still, and try once more.',
        });
        ws.close();
        return;
      }
      // Recording sessions are for the reference library, not an athlete's history.
      const checkinId = recorder ? null : await saveCheckin(db, athlete.id, today(), result, mode);
      if (!recorder) await awardPoints(db, athlete, today());
      send(ws, { type: 'result', phase, checkinId, result });
      ws.close();
    };

    const onFrame = (frame: VitalsFrame): void => {
      if (finished) return;
      recorder?.add(frame);
      session.ingest(frame);
      const phase = session.progress().phase;
      if (phase === 'done' || phase === 'timed-out') {
        void finish();
        return;
      }
      send(ws, tickMessage(frame, session));
    };
    const onStatus = (state: string, detail?: string): void => {
      if (finished) return;
      const friendly =
        FRIENDLY_FAILURE[state] ??
        (state === 'error-2'
          ? 'Live check-ins aren’t set up correctly on this server.'
          : state === 'error-4'
            ? 'The measuring service is out of credit. Tell your coach.'
            : null);
      if (friendly && (state in FRIENDLY_FAILURE || FAILURE_CODES.has(state))) {
        console.error(`[checkin] ${state}: ${detail ?? ''}`);
        end();
        fail(friendly);
        return;
      }
      // A restarted SDK has lost its measurement windows, so the seconds so far no longer count.
      if (state === 'restarting') session.restart();
      send(ws, { type: 'status', state });
    };

    ws.on('close', () => {
      if (!finished) end();
    });

    const callbacks = { onFrame, onStatus };
    active.set(id, { sendFrame: () => undefined, stop: () => undefined });
    send(ws, { type: 'session', id, mode, target: session.progress().target });
    try {
      stream =
        mode === 'live'
          ? startLive(env, callbacks)
          : mode === 'replay'
            ? startReplay(url.searchParams.get('session') ?? (athlete.id === 'demo-amara' ? 'amara_morning_90s' : 'calm_seated_90s'), callbacks, speed)
            : startSim(callbacks, speed);
      active.set(id, stream);
    } catch (err) {
      console.error('[checkin] could not start', err);
      end();
      fail('We couldn’t start the check-in. Please try again.');
    }
    return undefined;
  }
}
