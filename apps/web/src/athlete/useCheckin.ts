import { useCallback, useEffect, useRef, useState } from 'react';
import { FrameCapture } from '../capture/frameCapture';

export interface Progress {
  phase: 'framing' | 'measuring' | 'done' | 'timed-out';
  seconds: number;
  target: number;
  pause: 'talking' | 'moving' | 'framing' | 'no-face' | 'no-signal' | null;
  hint: { code: number; text: string; pose: 'lamp' | 'phone' | 'still' | 'shh' | 'wave' } | null;
}

export interface Reading {
  value: number;
  conf: number;
}

export interface CheckinResult {
  pulse?: Reading;
  breath?: Reading;
  rmssd?: Reading;
  stress?: Reading;
  pulseOutOfRange: boolean;
}

export type CheckinState =
  | { step: 'connecting' }
  | { step: 'measuring'; progress: Progress; pulse: number | null; breath: number | null }
  | { step: 'result'; result: CheckinResult }
  | { step: 'failed'; message: string };

export interface Waves {
  /** Latest samples, oldest first. A ref so the 30 Hz waveform never re-renders React. */
  pleth: number[];
  trace: number[];
}

const KEEP_SAMPLES = 240;

/**
 * Runs one check-in over the socket. In live mode it also starts the camera. The camera stops the
 * moment the check-in ends or this screen goes away.
 */
export function useCheckin(params: {
  token: string;
  kind: 'morning' | 'settle';
  mode: string | null;
  session: string | null;
  speed: string | null;
  record?: string | null;
  /** Testing only: forces phone-style JPEG frames on this computer. */
  frames?: 'jpeg';
}) {
  const { token, kind, mode, session, speed, record, frames } = params;
  const [state, setState] = useState<CheckinState>({ step: 'connecting' });
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [liveMode, setLiveMode] = useState<string | null>(null);
  const waves = useRef<Waves>({ pleth: [], trace: [] });
  const socketRef = useRef<WebSocket | null>(null);

  const start = useCallback(() => {
    setState({ step: 'connecting' });
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    const query = new URLSearchParams({ token, kind });
    if (mode) query.set('mode', mode);
    if (session) query.set('session', session);
    if (speed) query.set('speed', speed);
    if (record) query.set('record', record);
    const ws = new WebSocket(`${scheme}://${location.host}/ws/checkin?${query}`);
    socketRef.current = ws;
    let capture: FrameCapture | null = null;
    let ended = false;

    const finish = (next: CheckinState): void => {
      ended = true;
      setState(next);
      capture?.stop();
      capture = null;
      setStream(null);
    };

    ws.onmessage = (event) => {
      const m = JSON.parse(event.data as string) as Record<string, unknown>;
      if (m.type === 'session') {
        setLiveMode(m.mode as string);
        if (m.mode === 'live') {
          capture = new FrameCapture();
          const url = `${scheme}://${location.host}/ws/frames?session=${m.id as string}`;
          capture
            .start(url, frames)
            .then(() => setStream(capture?.mediaStream ?? null))
            .catch((err: Error) => {
              ws.close();
              finish({
                step: 'failed',
                message:
                  err.name === 'NotAllowedError'
                    ? 'Roll Call needs your camera for the check-in. Allow it in your browser settings and try again.'
                    : 'We couldn’t open your camera. Close other apps using it and try again.',
              });
            });
        }
      } else if (m.type === 'tick') {
        const w = waves.current;
        w.pleth = [...w.pleth, ...(m.pleth as number[])].slice(-KEEP_SAMPLES);
        w.trace = [...w.trace, ...(m.trace as number[])].slice(-KEEP_SAMPLES);
        setState({
          step: 'measuring',
          progress: m.progress as Progress,
          pulse: m.pulse as number | null,
          breath: m.breath as number | null,
        });
      } else if (m.type === 'result') {
        finish({ step: 'result', result: m.result as CheckinResult });
      } else if (m.type === 'failed' || m.type === 'timed-out') {
        finish({ step: 'failed', message: m.message as string });
      }
    };
    ws.onerror = () => undefined;
    ws.onclose = () => {
      if (!ended) finish({ step: 'failed', message: 'The connection dropped. Check your signal and try again.' });
    };
    return () => {
      ended = true;
      capture?.stop();
      ws.close();
    };
  }, [token, kind, mode, session, speed, record, frames]);

  useEffect(() => start(), [start]);

  return { state, stream, waves, liveMode, retry: start };
}
