import { L, pt, type PoseFrame } from '@rollcall/pose';
import { useEffect, useRef, type ReactNode } from 'react';
import type { PoseMode } from './usePose';

const BONES: [number, number][] = [
  [L.lShoulder, L.rShoulder],
  [L.lShoulder, L.lElbow],
  [L.lElbow, L.lWrist],
  [L.rShoulder, L.rElbow],
  [L.rElbow, L.rWrist],
  [L.lShoulder, L.lHip],
  [L.rShoulder, L.rHip],
  [L.lHip, L.rHip],
  [L.lHip, L.lKnee],
  [L.lKnee, L.lAnkle],
  [L.rHip, L.rKnee],
  [L.rKnee, L.rAnkle],
  [L.lAnkle, L.lFoot],
  [L.rAnkle, L.rFoot],
];

export const MODE_LABEL: Record<PoseMode, string> = {
  live: 'Your camera stays on this phone. Nothing is recorded.',
  replay: 'REPLAY: generated movement, no camera in use',
  sim: 'SIMULATED movement, no camera in use',
};

/** Camera (live only) with the tracked skeleton and a guide showing where to stand. */
export function PoseStage({
  stream,
  latest,
  mode,
  ok,
  lying = false,
  children,
}: {
  stream: MediaStream | null;
  latest: React.RefObject<PoseFrame | null>;
  mode: PoseMode;
  ok: boolean;
  /** Lying exercises get no standing outline. */
  lying?: boolean;
  children?: ReactNode;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (video.current) video.current.srcObject = stream;
  }, [stream]);

  useEffect(() => {
    let raf = 0;
    const draw = (): void => {
      raf = requestAnimationFrame(draw);
      const c = canvas.current;
      const frame = latest.current;
      if (!c) return;
      const ratio = window.devicePixelRatio || 1;
      const w = c.clientWidth * ratio;
      const h = c.clientHeight * ratio;
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
      }
      const g = c.getContext('2d');
      if (!g) return;
      g.clearRect(0, 0, w, h);
      if (!frame) return;
      // Live matches the video's object-fit: cover. A replay has no video, so all of it stays in view.
      const fit = mode === 'live' ? Math.max : Math.min;
      const scale = fit(w / frame.aspect, h);
      const ox = (w - frame.aspect * scale) / 2;
      const oy = (h - scale) / 2;
      const X = (x: number): number => {
        const px = ox + x * scale;
        return mode === 'live' ? w - px : px;
      };
      const Y = (y: number): number => oy + y * scale;
      g.lineCap = 'round';
      g.lineWidth = 5 * ratio;
      g.strokeStyle = '#FF6B5B';
      for (const [a, b] of BONES) {
        const p = pt(frame, a);
        const q = pt(frame, b);
        if (!p || !q) continue;
        g.beginPath();
        g.moveTo(X(p.x), Y(p.y));
        g.lineTo(X(q.x), Y(q.y));
        g.stroke();
      }
      g.fillStyle = '#FFF6E9';
      for (const id of Object.values(L)) {
        const p = pt(frame, id);
        if (!p) continue;
        g.beginPath();
        g.arc(X(p.x), Y(p.y), (id === L.nose ? 9 : 4.5) * ratio, 0, Math.PI * 2);
        g.fill();
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [latest, mode]);

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden bg-indigo" data-testid="pose-stage">
      {mode === 'live' && (
        <video
          ref={video}
          autoPlay
          muted
          playsInline
          aria-label="Your camera, on this phone only. It isn't recorded."
          className="absolute inset-0 h-full w-full -scale-x-100 object-cover"
        />
      )}
      {/* Where to stand. Solid and teal once you're in the right place. */}
      <svg aria-hidden viewBox="0 0 100 160" preserveAspectRatio="xMidYMid meet" className={`pointer-events-none absolute inset-0 h-full w-full ${lying ? 'hidden' : ''}`}>
        <path
          d="M50 14a10 10 0 1 1-.01 0M36 40h28l6 44-8 2-2 54h-9l-1-42-1 42h-9l-2-54-8-2z"
          fill="none"
          stroke={ok ? '#3FB8AF' : '#FFF6E9'}
          strokeOpacity={ok ? 0.75 : 0.55}
          strokeWidth="1.2"
          strokeDasharray={ok ? undefined : '3 3'}
          strokeLinejoin="round"
        />
      </svg>
      <canvas ref={canvas} aria-hidden className="absolute inset-0 h-full w-full" />
      {children}
    </div>
  );
}

export function Confetti({ count = 26 }: { count?: number }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          className="confetti"
          style={{
            left: `${(i * 37) % 100}%`,
            animationDelay: `${(i % 7) * 0.09}s`,
            background: ['#FF6B5B', '#3FB8AF', '#FFB37A', '#2B2A6B'][i % 4],
          }}
        />
      ))}
    </div>
  );
}
