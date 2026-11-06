import { makeRng } from '@hush/signals';
import type { EngineConfig } from './config';

export type Room = 'desk' | 'corridor' | 'control' | 'archive' | 'boiler';
export const PATROL_ROUTE: Room[] = [
  'corridor',
  'control',
  'corridor',
  'archive',
  'corridor',
  'boiler',
];

export type ListenerState = 'DORMANT' | 'PATROL' | 'LISTEN' | 'INVESTIGATE' | 'SEARCH' | 'LEAVE';

export type ListenerEvent =
  | { kind: 'entered_room'; room: Room }
  | { kind: 'listening'; room: Room }
  | { kind: 'investigating'; room: Room }
  | { kind: 'encounter_start'; room: Room; seconds: number }
  | { kind: 'leaned_in'; room: Room }
  | { kind: 'encounter_survived'; room: Room; peakSuspicion: number }
  | { kind: 'caught'; room: Room }
  | { kind: 'searched_empty'; room: Room }
  | { kind: 'left'; room: Room };

export interface ListenerContext {
  dt: number;
  noise: number;
  playerRoom: Room;
  playerHidden: boolean;
  /** Face lost for too long: everything freezes rather than punishing the player. */
  paused: boolean;
  searchThreshold: number;
  alertThreshold: number;
  suspicionGain: number;
  /** Director: has enough time passed that noise may draw it over? */
  mayEngage: boolean;
  /** Director: it's time for an encounter whatever the noise. */
  mustEngage: boolean;
  searchSeconds: number;
  /** Director's escalation factor applied to suspicion gain. */
  gainMultiplier: number;
}

const LEAN_IN_SUSPICION = 0.5;

/** Deterministic given (seed, context stream). All randomness comes from the seeded RNG. */
export class Listener {
  state: ListenerState = 'DORMANT';
  room: Room = 'boiler';
  suspicion = 0;
  peakSuspicion = 0;
  /** Seconds left in the current state. */
  timer = 0;
  private searchTotal = 0;
  private target: Room = 'corridor';
  private routeIndex = 0;
  private leanedIn = false;
  private hunting = false;
  private noiseWindow: { noise: number; dt: number }[] = [];
  private readonly rng: () => number;

  constructor(
    private readonly config: EngineConfig,
    seed: number,
  ) {
    this.rng = makeRng(seed);
  }

  /** 0..1 for HUD "horns turning toward you". */
  get hornsTowardPlayer(): number {
    return this.state === 'SEARCH' ? Math.min(1, this.suspicion) : 0;
  }

  get searchProgress(): number {
    return this.state === 'SEARCH' && this.searchTotal > 0 ? 1 - this.timer / this.searchTotal : 0;
  }

  /** Called once the player is calibrated; before that it stays dormant. */
  wake(): void {
    if (this.state === 'DORMANT') this.toPatrol();
  }

  /** Bring it to the player for the finale's encounter fallback. */
  forceSearch(room: Room, seconds: number): ListenerEvent[] {
    this.room = room;
    return this.beginSearch(seconds);
  }

  private range([lo, hi]: [number, number]): number {
    return lo + (hi - lo) * this.rng();
  }

  private toPatrol(): void {
    this.state = 'PATROL';
    this.routeIndex = (this.routeIndex + 1) % PATROL_ROUTE.length;
    this.target = PATROL_ROUTE[this.routeIndex]!;
    this.timer = this.range(this.config.listener.patrolLegSeconds);
  }

  private beginSearch(seconds: number): ListenerEvent[] {
    this.state = 'SEARCH';
    this.timer = seconds;
    this.searchTotal = seconds;
    this.suspicion = 0;
    this.peakSuspicion = 0;
    this.leanedIn = false;
    return [{ kind: 'encounter_start', room: this.room, seconds }];
  }

  tick(ctx: ListenerContext): ListenerEvent[] {
    if (this.state === 'DORMANT' || ctx.paused) return [];
    const events: ListenerEvent[] = [];
    const { dt } = ctx;

    this.noiseWindow.push({ noise: ctx.noise, dt });
    let span = this.noiseWindow.reduce((a, b) => a + b.dt, 0);
    while (span > this.config.listener.decisionWindowSeconds && this.noiseWindow.length > 1) {
      span -= this.noiseWindow.shift()!.dt;
    }

    this.timer -= dt;
    switch (this.state) {
      case 'PATROL':
        if (this.timer <= 0) {
          this.room = this.target;
          events.push({ kind: 'entered_room', room: this.room });
          this.state = 'LISTEN';
          this.timer = this.range(this.config.listener.listenSeconds);
          events.push({ kind: 'listening', room: this.room });
        }
        break;
      case 'LISTEN':
        if (this.timer <= 0) {
          const avg =
            this.noiseWindow.reduce((a, b) => a + b.noise * b.dt, 0) / Math.max(span, 1e-6);
          const heard = avg > ctx.alertThreshold && ctx.mayEngage;
          if (heard || ctx.mustEngage) {
            this.state = 'INVESTIGATE';
            this.target = ctx.playerRoom;
            // Going where it heard a noise can be dodged by moving; a Director visit can't.
            this.hunting = ctx.mustEngage;
            this.timer = this.config.listener.investigateSeconds;
            events.push({ kind: 'investigating', room: this.target });
          } else {
            this.toPatrol();
          }
        }
        break;
      case 'INVESTIGATE':
        if (this.timer <= 0) {
          this.room = this.hunting ? ctx.playerRoom : this.target;
          events.push({ kind: 'entered_room', room: this.room });
          if (ctx.playerRoom === this.room) {
            events.push(...this.beginSearch(ctx.searchSeconds));
          } else {
            events.push({ kind: 'searched_empty', room: this.room });
            this.state = 'LEAVE';
            this.timer = this.config.listener.leaveSeconds;
          }
        }
        break;
      case 'SEARCH': {
        const exposed = ctx.playerHidden ? 1 : this.config.listener.exposedGainMultiplier;
        if (ctx.noise > ctx.searchThreshold) {
          this.suspicion +=
            (ctx.noise - ctx.searchThreshold) *
            dt *
            ctx.suspicionGain *
            ctx.gainMultiplier *
            exposed;
        } else {
          this.suspicion = Math.max(0, this.suspicion - this.config.listener.suspicionDecay * dt);
        }
        this.peakSuspicion = Math.max(this.peakSuspicion, this.suspicion);
        if (!this.leanedIn && this.suspicion >= LEAN_IN_SUSPICION) {
          this.leanedIn = true;
          events.push({ kind: 'leaned_in', room: this.room });
        }
        if (this.suspicion >= 1) {
          this.suspicion = 1;
          this.peakSuspicion = 1;
          this.state = 'LEAVE';
          this.timer = 0;
          events.push({ kind: 'caught', room: this.room });
        } else if (this.timer <= 0) {
          events.push({
            kind: 'encounter_survived',
            room: this.room,
            peakSuspicion: this.peakSuspicion,
          });
          this.state = 'LEAVE';
          this.timer = this.config.listener.leaveSeconds;
          this.suspicion = 0;
        }
        break;
      }
      case 'LEAVE':
        if (this.timer <= 0) {
          events.push({ kind: 'left', room: this.room });
          this.toPatrol();
        }
        break;
    }
    return events;
  }
}
