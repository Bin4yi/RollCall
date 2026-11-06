import { L, parsePoseJsonl, POSE_LIBRARY, PoseReplay, type Lm, type PoseFrame, type PoseSession } from '@rollcall/pose';
import { useEffect, useRef, useState } from 'react';

export type PoseMode = 'live' | 'replay' | 'sim';

export type PoseStatus = 'loading' | 'running' | 'finished' | 'failed';

/** Pinned to the installed package. Both are only downloaded: nothing about the person is ever sent. */
const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.2/wasm';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task';

export interface PoseOptions {
  mode: PoseMode;
  /** Which recording to play in replay and sim. */
  session: string;
  speed?: number;
  active: boolean;
  onFrame: (frame: PoseFrame) => void;
}

export interface PoseHandle {
  status: PoseStatus;
  message: string;
  stream: MediaStream | null;
  /** The real frame rate, measured. */
  fps: number;
  /** The newest frame, for drawing. */
  latest: React.RefObject<PoseFrame | null>;
}

type Stop = () => void;

/** The camera asks for 60 fps and takes what the phone gives. MediaPipe runs here, in the browser. */
async function startLive(onFrame: (f: PoseFrame) => void, onStream: (s: MediaStream) => void): Promise<Stop> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60 } },
  });
  onStream(stream);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  await video.play();

  // Only pages that use the camera pay for this download.
  const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision');
  const vision = await FilesetResolver.forVisionTasks(WASM);
  const make = (delegate: 'GPU' | 'CPU') =>
    PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL, delegate },
      runningMode: 'VIDEO',
      numPoses: 1,
    });
  const landmarker = await make('GPU').catch(() => make('CPU'));

  let stopped = false;
  let last = -1;
  let handle = 0;
  const step = (): void => {
    if (stopped) return;
    const now = performance.now();
    if (video.readyState >= 2 && now > last) {
      last = now;
      const result = landmarker.detectForVideo(video, now);
      const person = result.landmarks[0];
      const lm: (Lm | undefined)[] = [];
      if (person) {
        for (const id of Object.values(L)) {
          const p = person[id];
          if (p) lm[id] = { x: p.x, y: p.y, v: p.visibility ?? 0 };
        }
      }
      onFrame({ t: now, aspect: video.videoWidth / video.videoHeight || 1, lm });
    }
    handle = schedule();
  };
  const v = video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number; cancelVideoFrameCallback?: (h: number) => void };
  const schedule = (): number => (v.requestVideoFrameCallback ? v.requestVideoFrameCallback(step) : requestAnimationFrame(step));
  handle = schedule();

  return () => {
    stopped = true;
    if (v.cancelVideoFrameCallback) v.cancelVideoFrameCallback(handle);
    else cancelAnimationFrame(handle);
    stream.getTracks().forEach((t) => t.stop());
    landmarker.close();
  };
}

function startFile(session: PoseSession, speed: number, onFrame: (f: PoseFrame) => void, onDone: () => void): Stop {
  const replay = new PoseReplay(session);
  const begin = performance.now();
  let raf = 0;
  const tick = (): void => {
    const elapsed = (performance.now() - begin) * speed;
    for (const f of replay.framesUntil(elapsed)) onFrame(f);
    if (replay.finished) {
      onDone();
      return;
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}

const LOAD_FAILURE: Record<string, string> = {
  NotAllowedError: 'Camera access is off. Allow the camera for this page and try again.',
  NotFoundError: 'I couldn’t find a camera on this device.',
};

export function usePose({ mode, session, speed = 1, active, onFrame }: PoseOptions): PoseHandle {
  const [status, setStatus] = useState<PoseStatus>('loading');
  const [message, setMessage] = useState('');
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [fps, setFps] = useState(0);
  const latest = useRef<PoseFrame | null>(null);
  const handler = useRef(onFrame);
  handler.current = onFrame;

  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    let stop: Stop | null = null;
    let count = 0;
    let windowStart = performance.now();
    setStatus('loading');
    setMessage('');
    const emit = (frame: PoseFrame): void => {
      latest.current = frame;
      handler.current(frame);
      count++;
      const now = performance.now();
      if (now - windowStart > 1000) {
        setFps(Math.round((count * 1000) / (now - windowStart)));
        count = 0;
        windowStart = now;
      }
    };
    const begin = async (): Promise<void> => {
      try {
        if (mode === 'live') {
          stop = await startLive(emit, (s) => {
            if (!cancelled) setStream(s);
          });
        } else {
          const data =
            mode === 'sim'
              ? POSE_LIBRARY[session]?.()
              : parsePoseJsonl(await fetch(`/poses/${session}.pose.jsonl`).then((r) => {
                  if (!r.ok) throw new Error('missing');
                  return r.text();
                }));
          if (!data) throw new Error('missing');
          if (cancelled) return;
          stop = startFile(data, speed, emit, () => setStatus('finished'));
        }
        if (cancelled) stop?.();
        else setStatus('running');
      } catch (err) {
        if (cancelled) return;
        const name = (err as Error).name;
        setMessage(LOAD_FAILURE[name] ?? 'The movement tracker didn’t start. Check your connection and try again.');
        setStatus('failed');
      }
    };
    void begin();
    return () => {
      cancelled = true;
      stop?.();
      setStream(null);
    };
  }, [active, mode, session, speed]);

  return { status, message, stream, fps, latest };
}

/** Rollo's voice. Silently does nothing where speech isn't available. */
export function say(text: string): void {
  try {
    if (!('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    speechSynthesis.speak(new SpeechSynthesisUtterance(text));
  } catch {
    /* Words are always on screen too. */
  }
}
