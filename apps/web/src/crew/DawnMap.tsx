import { motion, useReducedMotion } from 'motion/react';
import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ASSETS } from '../assets.gen';
import type { MapView } from '../api';
import type { AssetId } from '../ui/kit';

const SIZE = 50;
const W = Math.sqrt(3) * SIZE;

const place = (q: number, r: number): { x: number; y: number } => ({ x: W * (q + r / 2), y: 1.5 * SIZE * r });

const HEX = Array.from({ length: 6 }, (_, i) => {
  const a = (Math.PI / 180) * (60 * i - 30);
  return `${(SIZE - 1.5) * Math.cos(a)},${(SIZE - 1.5) * Math.sin(a)}`;
}).join(' ');

const GROUND: Record<string, string> = {
  meadow: '#E7E3B8',
  forest: '#BBD6B4',
  river: '#BFE3DF',
  lake: '#A8DAD6',
  hill: '#E8D7A8',
  pass: '#D8D2CF',
  coast: '#F3E2BC',
  lighthouse: '#F3E2BC',
  village: '#F6D9B8',
};

const art = (id: string): string | null => {
  const asset = ASSETS[id as AssetId];
  return asset ? `/assets/${asset.file}.webp` : null;
};

/** Pan with a drag, zoom with the buttons, wheel or a pinch. Everything is also listed beside the map. */
export function DawnMapView({ map }: { map: MapView }) {
  const still = useReducedMotion();
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef(0);
  const svg = useRef<SVGSVGElement>(null);

  const colourOf = (id: string | null): string => map.crews.find((c) => c.id === id)?.colour ?? '#2B2A6B';
  const clampZoom = (z: number): number => Math.max(1, Math.min(3, z));

  const onMove = (e: ReactPointerEvent): void => {
    const before = pointers.current.get(e.pointerId);
    if (!before) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const all = [...pointers.current.values()];
    if (all.length === 2) {
      const d = Math.hypot(all[0]!.x - all[1]!.x, all[0]!.y - all[1]!.y);
      if (pinch.current) setZoom((z) => clampZoom((z * d) / pinch.current));
      pinch.current = d;
      return;
    }
    const scale = (svg.current ? 900 / svg.current.clientWidth : 1) / zoom;
    setPan((p) => ({ x: p.x + (e.clientX - before.x) * scale, y: p.y + (e.clientY - before.y) * scale }));
  };

  const summary = map.crews.map((c) => `${c.name} ${c.tiles} tiles`).join(', ');

  return (
    <div className="relative overflow-hidden rounded-2xl border-2 border-indigo" style={{ background: 'linear-gradient(#2B2A6B, #FF6B5B 75%, #FFB37A)' }}>
      <svg
        ref={svg}
        viewBox="-450 -390 900 780"
        role="img"
        aria-label={`The Dawn Map. ${summary}.`}
        data-testid="dawn-map"
        className="block w-full touch-none select-none"
        onWheel={(e) => setZoom((z) => clampZoom(z * (e.deltaY < 0 ? 1.1 : 0.9)))}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          pinch.current = 0;
        }}
        onPointerMove={onMove}
        onPointerUp={(e) => {
          pointers.current.delete(e.pointerId);
          pinch.current = 0;
        }}
        onPointerCancel={(e) => {
          pointers.current.delete(e.pointerId);
          pinch.current = 0;
        }}
      >
        <defs>
          <filter id="unlit">
            <feColorMatrix type="saturate" values="0.25" />
          </filter>
          <radialGradient id="sunlight">
            <stop offset="0" stopColor="#FFF6E9" stopOpacity="0.95" />
            <stop offset="0.6" stopColor="#FFB37A" stopOpacity="0.5" />
            <stop offset="1" stopColor="#FFB37A" stopOpacity="0" />
          </radialGradient>
        </defs>
        <g transform={`scale(${zoom}) translate(${pan.x} ${pan.y})`}>
          {map.tiles.map((t) => {
            const { x, y } = place(t.q, t.r);
            const lit = t.crewId !== null;
            const colour = colourOf(t.crewId);
            const icon = art(`tile_${t.kind}`);
            return (
              <g key={`${t.q},${t.r}`} transform={`translate(${x} ${y})`} data-testid={t.claimedToday ? 'tile-claimed' : undefined}>
                <polygon points={HEX} fill={lit ? GROUND[t.kind] : '#8E8BB8'} />
                {lit && <polygon points={HEX} fill={colour} fillOpacity={0.3 * t.light} />}
                {icon && (
                  <image
                    href={icon}
                    x={-W / 2}
                    y={-SIZE}
                    width={W}
                    height={SIZE * 2}
                    opacity={lit ? 0.6 + 0.4 * t.light : 0.75}
                    filter={lit ? undefined : 'url(#unlit)'}
                    preserveAspectRatio="xMidYMid meet"
                  />
                )}
                {!lit && <polygon points={HEX} fill="#2B2A6B" fillOpacity="0.25" />}
                <polygon
                  points={HEX}
                  fill="none"
                  stroke={lit ? colour : '#2B2A6B'}
                  strokeWidth={lit ? 4 : 1.5}
                  strokeOpacity={lit ? 0.5 + 0.5 * t.light : 0.4}
                  strokeDasharray={t.contested ? '9 6' : undefined}
                />
                {t.claimedToday && !still && (
                  <motion.circle
                    r={SIZE * 2.2}
                    fill="url(#sunlight)"
                    initial={{ scale: 0, opacity: 1 }}
                    animate={{ scale: 1, opacity: 0 }}
                    transition={{ duration: 1.8, ease: 'easeOut', delay: 0.3 }}
                  />
                )}
                {t.claimedToday && <circle r={SIZE * 0.2} fill="#FFF6E9" stroke={colour} strokeWidth="4" />}
              </g>
            );
          })}
          {map.crews.map((c) => {
            const { x, y } = place(c.home.q, c.home.r);
            const emblem = art(c.emblem);
            return (
              <g key={c.id} transform={`translate(${x} ${y})`}>
                <circle r={SIZE * 0.72} fill="#FFF6E9" stroke={c.colour} strokeWidth={c.isYours ? 7 : 4} />
                {emblem ? <image href={emblem} x={-SIZE * 0.62} y={-SIZE * 0.62} width={SIZE * 1.24} height={SIZE * 1.24} /> : <circle r={SIZE * 0.4} fill={c.colour} />}
              </g>
            );
          })}
        </g>
      </svg>
      <div className="absolute right-2 bottom-2 flex gap-1">
        <button className="btn min-h-11 w-11 bg-white p-0 text-xl" aria-label="Zoom in" onClick={() => setZoom((z) => clampZoom(z * 1.3))}>
          +
        </button>
        <button className="btn min-h-11 w-11 bg-white p-0 text-xl" aria-label="Zoom out" onClick={() => setZoom((z) => clampZoom(z / 1.3))}>
          −
        </button>
        <button
          className="btn min-h-11 bg-white px-3 text-sm"
          onClick={() => {
            setZoom(1);
            setPan({ x: 0, y: 0 });
          }}
        >
          Reset
        </button>
      </div>
    </div>
  );
}
