/**
 * Phase 0 tool: shows live numbers from the sidecar and records the five reference sessions.
 * Standalone from the game, so it works while the game is being changed.
 */
import { LiveSource, SignalBus, type VitalsFrame, type WebSocketLike } from '@hush/signals';
import { FrameCapture } from './frameCapture';

const SESSIONS = [
  { name: 'calm_60s', secs: 60, how: 'Sit still, breathe normally.' },
  { name: 'post_exercise_60s', secs: 60, how: 'Do 30 jumping jacks, sit down, then press Record.' },
  {
    name: 'flinch_whisper_60s',
    secs: 60,
    how: 'Look away, talk, and fake a few flinches. Note the times if you can.',
  },
  { name: 'low_light_30s', secs: 30, how: 'Turn the lights down first. Keep your face in view.' },
  { name: 'slow_breathing_60s', secs: 60, how: 'Breathe at 6 breaths a minute: 4 s in, 6 s out.' },
];

const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const status = byId('status');
const numbers = byId('numbers');
const preview = byId<HTMLVideoElement>('preview');

let capture: FrameCapture | null = null;
let source: LiveSource | null = null;
let latest: VitalsFrame | null = null;
let ticker = 0;
let fps = '';
let sdkState = '';
let hint = '';

const ready = (): boolean =>
  !!latest?.pulse && latest.pulse.conf >= 0.4 && !!latest.breath && latest.breath.conf >= 0.45;

function refresh(): void {
  status.textContent = `SDK: ${sdkState || 'waiting'} · camera: ${fps || 'off'}${hint ? ` · ${hint}` : ''}`;
  if (latest) {
    numbers.textContent = JSON.stringify(
      {
        t: latest.t,
        pulse: latest.pulse,
        breath: latest.breath,
        hrv: latest.hrv,
        talking: latest.talking,
        blink: latest.blink,
        head: latest.head,
        expression: latest.expression,
        quality: latest.quality,
        plethSamples: latest.pleth?.samples.length,
        plethHz: latest.pleth?.hz,
        traceSamples: latest.breathTrace?.samples.length,
        traceHz: latest.breathTrace?.hz,
        traceStable: latest.breathTrace?.stable,
      },
      null,
      1,
    );
  }
  document.querySelectorAll<HTMLButtonElement>('button[data-session]').forEach((b) => {
    b.disabled = !ready();
  });
}

function renderSessions(): void {
  const table = byId('sessions');
  for (const s of SESSIONS) {
    const row = document.createElement('tr');
    const name = document.createElement('td');
    name.textContent = s.name;
    const how = document.createElement('td');
    how.textContent = s.how;
    const action = document.createElement('td');
    const button = document.createElement('button');
    button.textContent = 'Record';
    button.disabled = true;
    button.dataset.session = s.name;
    button.onclick = () => source?.send({ type: 'record', name: s.name, secs: s.secs });
    action.append(button);
    row.append(name, how, action);
    table.append(row);
  }
}

byId<HTMLButtonElement>('start').onclick = async () => {
  byId<HTMLButtonElement>('start').disabled = true;
  byId<HTMLButtonElement>('stop').disabled = false;
  const bus = new SignalBus();
  bus.subscribe((frame) => {
    latest = frame;
  });
  source = new LiveSource({
    socketFactory: (url) => new WebSocket(url) as unknown as WebSocketLike,
    onEvent: (event) => {
      if (event.type === 'status')
        sdkState = event.detail ? `${event.state}: ${event.detail}` : event.state;
      if (event.type === 'validation') hint = event.code === 0 ? '' : event.hint;
      if (event.type === 'error') sdkState = `error ${event.code}: ${event.message}`;
      if (event.type === 'recording') {
        sdkState =
          event.state === 'saved'
            ? `Saved ${event.name} (${event.frames} frames)`
            : `Recording ${event.name}...`;
      }
    },
  });
  source.start(bus);
  ticker = window.setInterval(() => {
    source?.advance(250);
    refresh();
  }, 250);
  try {
    capture = new FrameCapture();
    capture.onStats = (stats) => {
      fps = `${stats.fps} fps${stats.dropped ? `, ${stats.dropped} dropped` : ''}`;
    };
    await capture.start();
    preview.srcObject = capture.mediaStream;
    preview.hidden = false;
    await preview.play();
  } catch (err) {
    sdkState = `Camera error: ${(err as Error).message || (err as Error).name}`;
    refresh();
  }
};

byId<HTMLButtonElement>('stop').onclick = () => {
  capture?.stop();
  source?.stop();
  window.clearInterval(ticker);
  preview.hidden = true;
  byId<HTMLButtonElement>('start').disabled = false;
  byId<HTMLButtonElement>('stop').disabled = true;
  status.textContent = 'Stopped';
};

renderSessions();
