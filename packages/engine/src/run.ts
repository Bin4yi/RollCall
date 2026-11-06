import type { VitalsFrame } from '@hush/signals';
import { Calibration, type Baseline } from './calibration';
import type { DifficultyName, EngineConfig } from './config';
import { Director } from './director';
import { AcousticLock } from './finale';
import { Listener, type ListenerEvent, type Room } from './listener';
import { NoiseModel, type NoiseBreakdown } from './noise';

export type RunPhase = 'calibrating' | 'playing' | 'finale' | 'escaped' | 'caught';
export type TapeRoom = 'control' | 'archive' | 'boiler';
export const TAPE_ROOMS: TapeRoom[] = ['control', 'archive', 'boiler'];

export type HideSpot = 'under_desk' | 'locker' | 'shelves' | 'vent';
/** The corridor has no cover on purpose: don't linger there. */
export const HIDE_SPOTS: Partial<Record<Room, HideSpot>> = {
  desk: 'under_desk',
  control: 'locker',
  archive: 'shelves',
  boiler: 'vent',
};

export type RunEvent =
  | ListenerEvent
  | { kind: 'calibrated'; measured: boolean }
  | { kind: 'player_moved'; room: Room }
  | { kind: 'player_hid'; spot: HideSpot }
  | { kind: 'tape_found'; room: TapeRoom; count: number }
  | { kind: 'fuse_taken' }
  | { kind: 'fuse_installed' }
  | { kind: 'finale_start' }
  | { kind: 'lock_breath'; streak: number }
  | { kind: 'escaped' }
  | { kind: 'offer_break' };

export interface LoggedEvent {
  t: number;
  event: RunEvent;
}

/** One 2 Hz sample for the report timeline. */
export interface RunSample {
  t: number;
  pulse: number | null;
  breath: number | null;
  noise: number;
  suspicion: number;
  motion: number;
  calm: boolean;
  weak: boolean;
  searching: boolean;
}

export interface RunLog {
  seed: number;
  difficulty: DifficultyName;
  gentle: boolean;
  baseline: Baseline | null;
  outcome: 'escaped' | 'caught' | 'in_progress';
  durationSeconds: number;
  samples: RunSample[];
  events: LoggedEvent[];
  tapes: number;
}

export type Task =
  | { kind: 'tape'; room: TapeRoom; left: number; total: number }
  | { kind: 'fuse'; left: number; total: number };

export interface RunOptions {
  difficulty: DifficultyName;
  seed: number;
  gentle?: boolean;
}

const SAMPLE_INTERVAL = 0.5;
const FINALE_ENCOUNTER_SECONDS = 20;

/** The whole game minus rendering: pure, deterministic, driven by frames and ticks. */
export class Run {
  phase: RunPhase = 'calibrating';
  time = 0;
  playerRoom: Room = 'desk';
  hidden = false;
  /** Seconds until an in-progress move or hide finishes. */
  private moving: { to: Room; left: number } | null = null;
  private hiding: number | null = null;
  task: Task | null = null;
  tapes = new Set<TapeRoom>();
  hasFuse = false;
  fuseInstalled = false;
  lock: AcousticLock | null = null;
  finaleLeft = 0;

  readonly calibration: Calibration;
  readonly listener: Listener;
  readonly director: Director;
  noise: NoiseModel | null = null;
  breakdown: NoiseBreakdown | null = null;
  private readonly events: LoggedEvent[] = [];
  private readonly samples: RunSample[] = [];
  private sampleClock = 0;
  private pulseHighFor = 0;
  private breakOffered = false;
  private latestPulse: number | null = null;
  private finaleEncounter = false;
  private readonly progress = new Map<TapeRoom | 'fuse', number>();

  constructor(
    private readonly config: EngineConfig,
    readonly options: RunOptions,
  ) {
    this.calibration = new Calibration(config);
    this.listener = new Listener(config, options.seed);
    this.director = new Director(config, options.seed, !!options.gentle);
  }

  get difficulty() {
    return this.config.difficulties[this.options.difficulty];
  }

  get inEncounter(): boolean {
    return this.listener.state === 'SEARCH';
  }

  get finished(): boolean {
    return this.phase === 'escaped' || this.phase === 'caught';
  }

  /** May the player start something new, walk, or hide? */
  get canAct(): boolean {
    return (
      (this.phase === 'playing' || this.phase === 'finale') && !this.inEncounter && !this.moving
    );
  }

  get isHiding(): boolean {
    return this.hiding !== null;
  }

  get movingTo(): Room | null {
    return this.moving?.to ?? null;
  }

  get allTapes(): boolean {
    return this.tapes.size === TAPE_ROOMS.length;
  }

  get doorReady(): boolean {
    return this.allTapes && this.fuseInstalled;
  }

  /** Everything so far, oldest first. Each tick's new events are also returned by tick(). */
  get log(): readonly LoggedEvent[] {
    return this.events;
  }

  ingest(frame: VitalsFrame): void {
    if (frame.pulse && frame.pulse.conf >= this.config.confidence.pulse) {
      this.latestPulse = frame.pulse.bpm;
    }
    if (this.phase === 'calibrating') this.calibration.ingest(frame);
    this.noise?.ingest(frame);
  }

  // ---- player actions: each returns false when it isn't allowed right now ----

  move(to: Room): boolean {
    if (!this.canAct || to === this.playerRoom || this.phase === 'finale') return false;
    this.pauseTask();
    this.hidden = false;
    this.hiding = null;
    this.moving = { to, left: this.config.objectives.moveSeconds };
    this.noise?.addMoveNoise();
    return true;
  }

  hide(): boolean {
    // Already on the way into cover: pressing again mustn't restart the timer.
    if (!this.canAct || this.hidden || this.hiding !== null || !HIDE_SPOTS[this.playerRoom]) {
      return false;
    }
    this.pauseTask();
    this.hiding = this.config.objectives.hideSeconds;
    return true;
  }

  unhide(): boolean {
    if (!this.canAct || !this.hidden) return false;
    this.hidden = false;
    return true;
  }

  startTape(): boolean {
    const room = this.playerRoom;
    if (!this.canAct || this.hidden || !isTapeRoom(room) || this.tapes.has(room)) return false;
    const total = this.config.objectives.tapeSeconds;
    this.task = { kind: 'tape', room, left: this.progress.get(room) ?? total, total };
    return true;
  }

  startFuse(): boolean {
    if (!this.canAct || this.hidden || this.playerRoom !== 'boiler' || this.hasFuse) return false;
    const total = this.config.objectives.fuseSeconds;
    this.task = { kind: 'fuse', left: this.progress.get('fuse') ?? total, total };
    return true;
  }

  installFuse(): boolean {
    if (!this.canAct || this.playerRoom !== 'corridor' || !this.hasFuse || this.fuseInstalled) {
      return false;
    }
    this.fuseInstalled = true;
    this.emit({ kind: 'fuse_installed' });
    return true;
  }

  startFinale(): boolean {
    if (
      !this.canAct ||
      this.phase !== 'playing' ||
      this.playerRoom !== 'corridor' ||
      !this.doorReady
    ) {
      return false;
    }
    this.phase = 'finale';
    this.task = null;
    this.finaleLeft = this.config.finale.approachSeconds;
    this.lock = new AcousticLock(this.config, this.noise!.breath, this.calibration.baseline!.br);
    this.emit({ kind: 'finale_start' });
    return true;
  }

  /** Interrupted work resumes where it stopped: hiding should never feel like losing progress. */
  private pauseTask(): void {
    if (this.task) {
      this.progress.set(this.task.kind === 'tape' ? this.task.room : 'fuse', this.task.left);
    }
    this.task = null;
  }

  /** The player accepted or dismissed "Take a breather?". The timer starts over. */
  acknowledgeBreak(): void {
    this.breakOffered = false;
    this.pulseHighFor = 0;
  }

  tick(dt: number): RunEvent[] {
    if (this.finished) return [];
    const before = this.events.length;
    this.time += dt;

    if (this.phase === 'calibrating') {
      this.calibration.tick(dt);
      const baseline = this.calibration.baseline;
      if (baseline) {
        this.noise = new NoiseModel(this.config, baseline);
        this.phase = 'playing';
        this.listener.wake();
        this.emit({ kind: 'calibrated', measured: baseline.measured });
      }
    } else {
      this.tickPlay(dt);
    }
    this.record(dt);
    return this.events.slice(before).map((e) => e.event);
  }

  private tickPlay(dt: number): void {
    const breakdown = this.noise!.tick(dt);
    this.breakdown = breakdown;
    const paused = breakdown.listenerPaused;
    this.director.tick(paused ? 0 : dt);
    this.tickWellbeing(dt);

    if (this.moving) {
      this.moving.left -= dt;
      if (this.moving.left <= 0) {
        this.playerRoom = this.moving.to;
        this.moving = null;
        this.emit({ kind: 'player_moved', room: this.playerRoom });
      }
    }
    if (this.hiding !== null) {
      this.hiding -= dt;
      if (this.hiding <= 0) {
        this.hiding = null;
        this.hidden = true;
        this.emit({ kind: 'player_hid', spot: HIDE_SPOTS[this.playerRoom]! });
      }
    }
    if (this.task && !this.inEncounter) this.tickTask(dt);

    const events = this.listener.tick({
      dt,
      noise: breakdown.noise,
      playerRoom: this.playerRoom,
      playerHidden: this.hidden,
      paused,
      searchThreshold: this.difficulty.searchThreshold,
      alertThreshold: this.difficulty.alertThreshold,
      suspicionGain: this.difficulty.suspicionGain,
      mayEngage: this.director.mayEngage && this.phase === 'playing',
      mustEngage: this.director.mustEngage && this.phase === 'playing',
      searchSeconds: this.director.searchSeconds,
      gainMultiplier: this.director.gainMultiplier,
    });
    for (const event of events) this.onListenerEvent(event);

    if (this.phase === 'finale' && !this.finished) this.tickFinale(dt, breakdown);
  }

  private onListenerEvent(event: ListenerEvent): void {
    this.emit(event);
    switch (event.kind) {
      case 'investigating':
        this.director.onEngaged();
        break;
      case 'encounter_start':
        this.director.onEngaged();
        this.moving = null;
        this.hiding = null;
        this.pauseTask();
        break;
      case 'searched_empty':
        this.director.onFinished(0, false);
        break;
      case 'encounter_survived':
        this.director.onFinished(event.peakSuspicion, true);
        if (this.finaleEncounter) {
          this.finaleEncounter = false;
          this.finaleLeft = this.config.finale.approachSeconds;
        }
        break;
      case 'caught':
        this.phase = 'caught';
        break;
    }
  }

  private tickTask(dt: number): void {
    const task = this.task!;
    task.left -= dt;
    if (task.left > 0) return;
    this.task = null;
    if (task.kind === 'tape') {
      this.tapes.add(task.room);
      this.emit({ kind: 'tape_found', room: task.room, count: this.tapes.size });
    } else {
      this.hasFuse = true;
      this.emit({ kind: 'fuse_taken' });
    }
  }

  private tickFinale(dt: number, breakdown: NoiseBreakdown): void {
    const lock = this.lock!;
    if (this.inEncounter) return;
    const before = lock.streak;
    lock.update();
    if (lock.streak > before) this.emit({ kind: 'lock_breath', streak: lock.streak });
    if (lock.open) {
      this.phase = 'escaped';
      this.emit({ kind: 'escaped' });
      return;
    }
    // Footsteps only advance on a trustworthy signal, so bad lighting never costs the player here.
    if (breakdown.signalWeak) return;
    this.finaleLeft -= dt;
    if (this.finaleLeft <= 0) {
      this.finaleEncounter = true;
      for (const event of this.listener.forceSearch('corridor', FINALE_ENCOUNTER_SECONDS)) {
        this.onListenerEvent(event);
      }
    }
  }

  private tickWellbeing(dt: number): void {
    const baseline = this.calibration.baseline;
    if (!baseline || this.latestPulse === null || this.breakOffered) return;
    const high = this.latestPulse - baseline.hr >= this.config.wellbeing.pulseAboveBaseline;
    this.pulseHighFor = high ? this.pulseHighFor + dt : 0;
    if (this.pulseHighFor >= this.config.wellbeing.sustainedSeconds) {
      this.breakOffered = true;
      this.emit({ kind: 'offer_break' });
    }
  }

  private record(dt: number): void {
    this.sampleClock += dt;
    if (this.sampleClock < SAMPLE_INTERVAL) return;
    this.sampleClock -= SAMPLE_INTERVAL;
    const b = this.breakdown;
    this.samples.push({
      t: round(this.time),
      pulse: b?.hrEma ?? null,
      breath: b?.brEma ?? null,
      noise: round(b?.noise ?? 0),
      suspicion: round(this.listener.suspicion),
      motion: round(b?.motion ?? 0),
      calm: !!b && b.calm > 0,
      weak: b?.signalWeak ?? true,
      searching: this.inEncounter,
    });
  }

  private emit(event: RunEvent): void {
    this.events.push({ t: round(this.time), event });
  }

  toLog(): RunLog {
    return {
      seed: this.options.seed,
      difficulty: this.options.difficulty,
      gentle: !!this.options.gentle,
      baseline: this.calibration.baseline,
      outcome: this.phase === 'escaped' || this.phase === 'caught' ? this.phase : 'in_progress',
      durationSeconds: round(this.time),
      samples: this.samples,
      events: this.events,
      tapes: this.tapes.size,
    };
  }
}

function isTapeRoom(room: Room): room is TapeRoom {
  return (TAPE_ROOMS as Room[]).includes(room);
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}
