import { useEffect, useRef, type MutableRefObject, type ReactNode } from 'react';
import type { Waves } from './useCheckin';

const SKIES = [
  ['#1B1A33', '#2B2A6B', '#7A4A8C'],
  ['#2B2A6B', '#8D4E7E', '#FF6B5B'],
  ['#4A3F8F', '#FF6B5B', '#FFB37A'],
  ['#3FB8AF', '#FFB37A', '#FFF6E9'],
] as const;

/** The sky brightens as the streak grows: pre-dawn, first light, sunrise, full morning. */
export const skyFor = (streak: number): readonly [string, string, string] =>
  SKIES[streak >= 14 ? 3 : streak >= 7 ? 2 : streak >= 3 ? 1 : 0]!;

const scale = (samples: number[]): number[] => {
  if (samples.length < 2) return samples;
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of samples) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const span = hi - lo || 1;
  return samples.map((v) => (v - lo) / span);
};

/**
 * The signature screen: the sun rises as the progress bar, the horizon is the live pulse waveform,
 * and a soft glow follows the live breathing trace. Drawn on a canvas so 30 Hz waveforms don't
 * re-render React. With reduced motion the sun steps instead of glowing, and the reading stays live.
 */
export function SunriseCanvas({
  share,
  waves,
  sky,
  children,
}: {
  /** 0..1 progress of the check-in. */
  share: number;
  waves: MutableRefObject<Waves>;
  sky: readonly [string, string, string];
  children?: ReactNode;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const shareRef = useRef(share);
  shareRef.current = share;

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const g = el.getContext('2d');
    if (!g) return;
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    let shown = shareRef.current;

    const draw = (): void => {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (el.width !== w * dpr || el.height !== h * dpr) {
        el.width = w * dpr;
        el.height = h * dpr;
      }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);

      shown += (shareRef.current - shown) * (still ? 1 : 0.06);
      const horizon = h * 0.68;
      const sky1 = g.createLinearGradient(0, 0, 0, horizon);
      sky1.addColorStop(0, sky[0]);
      sky1.addColorStop(0.6, sky[1]);
      sky1.addColorStop(1, sky[2]);
      g.fillStyle = sky1;
      g.fillRect(0, 0, w, h);

      // Breathing glow: the sun's halo swells with the live trace.
      const trace = waves.current.trace;
      const breath = still || trace.length < 2 ? 0.5 : (scale(trace.slice(-120)).at(-1) ?? 0.5);
      const radius = Math.min(w, h) * 0.19;
      const sunY = horizon + radius * 1.05 - shown * (horizon * 0.72 + radius);
      const cx = w / 2;
      const halo = radius * (1.7 + breath * 0.55);
      const glow = g.createRadialGradient(cx, sunY, radius * 0.6, cx, sunY, halo);
      glow.addColorStop(0, 'rgba(255,179,122,.75)');
      glow.addColorStop(1, 'rgba(255,179,122,0)');
      g.fillStyle = glow;
      g.fillRect(cx - halo, sunY - halo, halo * 2, halo * 2);

      g.fillStyle = '#FF6B5B';
      g.beginPath();
      g.arc(cx, sunY, radius, 0, Math.PI * 2);
      g.fill();
      // Halftone dots, printed slightly off-register.
      g.fillStyle = 'rgba(255,179,122,.85)';
      const step = 9;
      for (let y = -radius; y <= radius; y += step) {
        for (let x = -radius; x <= radius; x += step) {
          const d = Math.hypot(x, y);
          if (d > radius - 2) continue;
          const dot = 0.6 + (1 - (y + radius) / (radius * 2)) * 3;
          g.beginPath();
          g.arc(cx + x + 2, sunY + y - 1, dot, 0, Math.PI * 2);
          g.fill();
        }
      }

      // The ground covers the sun until it has risen above the horizon.
      g.fillStyle = '#1B1A33';
      g.fillRect(0, horizon, w, h - horizon);

      // The horizon is the heartbeat.
      const pleth = scale(waves.current.pleth);
      g.strokeStyle = '#FFF6E9';
      g.lineWidth = 3;
      g.lineJoin = 'round';
      g.beginPath();
      const amplitude = h * 0.05;
      if (pleth.length < 2) {
        g.moveTo(0, horizon);
        g.lineTo(w, horizon);
      } else {
        pleth.forEach((v, i) => {
          const x = (i / (pleth.length - 1)) * w;
          const y = horizon - (v - 0.5) * 2 * amplitude;
          if (i === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        });
      }
      g.stroke();
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [sky, waves]);

  return (
    <div className="riso-grain fixed inset-0 z-10 overflow-hidden bg-ink">
      <canvas ref={canvas} className="absolute inset-0 h-full w-full" aria-hidden />
      <div className="relative z-3 flex h-full flex-col">{children}</div>
    </div>
  );
}
