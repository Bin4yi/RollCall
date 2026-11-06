import {
  autopilot,
  HIDE_SPOTS,
  Run,
  TAPE_ROOMS,
  type DifficultyName,
  type EngineConfig,
  type Room,
  type RunEvent,
} from '@hush/engine';
import {
  LiveSource,
  parseSession,
  Recorder,
  ReplaySource,
  SignalBus,
  SimSource,
  type SidecarEvent,
  type SignalSource,
  type WebSocketLike,
} from '@hush/signals';
import difficultyJson from '../../../config/difficulty.json';
import linesJson from '../../../config/lines.json';
import { AssetRegistry } from './assets';
import { GameAudio, Whisperer } from './audio';
import { CONSENT_POINTS, DISCLAIMER, ROOM_NAMES, SETUP_TIPS } from './copy';
import { FrameCapture } from './frameCapture';
import { numberToWords } from './manifest';
import { showReport } from './reportView';
import { GameScene, MONITOR_ROOMS, PRELOAD_IDS, type Hotspot } from './scene';
import { loadSettings, saveSettings } from './settings';

const config = difficultyJson as unknown as EngineConfig;
const STEP_MS = 100;
const REPLAYS = [
  'judge_tour_900s',
  'calm_60s',
  'slow_breathing_60s',
  'post_exercise_60s',
  'flinch_whisper_60s',
  'low_light_30s',
];
const params = new URLSearchParams(location.search);
/** Test hooks. `speed` multiplies game time; `bot` plays automatically. */
const SPEED = Math.max(1, Number(params.get('speed')) || 1);
const BOT = params.has('bot');

const ui = document.getElementById('ui')!;
const settings = loadSettings();
const assets = new AssetRegistry();
const scene = new GameScene(assets);
const audio = new GameAudio(settings);
const whisper = new Whisperer(settings);

type SourceChoice = { kind: 'sim' } | { kind: 'replay'; name: string } | { kind: 'live' };

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { dataset?: Record<string, string> } = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] => {
  const { dataset, ...rest } = props;
  const node = document.createElement(tag);
  Object.assign(node, rest);
  if (dataset) Object.assign(node.dataset, dataset);
  node.append(...children);
  return node;
};
const button = (text: string, onclick: () => void, className = ''): HTMLButtonElement =>
  el('button', { textContent: text, onclick, className });

let session: GameSession | null = null;
let idleRoom: Room = 'desk';

// ---------------------------------------------------------------- menus

function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}

function showTitle(): void {
  session = null;
  scene.setHudVisible(false);
  scene.setHotspots([]);
  idleRoom = 'desk';
  const screen = el('div', { className: 'screen title-screen' });
  const art = assets.firstUrl('keyart_wide', 'station_plate', 'bg_security_desk');
  if (art) screen.style.backgroundImage = `url(${art})`;
  const logo = assets.url('ui_logo');
  if (logo) screen.append(el('img', { className: 'title-logo', src: logo, alt: 'HUSH' }));
  else screen.append(el('h1', { textContent: 'HUSH' }));
  const menuItem = (
    label: string,
    hint: string,
    go: () => void,
    testid: string,
  ): HTMLButtonElement => {
    const b = el(
      'button',
      { onclick: go, dataset: { testid } },
      label,
      el('small', { textContent: hint }),
    );
    return b;
  };
  screen.append(
    el('p', { className: 'title-tag', textContent: 'It hears your heart.' }),
    el(
      'div',
      { className: 'title-menu' },
      menuItem(
        'Play with camera',
        'Live pulse and breathing from your webcam',
        () => begin({ kind: 'live' }),
        'play-live',
      ),
      menuItem(
        'Judge Mode',
        'No camera or key. Plays a bundled, labelled demo signal',
        () => begin({ kind: 'replay', name: 'judge_tour_900s' }),
        'judge',
      ),
      menuItem(
        'Keyboard simulation',
        'Control the signals by hand',
        () => begin({ kind: 'sim' }),
        'play-sim',
      ),
      menuItem('Replay a session', 'Pick a recorded session', showReplayPicker, 'replay'),
      menuItem(
        'Settings',
        'Difficulty, Gentle Mode, audio, accessibility',
        showSettings,
        'settings',
      ),
    ),
    el('p', { className: 'notice', textContent: DISCLAIMER }),
  );
  ui.replaceChildren(screen);
}

function showReplayPicker(): void {
  const list = el('div', { className: 'row' });
  for (const name of REPLAYS) list.append(button(name, () => begin({ kind: 'replay', name })));
  ui.replaceChildren(
    el(
      'div',
      { className: 'screen' },
      el(
        'div',
        { className: 'card' },
        el('h2', { textContent: 'Replay a session' }),
        el('p', {
          textContent:
            'Your own recordings are used when present. Otherwise these play synthetic stand-ins, labelled as such.',
        }),
        list,
        el('div', { className: 'row' }, button('Back', showTitle)),
      ),
    ),
  );
}

function showSettings(): void {
  const save = (): void => {
    saveSettings(settings);
    audio.applyVolumes();
  };
  const check = (
    label: string,
    key: 'gentle' | 'subtitles' | 'debug' | 'webcamPreview' | 'ollama',
    hint?: string,
  ): HTMLElement => {
    const input = el('input', { type: 'checkbox', checked: settings[key] });
    input.onchange = () => {
      settings[key] = input.checked;
      save();
    };
    return el(
      'label',
      { className: 'field' },
      el(
        'span',
        {},
        label,
        ...(hint ? [el('div', { className: 'notice', textContent: hint })] : []),
      ),
      input,
    );
  };
  const slider = (label: string, key: 'master' | 'voice' | 'heartbeat'): HTMLElement => {
    const input = el('input', {
      type: 'range',
      min: '0',
      max: '1',
      step: '0.05',
      value: String(settings[key]),
    });
    input.oninput = () => {
      settings[key] = Number(input.value);
      save();
    };
    return el('label', { className: 'field' }, label, input);
  };
  const difficulty = el(
    'select',
    {},
    ...(['calm', 'standard', 'iceCold'] as DifficultyName[]).map((d) =>
      el('option', {
        value: d,
        textContent: { calm: 'Calm', standard: 'Standard', iceCold: 'Ice Cold' }[d],
        selected: settings.difficulty === d,
      }),
    ),
  );
  difficulty.onchange = () => {
    settings.difficulty = difficulty.value as DifficultyName;
    save();
  };
  ui.replaceChildren(
    el(
      'div',
      { className: 'screen' },
      el(
        'div',
        { className: 'card' },
        el('h2', { textContent: 'Settings' }),
        el('label', { className: 'field' }, 'Difficulty', difficulty),
        check('Gentle Mode', 'gentle', 'No sudden sounds, a slower Listener and longer gaps.'),
        check('Subtitles', 'subtitles'),
        slider('Master volume', 'master'),
        slider('Voice volume', 'voice'),
        slider('Heartbeat volume', 'heartbeat'),
        check('Debug overlay (F3)', 'debug'),
        check('Webcam preview', 'webcamPreview', 'Off by default. Live mode only.'),
        check(
          'Local report notes',
          'ollama',
          'Asks Ollama on this computer to write the report notes from your numbers. Never sends video.',
        ),
        el('div', { className: 'row' }, button('Back', showTitle, 'primary')),
      ),
    ),
  );
}

function begin(choice: SourceChoice): void {
  audio.start();
  if (choice.kind === 'live') {
    if (!settings.consented) showConsent(() => showSetupTips(() => void startRun(choice)));
    else showSetupTips(() => void startRun(choice));
    return;
  }
  void startRun(choice);
}

function showConsent(next: () => void): void {
  ui.replaceChildren(
    el(
      'div',
      { className: 'screen' },
      el(
        'div',
        { className: 'card' },
        el('h2', { textContent: 'Before the camera turns on' }),
        el('ul', {}, ...CONSENT_POINTS.map((p) => el('li', { textContent: p }))),
        el('p', { className: 'notice', textContent: DISCLAIMER }),
        el(
          'div',
          { className: 'row' },
          button(
            'Allow camera',
            () => {
              settings.consented = true;
              saveSettings(settings);
              next();
            },
            'primary',
          ),
          button('No thanks', showTitle),
        ),
      ),
    ),
  );
}

function showSetupTips(next: () => void): void {
  ui.replaceChildren(
    el(
      'div',
      { className: 'screen' },
      el(
        'div',
        { className: 'card' },
        el('h2', { textContent: 'Set up your space' }),
        el('ul', {}, ...SETUP_TIPS.map((p) => el('li', { textContent: p }))),
        el(
          'div',
          { className: 'row' },
          button('Ready', next, 'primary'),
          button('Back', showTitle),
        ),
      ),
    ),
  );
}

const TUTORIAL = [
  {
    art: 'tut_still',
    title: 'Sit still',
    text: "It can't see, but it hears you move. Hands on the mouse are fine. Keep your head and shoulders quiet.",
  },
  {
    art: 'tut_light',
    title: 'Face the light',
    text: "Your camera reads your pulse and breathing. If I can't see you, it can't hear you, and I'll tell you what to fix. Bad light never counts against you.",
  },
  {
    art: 'tut_breathe',
    title: 'Breathe slow',
    text: "When it stands over you, breathe slowly and evenly. Follow my wings. Don't hold your breath: that won't help.",
  },
];

function showTutorial(index: number, done: () => void): void {
  const card = TUTORIAL[index];
  if (!card) {
    settings.tutorialSeen = true;
    saveSettings(settings);
    done();
    return;
  }
  const art = assets.url(card.art);
  ui.replaceChildren(
    el(
      'div',
      { className: 'screen' },
      el(
        'div',
        { className: 'card tutorial' },
        ...(art ? [el('img', { src: art, alt: '' })] : []),
        el(
          'div',
          {},
          el('h2', { textContent: card.title }),
          el('p', { textContent: card.text }),
          el(
            'div',
            { className: 'row' },
            button(
              index === TUTORIAL.length - 1 ? 'Begin' : 'Next',
              () => showTutorial(index + 1, done),
              'primary',
            ),
          ),
        ),
      ),
    ),
  );
}

// ---------------------------------------------------------------- run

async function loadReplay(name: string): Promise<{ source: ReplaySource; synthetic: boolean }> {
  // Vite's dev server answers unknown paths with index.html, so check it's really a session.
  const tryFetch = async (path: string): Promise<string | null> => {
    const res = await fetch(path);
    if (!res.ok) return null;
    const text = await res.text();
    return text.trimStart().startsWith('{') ? text : null;
  };
  const real = await tryFetch(`/sessions/${name}.jsonl`);
  const text = real ?? (await tryFetch(`/sessions/synthetic/${name}.jsonl`));
  if (!text) throw new Error(`Session ${name} not found`);
  const { frames } = parseSession(text);
  const label = real ? name : `${name} (synthetic)`;
  return { source: new ReplaySource(label, frames, true), synthetic: !real };
}

async function startRun(choice: SourceChoice): Promise<void> {
  let source: SignalSource;
  let capture: FrameCapture | null = null;
  const sidecarEvents: { handler: ((e: SidecarEvent) => void) | null } = { handler: null };
  try {
    if (choice.kind === 'sim') source = new SimSource(Date.now() & 0xffff);
    else if (choice.kind === 'replay') source = (await loadReplay(choice.name)).source;
    else {
      source = new LiveSource({
        socketFactory: (url) => new WebSocket(url) as unknown as WebSocketLike,
        onEvent: (e) => sidecarEvents.handler?.(e),
      });
      if (FrameCapture.supported) {
        capture = new FrameCapture();
        await capture.start();
      }
    }
  } catch (err) {
    showProblem((err as Error).message);
    return;
  }
  const start = (): void => {
    session = new GameSession(source, capture);
    sidecarEvents.handler = (e) => session?.onSidecar(e);
    session.start();
  };
  // Signals start now, so the SDK's 30 s breathing window fills during the tutorial.
  if (settings.tutorialSeen || BOT) start();
  else {
    const bus = new SignalBus();
    source.start(bus);
    const warm = window.setInterval(() => source.advance(250), 250);
    showTutorial(0, () => {
      window.clearInterval(warm);
      source.stop();
      start();
    });
  }
}

function showProblem(message: string): void {
  ui.replaceChildren(
    el(
      'div',
      { className: 'screen' },
      el(
        'div',
        { className: 'card' },
        el('h2', { textContent: 'Live mode could not start' }),
        el('p', { textContent: message }),
        el('p', {
          textContent:
            'Live mode needs the camera allowed, pnpm sidecar running, and an API key in .env. Judge Mode and the keyboard simulation need neither.',
        }),
        el('div', { className: 'row' }, button('Back', showTitle, 'primary')),
      ),
    ),
  );
}

function pick<T>(lines: T[]): T {
  return pickRandom(lines);
}

class GameSession {
  readonly bus = new SignalBus();
  readonly recorder = new Recorder();
  readonly run: Run;
  private carry = 0;
  private paused = false;
  private ended = false;
  private hudLayer = el('div');
  private badge = el('div', { className: 'badge' });
  private objectives = el('div', { className: 'objectives' });
  private actions = el('div', { className: 'actions' });
  private subtitles = el('div', { className: 'subtitle' });
  private weak = el('div', { className: 'signal-weak', hidden: true });
  private debug = el('div', { className: 'debug', hidden: true });
  private calibration: HTMLElement | null = null;
  private calibrationBar = el('div');
  private calibrationHint = el('p', { className: 'notice' });
  private webcam: HTMLVideoElement | null = null;
  private sidecarProblem: string | null = null;
  private lastActionsKey = '';
  private lastSpotsKey = '';
  private tapeLine = 0;
  private tapeClock = 0;
  private lullCooldown = 0;
  private whisperCooldown = 0;
  private pulseSaid = false;
  private lastBreathReminder = false;
  private lastPaused = false;
  private lastSuspicion = 0;
  private overlay: HTMLElement | null = null;

  constructor(
    private readonly source: SignalSource,
    private readonly capture: FrameCapture | null,
  ) {
    this.run = new Run(config, {
      difficulty: settings.difficulty,
      seed: Number(params.get('seed')) || Date.now() & 0xffffff,
      gentle: settings.gentle,
    });
    this.bus.subscribe((frame) => {
      this.run.ingest(frame);
      scene.ingest(frame);
      audio.ingest(frame);
      this.recorder.add(frame);
    });
  }

  start(): void {
    this.source.start(this.bus);
    scene.setHudVisible(true);
    scene.setMonitor(null);
    const label = this.source.label;
    this.badge.textContent = label;
    if (this.source.kind === 'live') this.badge.classList.add('live');
    this.badge.dataset.testid = 'source-badge';

    this.hudLayer = el(
      'div',
      {},
      el('div', { className: 'hud-top' }, this.badge, this.objectives),
      this.weak,
      this.debug,
      this.actions,
      this.subtitles,
    );
    this.calibrationBar.style.width = '0%';
    this.calibration = el(
      'div',
      { className: 'calibration', dataset: { testid: 'calibration' } },
      el(
        'div',
        { className: 'card' },
        el('h2', { textContent: 'The Security Desk' }),
        el('p', { textContent: linesJson.lull.calibrate }),
        el('div', { className: 'progress' }, this.calibrationBar),
        this.calibrationHint,
      ),
    );
    ui.replaceChildren(this.hudLayer, this.calibration);
    if (this.capture?.mediaStream && settings.webcamPreview) {
      this.webcam = el('video', {
        className: 'webcam',
        muted: true,
        autoplay: true,
        srcObject: this.capture.mediaStream,
      });
      this.hudLayer.append(this.webcam);
    }
    this.renderObjectives();
    this.debug.hidden = !settings.debug;
  }

  onSidecar(event: SidecarEvent): void {
    if (
      event.type === 'status' &&
      event.detail &&
      ['no-key', 'sdk-missing', 'start-timeout', 'failed'].includes(event.state)
    ) {
      this.sidecarProblem = event.detail;
    }
    if (event.type === 'status' && event.state === 'running') this.sidecarProblem = null;
    if (event.type === 'error') this.sidecarProblem = event.message;
  }

  update(dtMs: number): void {
    if (this.ended) return;
    const dt = dtMs / 1000;
    if (!this.paused) {
      this.carry += dtMs * SPEED;
      while (this.carry >= STEP_MS && !this.run.finished) {
        this.carry -= STEP_MS;
        this.source.advance(STEP_MS);
        // Without a sidecar there's nothing to calibrate from, so wait rather than time out.
        if (
          this.source.kind === 'live' &&
          this.run.phase === 'calibrating' &&
          this.source.status !== 'streaming'
        ) {
          continue;
        }
        if (BOT) autopilot(this.run);
        for (const event of this.run.tick(STEP_MS / 1000)) this.onEvent(event);
      }
      this.tickUi(dt * SPEED);
    }
    if (!this.run.finished) {
      audio.noise = this.run.breakdown?.noise ?? 0;
      audio.duck = this.run.inEncounter;
      const footsteps = this.footsteps();
      audio.update(dt, this.paused ? null : footsteps);
      scene.draw(this.run, dt);
    } else {
      this.finish();
    }
  }

  private footsteps(): { distance: number; pan: number } | null {
    const l = this.run.listener;
    if (l.state !== 'PATROL' && l.state !== 'INVESTIGATE' && l.state !== 'LEAVE') return null;
    const distance =
      l.room === this.run.playerRoom
        ? 0
        : l.room === 'corridor' || this.run.playerRoom === 'corridor'
          ? 1
          : 2;
    const order: Room[] = ['control', 'corridor', 'desk', 'archive', 'boiler'];
    const pan = Math.max(
      -1,
      Math.min(1, (order.indexOf(l.room) - order.indexOf(this.run.playerRoom)) * 0.45),
    );
    return { distance, pan };
  }

  private say(kind: 'listener' | 'lull' | 'tape', text: string, seconds = 5): void {
    if (settings.subtitles) {
      const line = el('span', {
        className: kind,
        textContent: (kind === 'lull' ? 'Lull: ' : '') + text,
      });
      this.subtitles.append(line);
      while (this.subtitles.childElementCount > 3) this.subtitles.firstElementChild?.remove();
      window.setTimeout(() => line.remove(), (seconds * 1000) / SPEED);
    }
    if (kind === 'listener') whisper.say(text);
  }

  private lull(text: string, seconds = 6): void {
    if (this.lullCooldown > 0) return;
    this.lullCooldown = 3;
    this.say('lull', text, seconds);
  }

  private whisperLine(lines: string[]): void {
    if (this.whisperCooldown > 0) return;
    this.whisperCooldown = 5;
    const pulse = this.run.breakdown?.hrEma;
    this.say('listener', pick(lines).replace('{pulse}', pulse ? numberToWords(pulse) : '...'));
  }

  private onEvent(event: RunEvent): void {
    const w = linesJson.whispers;
    const l = linesJson.lull;
    switch (event.kind) {
      case 'calibrated':
        this.calibration?.remove();
        this.calibration = null;
        if (!event.measured)
          this.say('lull', "I couldn't get a clear read, so I'll use typical values for now.");
        this.say('lull', "Find the tapes. Listen for it. I'll stay close.");
        break;
      case 'investigating':
        this.whisperLine(w.investigating);
        this.lull(l.hide);
        if (!settings.gentle) audio.sting();
        break;
      case 'encounter_start':
        scene.setMonitor(null);
        this.pulseSaid = false;
        this.whisperCooldown = 0;
        this.whisperLine(w.encounter_start);
        this.lullCooldown = 0;
        this.lull(l.encounter, 8);
        break;
      case 'leaned_in':
        this.whisperCooldown = 0;
        this.whisperLine(w.leaned_in);
        break;
      case 'encounter_survived':
        this.whisperCooldown = 0;
        this.whisperLine(w.survived);
        this.lullCooldown = 0;
        this.lull(l.survived);
        audio.chime();
        break;
      case 'tape_found': {
        audio.chime();
        const message = this.run.allTapes ? l.allTapes : `Tape ${event.count} of 3 saved.`;
        this.lullCooldown = 0;
        this.lull(message);
        break;
      }
      case 'fuse_taken':
        audio.chime();
        this.lullCooldown = 0;
        this.lull(l.fuse);
        break;
      case 'fuse_installed':
        audio.chime();
        this.lullCooldown = 0;
        this.lull(l.door);
        break;
      case 'finale_start':
        this.lullCooldown = 0;
        this.lull(l.finale, 10);
        this.whisperCooldown = 0;
        this.whisperLine(w.finale);
        break;
      case 'lock_breath':
        audio.chime();
        this.say('lull', `The lock answers. ${event.streak} of ${this.run.lock?.required ?? 3}.`);
        break;
      case 'offer_break':
        if (!BOT) this.showBreak();
        else this.run.acknowledgeBreak();
        break;
      case 'player_moved':
        if (event.room === 'corridor') this.lull(l.corridor);
        break;
      default:
        break;
    }
  }

  private tickUi(dt: number): void {
    const run = this.run;
    this.lullCooldown = Math.max(0, this.lullCooldown - dt);
    this.whisperCooldown = Math.max(0, this.whisperCooldown - dt);
    const b = run.breakdown;

    if (run.phase === 'calibrating') {
      const c = run.calibration;
      // Live and Sim: confidence stays at 0 for 30 s by design, so say so rather than look stuck.
      this.calibrationBar.style.width = `${Math.round(c.progress * 100)}%`;
      if (this.sidecarProblem) this.calibrationHint.textContent = this.sidecarProblem;
      else if (this.source.kind === 'live' && this.source.status === 'connecting') {
        this.calibrationHint.textContent = 'Looking for the sidecar. Start it with: pnpm sidecar';
      } else if (c.hint) this.calibrationHint.textContent = c.hint;
      else
        this.calibrationHint.textContent =
          c.phase === 'waiting'
            ? 'Reading your breathing takes about 30 seconds. Sit back and relax.'
            : 'Nearly there.';
    }

    if (b) {
      const showWeak = b.signalWeak && !b.listenerPaused;
      this.weak.hidden = !(showWeak || b.listenerPaused);
      if (b.listenerPaused) this.weak.textContent = `IT WAITS. ${linesJson.lull.paused}`;
      else if (showWeak)
        this.weak.textContent = `SIGNAL WEAK. ${b.weakHint ?? 'Hold still, and check your light.'}`;
      if (b.breatheReminder && !this.lastBreathReminder) {
        this.lullCooldown = 0;
        this.lull(linesJson.lull.breathe);
      }
      this.lastBreathReminder = b.breatheReminder;
      if (b.listenerPaused && !this.lastPaused) audio.setPaused(true);
      if (!b.listenerPaused && this.lastPaused) audio.setPaused(false);
      this.lastPaused = b.listenerPaused;
    }

    // The Listener counts your heart out loud, once per encounter, if it's climbing.
    if (run.inEncounter) {
      const s = run.listener.suspicion;
      if (!this.pulseSaid && s > 0.25) {
        this.pulseSaid = true;
        this.whisperCooldown = 0;
        this.whisperLine(linesJson.whispers.pulse);
      }
      if (s < this.lastSuspicion - 0.08 && s < 0.3 && this.pulseSaid) {
        this.whisperLine(linesJson.whispers.quieter);
        this.lastSuspicion = s;
      }
      this.lastSuspicion = s > this.lastSuspicion ? s : this.lastSuspicion;
    } else {
      this.lastSuspicion = 0;
    }

    // Tape playback as subtitles, paced across the tape's length.
    if (run.task?.kind === 'tape') {
      const tape = linesJson.tapes[run.task.room];
      const share = 1 - run.task.left / run.task.total;
      const index = Math.min(tape.lines.length - 1, Math.floor(share * tape.lines.length));
      this.tapeClock += dt;
      if (this.tapeLine !== index + 1) {
        this.tapeLine = index + 1;
        this.say('tape', `[${tape.title}] "${tape.lines[index]}"`, 12);
      }
    } else {
      this.tapeLine = 0;
    }

    this.renderObjectives();
    this.renderActions();
    if (!this.debug.hidden) this.renderDebug();
  }

  private renderObjectives(): void {
    const run = this.run;
    const items = [
      { done: run.allTapes, text: `Research tapes ${run.tapes.size}/3` },
      { done: run.hasFuse, text: 'Fuse from the boiler room' },
      { done: run.fuseInstalled, text: 'Fuse into the corridor breaker' },
      { done: run.phase === 'escaped', text: 'Blast door' },
    ];
    const room = ROOM_NAMES[run.playerRoom];
    const text = `${room}|${items.map((i) => `${i.done}${i.text}`).join()}`;
    if (this.objectives.dataset.key === text) return;
    this.objectives.dataset.key = text;
    this.objectives.replaceChildren(
      el('div', { textContent: room }),
      ...items.map((i) =>
        el('div', {
          className: i.done ? 'done' : '',
          textContent: `${i.done ? '✓' : '○'} ${i.text}`,
        }),
      ),
    );
  }

  /** Every action available right now, as buttons (keyboard or mouse) and scene hotspots. */
  private available(): {
    id: string;
    label: string;
    key: string;
    run: () => void;
    x?: number;
    y?: number;
  }[] {
    const run = this.run;
    if (!run.canAct) return [];
    const out: ReturnType<GameSession['available']> = [];
    const room = run.playerRoom;
    if (run.phase === 'finale') {
      if (!run.hidden) return [];
    }
    if (run.hidden) {
      out.push({ id: 'unhide', label: 'Come out', key: 'H', run: () => run.unhide() });
      return out;
    }
    if (run.phase !== 'playing') return out;

    if (HIDE_SPOTS[room]) {
      const name = {
        under_desk: 'Under the desk',
        locker: 'Into the locker',
        shelves: 'Behind the shelves',
        vent: 'Into the vent',
      }[HIDE_SPOTS[room]!];
      out.push({ id: 'hide', label: name, key: 'H', run: () => run.hide(), x: 300, y: 500 });
    }
    if (
      (TAPE_ROOMS as Room[]).includes(room) &&
      !run.tapes.has(room as never) &&
      run.task?.kind !== 'tape'
    ) {
      out.push({
        id: 'tape',
        label: 'Play the tape',
        key: 'E',
        run: () => run.startTape(),
        x: 800,
        y: 420,
      });
    }
    if (room === 'boiler' && !run.hasFuse && run.task?.kind !== 'fuse' && run.allTapes) {
      out.push({
        id: 'fuse',
        label: 'Pull the fuse',
        key: 'R',
        run: () => run.startFuse(),
        x: 1150,
        y: 420,
      });
    }
    if (room === 'corridor' && run.hasFuse && !run.fuseInstalled) {
      out.push({
        id: 'breaker',
        label: 'Fit the fuse',
        key: 'E',
        run: () => run.installFuse(),
        x: 420,
        y: 420,
      });
    }
    if (room === 'corridor' && run.doorReady) {
      out.push({
        id: 'door',
        label: 'Open the blast door',
        key: 'E',
        run: () => run.startFinale(),
        x: 800,
        y: 340,
      });
    }

    const go = (to: Room, key: string, x: number, y: number): void => {
      out.push({
        id: `go-${to}`,
        label: `Go to ${ROOM_NAMES[to]}`,
        key,
        run: () => run.move(to),
        x,
        y,
      });
    };
    if (room === 'corridor') {
      go('desk', 'Z', 150, 500);
      go('control', 'X', 480, 560);
      go('archive', 'C', 1120, 560);
      go('boiler', 'V', 1450, 500);
    } else {
      go('corridor', 'Z', 1450, 300);
    }
    return out;
  }

  private renderActions(): void {
    const run = this.run;
    const actions = this.available();
    const task = run.task;
    const moving = run.movingTo;
    const key = `${actions.map((a) => a.id).join()}|${task?.kind ?? ''}|${moving ?? ''}|${run.playerRoom === 'desk'}`;
    if (key !== this.lastActionsKey) {
      this.lastActionsKey = key;
      const list: HTMLElement[] = actions.map((a) =>
        el(
          'button',
          { onclick: a.run, dataset: { testid: `action-${a.id}` } },
          a.label,
          el('kbd', { textContent: a.key }),
        ),
      );
      if (run.playerRoom === 'desk' && !run.hidden && run.canAct) {
        list.push(el('div', { className: 'task', textContent: 'Monitors: press 1 to 4' }));
      }
      this.actions.replaceChildren(...list);
      this.taskEl = el('div', { className: 'task', hidden: true });
      this.actions.append(this.taskEl);
    }
    if (this.taskEl) {
      const text = moving
        ? `Walking to ${ROOM_NAMES[moving]}...`
        : run.isHiding
          ? 'Getting into cover...'
          : task
            ? `${task.kind === 'tape' ? 'Tape playing' : 'Working the fuse loose'}: ${Math.ceil(task.left)} s`
            : '';
      this.taskEl.hidden = !text;
      this.taskEl.textContent = text;
    }

    const spots: Hotspot[] = actions
      .filter((a) => a.x !== undefined)
      .map((a) => ({ id: a.id, label: a.label, x: a.x!, y: a.y!, run: a.run }));
    const spotsKey = spots.map((s) => s.id).join();
    if (spotsKey !== this.lastSpotsKey) {
      this.lastSpotsKey = spotsKey;
      scene.setHotspots(scene.monitorIndex === null ? spots : []);
    }
  }

  private taskEl: HTMLElement | null = null;

  private renderDebug(): void {
    const run = this.run;
    const b = run.breakdown;
    const d = run.difficulty;
    const term = (name: string, value: number, scale = 1, negative = false): HTMLElement =>
      el(
        'div',
        { className: 'term' },
        name,
        el(
          'div',
          { className: 'bar' },
          el('i', {
            className: negative ? 'neg' : '',
            style: `width:${Math.min(100, (value / scale) * 100)}%`,
          } as never),
        ),
        value.toFixed(2),
      );
    if (!b) {
      this.debug.replaceChildren(el('h3', { textContent: 'CALIBRATING' }));
      return;
    }
    const w = config.noiseWeights;
    this.debug.replaceChildren(
      el('h3', { textContent: 'NOISE BREAKDOWN (each term after its weight)' }),
      term('pulse', w.hr * b.hrElev),
      term('br rate', w.brRate * b.brRate),
      term('br irreg', w.brIrreg * b.brIrreg),
      term('motion', w.motion * b.motion),
      term('talk', b.talkImp),
      term('flinch', b.flinchImp),
      term('hold', b.holdFloor),
      term('calm', w.calm * b.calm, 1, true),
      term('NOISE', b.noise, 1.5),
      el('h3', { textContent: 'THRESHOLDS' }),
      el('div', { textContent: `alert ${d.alertThreshold}  search ${d.searchThreshold}` }),
      el('h3', { textContent: 'LISTENER' }),
      el('div', {
        textContent: `${run.listener.state} in ${run.listener.room}, timer ${Math.max(0, run.listener.timer).toFixed(1)} s`,
      }),
      el('div', { textContent: `suspicion ${run.listener.suspicion.toFixed(2)}` }),
      el('h3', { textContent: 'SIGNALS' }),
      el('div', {
        textContent: `breath source: ${b.brSource === 'trace' ? 'live waveform' : b.brSource === 'rate' ? 'SDK 30 s rate' : 'none'}`,
      }),
      el('div', {
        textContent: `baseline ${Math.round(run.calibration.baseline?.hr ?? 0)} bpm, ${Math.round(run.calibration.baseline?.br ?? 0)} br/min`,
      }),
      el('div', { textContent: `weak: ${b.signalWeak}  face lost: ${b.faceLost}` }),
    );
  }

  private finish(): void {
    if (this.ended) return;
    this.ended = true;
    const escaped = this.run.phase === 'escaped';
    whisper.stop();
    this.capture?.stop();
    this.source.stop();
    scene.showEnding(escaped ? 'escaped' : 'caught');
    ui.replaceChildren(
      el(
        'div',
        { className: 'subtitle' },
        el('span', {
          className: 'lull',
          textContent: escaped
            ? 'Lull: You made it. Look. Morning.'
            : 'The booth is empty. The headphones sway.',
        }),
      ),
    );
    if (!escaped) audio.sting();
    const log = this.run.toLog();
    const label = this.source.label;
    let left = 3.5 / SPEED;
    endingDraw = (dt) => {
      left -= dt;
      scene.drawEnding(dt);
      if (left <= 0) {
        endingDraw = null;
        showReport(ui, log, assets, settings, () => this.recorder.toJsonl(), label, showTitle);
      }
    };
  }

  // ------------------------------------------------------ input and pauses

  key(event: KeyboardEvent): void {
    if (this.ended) return;
    const code = event.code;
    if (code === 'Escape') {
      event.preventDefault();
      if (this.paused) this.resume();
      else this.pause();
      return;
    }
    if (code === 'F3') {
      event.preventDefault();
      this.debug.hidden = !this.debug.hidden;
      settings.debug = !this.debug.hidden;
      saveSettings(settings);
      return;
    }
    if (this.paused || event.repeat) return;

    if (
      code.startsWith('Digit') &&
      this.run.playerRoom === 'desk' &&
      !this.run.hidden &&
      !this.run.inEncounter
    ) {
      const n = Number(code.slice(5));
      if (n >= 1 && n <= MONITOR_ROOMS.length) {
        scene.setMonitor(scene.monitorIndex === n - 1 ? null : n - 1);
        this.lastSpotsKey = '?';
        return;
      }
    }
    const letter = code.startsWith('Key') ? code.slice(3) : '';
    const action = this.available().find((a) => a.key === letter);
    if (action) {
      action.run();
      return;
    }
    if (this.source instanceof SimSource) {
      this.source.key(code);
      if (code.startsWith('Arrow')) event.preventDefault();
    }
  }

  keyUp(event: KeyboardEvent): void {
    if (this.source instanceof SimSource) this.source.keyUp(event.code);
  }

  private pause(): void {
    this.paused = true;
    audio.setPaused(true);
    whisper.stop();
    const lull = assets.url('lull_idle');
    this.overlay = el(
      'div',
      { className: 'screen', dataset: { testid: 'pause' } },
      el(
        'div',
        { className: 'card' },
        ...(lull
          ? [
              el('img', {
                src: lull,
                alt: '',
                style: 'width:160px;display:block;margin:0 auto',
              } as never),
            ]
          : []),
        el('h2', { textContent: 'Paused' }),
        el('p', { textContent: "You're safe here. Take as long as you like." }),
        el(
          'div',
          { className: 'row' },
          button('Keep going', () => this.resume(), 'primary'),
          button('Leave the run', () => this.leave()),
        ),
        el('p', {
          className: 'notice',
          textContent:
            this.source.kind === 'live'
              ? 'The camera stays on while paused so your readings stay warm. Leave the run to turn it off.'
              : '',
        }),
      ),
    );
    ui.append(this.overlay);
  }

  private resume(): void {
    this.paused = false;
    this.overlay?.remove();
    this.overlay = null;
    audio.setPaused(false);
  }

  private leave(): void {
    this.ended = true;
    whisper.stop();
    this.capture?.stop();
    this.source.stop();
    audio.setPaused(false);
    showTitle();
  }

  private showBreak(): void {
    this.paused = true;
    audio.setPaused(true);
    whisper.stop();
    this.overlay = el(
      'div',
      { className: 'screen', dataset: { testid: 'break' } },
      el(
        'div',
        { className: 'card' },
        el('h2', { textContent: 'Take a breather?' }),
        el('p', {
          textContent: 'Your pulse reading has been up for a while. The station can wait.',
        }),
        el(
          'div',
          { className: 'row' },
          button(
            'Carry on',
            () => {
              this.run.acknowledgeBreak();
              this.resume();
            },
            'primary',
          ),
          button('Leave the run', () => this.leave()),
        ),
      ),
    );
    ui.append(this.overlay);
  }
}

let endingDraw: ((dt: number) => void) | null = null;

async function main(): Promise<void> {
  await assets.init();
  await scene.init(document.getElementById('stage')!);
  ui.replaceChildren(
    el(
      'div',
      { className: 'screen' },
      el('div', { className: 'card' }, el('p', { textContent: 'Loading Kestrel Station 7...' })),
    ),
  );
  await assets.preload(PRELOAD_IDS);
  scene.buildHud();
  scene.setHudVisible(false);

  window.addEventListener('keydown', (e) => session?.key(e));
  window.addEventListener('keyup', (e) => session?.keyUp(e));
  let last = performance.now();
  const frame = (now: number): void => {
    // Allow bigger steps at test speeds, where software rendering can drop to a few fps.
    const dtMs = Math.min(SPEED > 1 ? 1000 : 250, now - last);
    last = now;
    if (endingDraw) endingDraw(dtMs / 1000);
    else if (session) session.update(dtMs);
    else scene.drawIdle(idleRoom, dtMs / 1000);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  (window as unknown as { __hush: unknown }).__hush = {
    get run() {
      return session?.run ?? null;
    },
    get source() {
      return session ? session.bus : null;
    },
  };

  if (params.has('judge')) begin({ kind: 'replay', name: 'judge_tour_900s' });
  else if (params.get('source') === 'replay')
    begin({ kind: 'replay', name: params.get('session') ?? 'judge_tour_900s' });
  else if (params.get('source') === 'sim') begin({ kind: 'sim' });
  else showTitle();
}

void main();
