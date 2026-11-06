import { CartesianGrid, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Detail, DetailPoint } from '../api';

type Key = 'pulse' | 'rmssd' | 'stress' | 'breath' | 'sleep' | 'feel';

const CHARTS: { key: Key; title: string; unit: string; explain: string; domain?: [number, number] }[] = [
  { key: 'pulse', title: 'Resting pulse', unit: 'bpm', explain: 'Higher than usual can mean a harder day.' },
  { key: 'rmssd', title: 'HRV (RMSSD)', unit: '', explain: 'Lower than usual can mean a harder day.' },
  { key: 'stress', title: 'Stress index', unit: '', explain: 'Only meaningful against their own usual.' },
  { key: 'breath', title: 'Breathing rate', unit: '/min', explain: 'Higher than usual can mean a harder day.' },
  { key: 'sleep', title: 'Sleep', unit: 'h', explain: 'As they reported it.', domain: [0, 12] },
  { key: 'feel', title: 'How they feel', unit: '/5', explain: 'As they reported it.', domain: [1, 5] },
];

const short = (date: string): string => {
  const d = new Date(`${date}T12:00:00`);
  return `${d.getDate()}/${d.getMonth() + 1}`;
};

function Chart({ detail, spec }: { detail: Detail; spec: (typeof CHARTS)[number] }) {
  const range = detail.usual[spec.key];
  const values = detail.points.map((p: DetailPoint) => p[spec.key]).filter((v): v is number => v !== null);
  if (!values.length) return null;
  const latest = values.at(-1)!;
  const lo = Math.min(...values, range?.low ?? Infinity);
  const hi = Math.max(...values, range?.high ?? -Infinity);
  const pad = Math.max((hi - lo) * 0.15, 1);
  const domain: [number, number] = spec.domain ?? [Math.floor(lo - pad), Math.ceil(hi + pad)];
  // Even, whole-number ticks: the automatic ones came out uneven against the shaded band.
  const ticks = spec.key === 'feel' ? [1, 2, 3, 4, 5] : [domain[0], Math.round((domain[0] + domain[1]) / 2), domain[1]];
  // The same facts as the chart, for people who can't see it.
  const summary = `${spec.title}: latest ${Math.round(latest * 10) / 10}${spec.unit ? ` ${spec.unit}` : ''}${
    range ? `, usual range ${Math.round(range.low)} to ${Math.round(range.high)}` : ''
  }, over the last 28 days.`;
  return (
    <figure className="m-0" data-testid={`chart-${spec.key}`}>
      <figcaption className="flex items-baseline justify-between gap-2">
        <span className="font-display font-bold">{spec.title}</span>
        <span className="text-xs text-mute">{spec.explain}</span>
      </figcaption>
      <p className="sr-only">{summary}</p>
      <div className="h-32" aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart accessibilityLayer={false} data={detail.points} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
            <CartesianGrid vertical={false} stroke="#2B2A6B" strokeOpacity={0.08} />
            {range && <ReferenceArea y1={range.low} y2={range.high} fill="#3FB8AF" fillOpacity={0.22} stroke="none" ifOverflow="hidden" />}
            <XAxis dataKey="date" tickFormatter={short} minTickGap={36} tick={{ fontSize: 11, fill: '#5B5A7D' }} tickLine={false} axisLine={false} />
            <YAxis domain={domain} ticks={ticks} allowDecimals={false} tick={{ fontSize: 11, fill: '#5B5A7D' }} tickLine={false} axisLine={false} width={44} />
            <Tooltip
              labelFormatter={(d) => String(d)}
              formatter={(v) => [`${v}${spec.unit ? ` ${spec.unit}` : ''}`, spec.title]}
              contentStyle={{ border: '2px solid #2B2A6B', borderRadius: 10, fontSize: 12 }}
            />
            <Line
              type="monotone"
              dataKey={spec.key}
              stroke="#2B2A6B"
              strokeWidth={2.2}
              dot={{ r: 2, fill: '#2B2A6B' }}
              activeDot={{ r: 4, fill: '#FF6B5B' }}
              connectNulls={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

export default function Trends({ detail }: { detail: Detail }) {
  const anything = detail.points.some((p) => p.pulse !== null || p.feel !== null);
  return (
    <section aria-labelledby="trends" className="card mt-4 p-5">
      <h2 id="trends" className="text-xl">
        Last 28 days
      </h2>
      <p className="text-xs text-mute">Shaded band is their usual range. Gaps are mornings with no check-in or no good reading.</p>
      {anything ? (
        <div className="mt-3 space-y-4">
          {CHARTS.map((spec) => (
            <Chart key={spec.key} detail={detail} spec={spec} />
          ))}
        </div>
      ) : (
        <p className="mt-3 text-mute">No check-ins yet.</p>
      )}
    </section>
  );
}
