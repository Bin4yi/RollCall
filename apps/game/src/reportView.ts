import type { RunLog } from '@hush/engine';
import {
  computeStats,
  earnedBadges,
  isCleanNarration,
  narrationPrompt,
  STAT_DEFINITIONS,
  templateNarration,
  timelineMarkers,
  type ReportStats,
} from '@hush/report';
import badgeConfig from '../../../config/badges.json';
import type { AssetRegistry } from './assets';
import type { Settings } from './settings';

const W = 1040;
const H = 300;
const PAD = { l: 44, r: 44, t: 16, b: 28 };

const COLORS = { pulse: '#a32417', breath: '#1f5f8b', noise: '#2b2519' };

function drawChart(canvas: HTMLCanvasElement, log: RunLog, cursor: number | null): void {
  const g = canvas.getContext('2d')!;
  const ratio = canvas.width / W;
  g.setTransform(ratio, 0, 0, ratio, 0, 0);
  g.clearRect(0, 0, W, H);
  const samples = log.samples;
  const end = Math.max(1, log.durationSeconds);
  const x = (t: number): number => PAD.l + (t / end) * (W - PAD.l - PAD.r);
  const plotH = H - PAD.t - PAD.b;
  const y = (share: number): number => PAD.t + plotH * (1 - share);

  // Encounter bands.
  g.fillStyle = 'rgba(163, 36, 23, 0.1)';
  let start: number | null = null;
  for (const s of samples) {
    if (s.searching && start === null) start = s.t;
    if (!s.searching && start !== null) {
      g.fillRect(x(start), PAD.t, x(s.t) - x(start), plotH);
      start = null;
    }
  }
  if (start !== null) g.fillRect(x(start), PAD.t, x(end) - x(start), plotH);

  // Time axis.
  g.fillStyle = '#2b2519';
  g.font = '12px monospace';
  g.textAlign = 'center';
  const stepS = end > 600 ? 120 : end > 240 ? 60 : 30;
  for (let t = 0; t <= end; t += stepS) {
    g.fillText(`${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`, x(t), H - 9);
    g.strokeStyle = 'rgba(43,37,25,0.14)';
    g.beginPath();
    g.moveTo(x(t), PAD.t);
    g.lineTo(x(t), PAD.t + plotH);
    g.stroke();
  }

  const series = (
    pick: (s: RunLog['samples'][number]) => number | null,
    lo: number,
    hi: number,
    color: string,
    dash: number[],
  ): void => {
    g.strokeStyle = color;
    g.lineWidth = 2;
    g.setLineDash(dash);
    g.beginPath();
    let open = false;
    for (const s of samples) {
      const v = pick(s);
      if (v === null) {
        open = false;
        continue;
      }
      const py = y(Math.max(0, Math.min(1, (v - lo) / (hi - lo))));
      if (open) g.lineTo(x(s.t), py);
      else g.moveTo(x(s.t), py);
      open = true;
    }
    g.stroke();
    g.setLineDash([]);
  };
  const pulses = samples.flatMap((s) => (s.pulse === null ? [] : [s.pulse]));
  const pulseLo = Math.min(50, ...pulses);
  const pulseHi = Math.max(120, ...pulses);
  const breaths = samples.flatMap((s) => (s.breath === null ? [] : [s.breath]));
  const breathHi = Math.max(30, ...breaths);
  // Different dashes keep the three lines readable without relying on colour.
  series((s) => s.pulse, pulseLo, pulseHi, COLORS.pulse, []);
  series((s) => s.breath, 0, breathHi, COLORS.breath, [7, 4]);
  series((s) => s.noise, 0, 1.5, COLORS.noise, [2, 3]);

  g.fillStyle = COLORS.pulse;
  g.textAlign = 'left';
  g.fillText(`${Math.round(pulseHi)}`, 6, PAD.t + 10);
  g.fillText(`${Math.round(pulseLo)}`, 6, PAD.t + plotH);
  g.fillStyle = COLORS.breath;
  g.textAlign = 'right';
  g.fillText(`${Math.round(breathHi)}`, W - 6, PAD.t + 10);
  g.fillText('0', W - 6, PAD.t + plotH);

  for (const m of timelineMarkers(log)) {
    g.strokeStyle = '#2b2519';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x(m.t), PAD.t);
    g.lineTo(x(m.t), PAD.t + 9);
    g.stroke();
  }
  if (cursor !== null) {
    g.strokeStyle = '#000';
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(x(cursor), PAD.t);
    g.lineTo(x(cursor), PAD.t + plotH);
    g.stroke();
  }
}

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  Object.assign(node, props);
  node.append(...children);
  return node;
};

const fmtTime = (t: number): string =>
  `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

function stat(label: string, value: string, definition: string): HTMLElement {
  // The definition is visible text as well as a tooltip, so it also works without a mouse.
  return el(
    'div',
    { className: 'stat', title: definition },
    el('b', { textContent: value }),
    label,
    el('small', { textContent: definition }),
  );
}

function statCards(stats: ReportStats): HTMLElement[] {
  return [
    stat(
      'Peak pulse rise',
      stats.peakPulseRise === null ? 'n/a' : `+${Math.round(stats.peakPulseRise)} bpm`,
      STAT_DEFINITIONS.peakPulseRise!,
    ),
    stat(
      'Recovery',
      stats.averageRecoverySeconds === null
        ? 'n/a'
        : `${Math.round(stats.averageRecoverySeconds)} s`,
      STAT_DEFINITIONS.recovery!,
    ),
    stat(
      'Steady breathing',
      `${Math.round(stats.longestSteadySeconds)} s`,
      STAT_DEFINITIONS.steady!,
    ),
    stat('Stillness', `${Math.round(stats.stillnessPercent)}%`, STAT_DEFINITIONS.stillness!),
    stat(
      'Encounters survived',
      `${stats.encountersSurvived} / ${stats.encounters.length}`,
      STAT_DEFINITIONS.survived!,
    ),
  ];
}

function download(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Optional local LLM. Only numbers go in, only localhost is contacted, and output is filtered. */
async function askOllama(prompt: string): Promise<string | null> {
  try {
    const res = await fetch('http://127.0.0.1:11434/api/generate', {
      method: 'POST',
      body: JSON.stringify({ model: 'gemma3', prompt, stream: false }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    const { response } = (await res.json()) as { response?: string };
    return response?.trim() || null;
  } catch {
    return null;
  }
}

function exportPng(
  log: RunLog,
  stats: ReportStats,
  chart: HTMLCanvasElement,
  narration: string,
): void {
  const canvas = el('canvas', { width: 1200, height: 800 });
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#e9dfc6';
  g.fillRect(0, 0, 1200, 800);
  g.fillStyle = '#2b2519';
  g.font = 'bold 30px monospace';
  g.fillText('KESTREL STATION 7 · INCIDENT REPORT', 50, 60);
  g.font = 'bold 26px monospace';
  g.fillStyle = log.outcome === 'escaped' ? '#1f5f8b' : '#a32417';
  g.fillText(log.outcome === 'escaped' ? 'SURVIVED' : 'HEARD', 50, 100);
  g.fillStyle = '#2b2519';
  g.font = '20px monospace';
  g.fillText(`Calm Under Fire: ${stats.score} / 100 (a game score, not a health measure)`, 50, 138);
  g.drawImage(chart, 50, 160, 1100, Math.round((1100 * H) / W));
  g.font = '20px monospace';
  const rows = [
    `Peak pulse rise: ${stats.peakPulseRise === null ? 'n/a' : `+${Math.round(stats.peakPulseRise)} bpm`}`,
    `Recovery: ${stats.averageRecoverySeconds === null ? 'n/a' : `${Math.round(stats.averageRecoverySeconds)} s`}`,
    `Steady breathing: ${Math.round(stats.longestSteadySeconds)} s`,
    `Stillness: ${Math.round(stats.stillnessPercent)}%`,
    `Encounters survived: ${stats.encountersSurvived} / ${stats.encounters.length}`,
  ];
  rows.forEach((row, i) => g.fillText(row, 50, 510 + i * 30));
  g.font = 'italic 18px monospace';
  const words = narration.split(' ');
  let line = '';
  let ly = 680;
  for (const word of words) {
    if (g.measureText(`${line} ${word}`).width > 1100) {
      g.fillText(line, 50, ly);
      ly += 26;
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  g.fillText(line, 50, ly);
  canvas.toBlob((blob) => {
    if (blob) download('hush-report.png', blob);
  });
}

export function showReport(
  host: HTMLElement,
  log: RunLog,
  assets: AssetRegistry,
  settings: Settings,
  sessionJsonl: () => string,
  sourceLabel: string,
  onDone: () => void,
): void {
  const stats = computeStats(log);
  const badges = earnedBadges(log, stats);
  const screen = el('div', { className: 'screen report-screen' });
  screen.dataset.testid = 'report';
  const bg = assets.url('report_bg_wide');
  if (bg) screen.style.backgroundImage = `url(${bg})`;

  const stampUrl = assets.url(log.outcome === 'escaped' ? 'stamp_survived' : 'stamp_heard');
  const page = el('article', { className: 'report' });
  page.append(
    el('h1', { textContent: 'Incident Report · Kestrel Station 7' }),
    el('p', {
      textContent: `Outcome: ${log.outcome === 'escaped' ? 'SURVIVED' : 'HEARD'} · Duration ${fmtTime(log.durationSeconds)} · Source: ${sourceLabel}`,
    }),
  );
  if (stampUrl)
    page.append(
      el('img', {
        className: 'stamp',
        src: stampUrl,
        alt: log.outcome === 'escaped' ? 'Stamp: survived' : 'Stamp: heard',
      }),
    );
  if (log.baseline && !log.baseline.measured) {
    page.append(
      el('p', {
        className: 'notice',
        textContent:
          'No reliable baseline could be measured on this run, so typical values were used.',
      }),
    );
  }

  const chart = el('canvas', { width: W * 2, height: H * 2 });
  chart.setAttribute('role', 'img');
  chart.setAttribute(
    'aria-label',
    `Timeline of pulse, breathing and noise over ${fmtTime(log.durationSeconds)}. Peak pulse rise ${stats.peakPulseRise === null ? 'unknown' : `${Math.round(stats.peakPulseRise)} bpm`}.`,
  );
  drawChart(chart, log, null);
  const info = el('p', {
    className: 'marker-info',
    textContent: 'Drag the slider or pick an event to read that moment.',
  });
  const slider = el('input', {
    type: 'range',
    min: '0',
    max: String(log.durationSeconds),
    step: '0.5',
    value: '0',
  });
  slider.setAttribute('aria-label', 'Scrub the timeline');
  const show = (t: number, extra?: string): void => {
    slider.value = String(t);
    drawChart(chart, log, t);
    const s = log.samples.find((x) => x.t >= t) ?? log.samples.at(-1);
    const parts = [fmtTime(t)];
    if (s?.pulse != null) parts.push(`pulse ${Math.round(s.pulse)} bpm`);
    if (s?.breath != null) parts.push(`breathing ${Math.round(s.breath)}/min`);
    if (s) parts.push(`noise ${s.noise.toFixed(2)}`);
    info.textContent = (extra ? `${extra} ` : '') + parts.join(' · ');
  };
  slider.oninput = () => show(Number(slider.value));
  const markers = el('div', { className: 'markers' });
  for (const m of timelineMarkers(log)) {
    const b = el('button', { textContent: `${fmtTime(m.t)} ${m.label}` });
    b.onclick = () => show(m.t, m.description);
    markers.append(b);
  }
  page.append(
    el('h2', { textContent: 'Timeline' }),
    el(
      'div',
      { className: 'legend' },
      el('span', { textContent: '━ Pulse (left scale)' }),
      el('span', { textContent: '╍ Breathing (right scale)' }),
      el('span', { textContent: '┅ Noise' }),
      el('span', { textContent: '▒ Shaded: encounter' }),
    ),
    chart,
    slider,
    info,
    markers,
    el('h2', { textContent: 'Readings' }),
    el('div', { className: 'stats' }, ...statCards(stats)),
    el('h2', { textContent: `Calm Under Fire: ${stats.score} / 100` }),
    el('p', {
      className: 'notice',
      title: STAT_DEFINITIONS.score!,
      textContent: `${STAT_DEFINITIONS.score} This run: ${stats.scoreParts.map((p) => `${p.label} ${p.points}/${p.max}`).join(', ')}.`,
    }),
  );

  const narrationEl = el('p', {
    className: 'narration',
    textContent: templateNarration(log, stats),
  });
  page.append(el('h2', { textContent: 'Field notes' }), narrationEl);
  if (settings.ollama) {
    void askOllama(narrationPrompt(log, stats)).then((text) => {
      if (text && isCleanNarration(text)) narrationEl.textContent = text;
    });
  }

  const earned = badgeConfig.badges.filter((b) => badges.includes(b.id));
  page.append(
    el('h2', { textContent: `Badges (${earned.length} of ${badgeConfig.badges.length})` }),
  );
  if (earned.length) {
    page.append(
      el(
        'div',
        { className: 'badges' },
        ...earned.map((b) => {
          const url = assets.url(b.asset);
          return el(
            'figure',
            { title: b.description },
            ...(url ? [el('img', { src: url, alt: '' })] : []),
            el('figcaption', { textContent: b.name }),
          );
        }),
      ),
    );
  } else {
    page.append(el('p', { textContent: 'None this time.' }));
  }

  const exportPngButton = el('button', { textContent: 'Save report as PNG' });
  exportPngButton.onclick = () => exportPng(log, stats, chart, narrationEl.textContent ?? '');
  const exportSession = el('button', { textContent: 'Save session (.jsonl)' });
  exportSession.onclick = () =>
    download('hush-session.jsonl', new Blob([sessionJsonl()], { type: 'text/plain' }));
  const again = el('button', { textContent: 'Back to title' });
  again.dataset.testid = 'report-done';
  again.onclick = onDone;
  page.append(
    el('div', { className: 'row' }, exportPngButton, exportSession, again),
    el('p', {
      className: 'notice',
      textContent:
        'Saved files stay on this computer. Readings are estimates for gameplay. HUSH is not a medical device.',
    }),
  );

  screen.append(page);
  host.replaceChildren(screen);
}
