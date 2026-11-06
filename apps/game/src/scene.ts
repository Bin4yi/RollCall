import {
  Application,
  Container,
  Graphics,
  Sprite,
  Text,
  Texture,
  type FederatedPointerEvent,
} from 'pixi.js';
import type { Room, Run } from '@hush/engine';
import { HIDE_SPOTS } from '@hush/engine';
import type { VitalsFrame } from '@hush/signals';
import type { AssetRegistry } from './assets';

export const STAGE_W = 1600;
export const STAGE_H = 900;
const HUD_H = 190;

const ROOM_BG: Record<Room, string> = {
  desk: 'bg_security_desk',
  corridor: 'bg_corridor',
  control: 'bg_control_room',
  archive: 'bg_tape_archive',
  boiler: 'bg_boiler_room',
};
const POV: Record<string, string> = {
  under_desk: 'pov_under_desk',
  locker: 'pov_locker',
  shelves: 'pov_shelves',
  vent: 'pov_vent',
};
const FOREGROUND: Partial<Record<Room, { id: string; x: number; y: number; w: number }>> = {
  control: { id: 'fg_console_edge', x: 800, y: 640, w: 1600 },
  archive: { id: 'fg_shelf_end', x: 130, y: 400, w: 340 },
  boiler: { id: 'fg_pipes_valve', x: 1430, y: 140, w: 480 },
};
export const PRELOAD_IDS = [
  ...Object.values(ROOM_BG),
  ...Object.values(POV),
  'bg_escape_dawn',
  'bg_game_over',
  'fg_console_edge',
  'fg_shelf_end',
  'fg_pipes_valve',
  'lull_idle',
  'lull_happy',
  'lull_worried',
  'lull_shh',
  'lull_lamp',
  'lull_guiding',
  'lull_celebrating',
  'lull_sleeping',
  'listener_stand',
  'listener_stalk',
  'listener_lean',
  'listener_tilt',
  'listener_silhouette',
  'listener_far',
  'ui_oscilloscope_strip',
  'prop_reel_machine',
  'prop_reel_wheel',
  'prop_breaker',
  'prop_fuse',
  'icon_heart',
  'icon_lungs',
  'icon_horn',
  'fx_scanlines',
  'fx_vignette',
];

export interface Hotspot {
  id: string;
  x: number;
  y: number;
  label: string;
  run: () => void;
}

/** Fits a sprite to cover an area, cropping rather than letterboxing. */
function cover(sprite: Sprite, w: number, h: number): void {
  const scale = Math.max(w / sprite.texture.width, h / sprite.texture.height);
  sprite.scale.set(scale);
  sprite.anchor.set(0.5);
  sprite.position.set(w / 2, h / 2);
}

function makeNoiseTexture(): Texture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d')!;
  const image = g.createImageData(size, size);
  for (let i = 0; i < image.data.length; i += 4) {
    const v = Math.random() * 255;
    image.data[i] = v;
    image.data[i + 1] = v;
    image.data[i + 2] = v;
    image.data[i + 3] = 255;
  }
  g.putImageData(image, 0, 0);
  return Texture.from(canvas);
}

class Scope {
  readonly samples: number[] = [];
  lo = Infinity;
  hi = -Infinity;

  constructor(private readonly capacity: number) {}

  push(values: number[]): void {
    for (const v of values) {
      this.samples.push(v);
      if (this.samples.length > this.capacity) this.samples.shift();
    }
    this.lo = Infinity;
    this.hi = -Infinity;
    for (const v of this.samples) {
      if (v < this.lo) this.lo = v;
      if (v > this.hi) this.hi = v;
    }
  }
}

/** Everything drawn on the Pixi stage. Reads game state; never changes it except via hotspots. */
export class GameScene {
  readonly app = new Application();
  private readonly world = new Container();
  private background = new Sprite();
  private foreground = new Sprite();
  private monsterSprite = new Sprite();
  private povMonster = new Sprite();
  private readonly hotspotLayer = new Container();
  private overlay = new Graphics();
  private staticSprite = new Sprite();
  private lull = new Sprite();
  private lullGlow = new Graphics();
  private reel = new Sprite();
  private scanlines = new Sprite();
  private vignette = new Sprite();
  private hud = new Container();
  private scopeG = new Graphics();
  private dialG = new Graphics();
  private readouts = new Text({
    text: '',
    style: { fontFamily: 'monospace', fontSize: 19, fill: 0xcffaf4, lineHeight: 26 },
  });
  private dialLabel = new Text({
    text: 'NOISE',
    style: { fontFamily: 'monospace', fontSize: 16, fill: 0x2b2519, fontWeight: '700' },
  });
  private horns: Sprite[] = [];
  private readonly pleth = new Scope(240);
  private readonly breath = new Scope(600);
  private plethHz = 30;
  private pulseConf = 0;
  private breathConf = 0;
  private pulseBpm: number | null = null;
  private breathBpm: number | null = null;
  private currentBg = '';
  private currentFg = '';
  private clock = 0;
  private needle = 0;
  private monitor: number | null = null;
  private hudGlow = 0;
  private lullTarget = { x: 110, y: 610 };
  private lullPos = { x: 110, y: 610 };
  private monsterVisible = 0;
  private lullBreath = 0;

  constructor(private readonly assets: AssetRegistry) {}

  async init(host: HTMLElement): Promise<void> {
    await this.app.init({
      width: STAGE_W,
      height: STAGE_H,
      background: 0x0b1016,
      antialias: true,
      preference: 'webgl',
      autoStart: false,
      sharedTicker: false,
    });
    host.append(this.app.canvas);
    // Sized in JS, not with object-fit, so pointer coordinates still line up with the stage.
    const fit = (): void => {
      const scale = Math.min(innerWidth / STAGE_W, innerHeight / STAGE_H);
      const style = this.app.canvas.style;
      style.width = `${STAGE_W * scale}px`;
      style.height = `${STAGE_H * scale}px`;
      style.left = `${(innerWidth - STAGE_W * scale) / 2}px`;
      style.top = `${(innerHeight - STAGE_H * scale) / 2}px`;
      style.inset = `${style.top} auto auto ${style.left}`;
    };
    addEventListener('resize', fit);
    fit();

    const stage = this.app.stage;
    stage.addChild(this.world, this.hud);
    this.world.addChild(
      this.background,
      this.reel,
      this.monsterSprite,
      this.foreground,
      this.povMonster,
      this.overlay,
      this.staticSprite,
      this.scanlines,
      this.vignette,
      this.hotspotLayer,
    );
    this.world.addChild(this.lullGlow, this.lull);

    this.staticSprite.texture = makeNoiseTexture();
    this.staticSprite.width = STAGE_W;
    this.staticSprite.height = STAGE_H;
    this.staticSprite.alpha = 0;
    this.staticSprite.blendMode = 'screen';

    this.lull.anchor.set(0.5);
    this.monsterSprite.anchor.set(0.5, 1);
    this.povMonster.anchor.set(0.5, 1);
    this.povMonster.blendMode = 'multiply';
    this.povMonster.visible = false;
    this.reel.visible = false;
    this.buildHud();
  }

  private buildHud(): void {
    const strip = new Sprite(this.assets.get('ui_oscilloscope_strip'));
    strip.width = STAGE_W;
    strip.height = HUD_H;
    this.hud.position.set(0, STAGE_H - HUD_H);
    this.hud.addChild(strip, this.scopeG, this.dialG, this.readouts, this.dialLabel);
    this.readouts.position.set(1085, 34);
    this.dialLabel.anchor.set(0.5);
    this.dialLabel.position.set(1450, 150);
    for (let i = 0; i < 3; i++) {
      const horn = new Sprite(this.assets.get('icon_horn'));
      horn.anchor.set(0.5);
      horn.width = 40;
      horn.height = 44;
      horn.position.set(1095 + i * 54, 142);
      this.hud.addChild(horn);
      this.horns.push(horn);
    }
  }

  ingest(frame: VitalsFrame): void {
    if (frame.pleth) {
      this.plethHz = frame.pleth.hz;
      this.pleth.push(frame.pleth.samples);
    }
    if (frame.breathTrace) this.breath.push(frame.breathTrace.samples);
    if (frame.pulse) {
      this.pulseConf = frame.pulse.conf;
      this.pulseBpm = frame.pulse.bpm;
    }
    if (frame.breath) {
      this.breathConf = frame.breath.conf;
      this.breathBpm = frame.breath.bpm;
    }
  }

  setHotspots(spots: Hotspot[]): void {
    this.hotspotLayer.removeChildren().forEach((c) => c.destroy({ children: true }));
    for (const spot of spots) {
      const c = new Container();
      c.position.set(spot.x, spot.y);
      const ring = new Graphics();
      ring
        .circle(0, 0, 26)
        .fill({ color: 0x7fe7dc, alpha: 0.14 })
        .stroke({ width: 2, color: 0xcffaf4, alpha: 0.85 });
      ring.circle(0, 0, 5).fill({ color: 0xcffaf4, alpha: 0.95 });
      const label = new Text({
        text: spot.label,
        style: {
          fontFamily: 'monospace',
          fontSize: 18,
          fill: 0xffffff,
          stroke: { color: 0x000000, width: 4 },
        },
      });
      label.anchor.set(0.5, 0);
      label.position.set(0, 32);
      c.addChild(ring, label);
      c.eventMode = 'static';
      c.cursor = 'pointer';
      c.on('pointertap', (e: FederatedPointerEvent) => {
        e.stopPropagation();
        spot.run();
      });
      this.hotspotLayer.addChild(c);
    }
  }

  setMonitor(index: number | null): void {
    this.monitor = index;
  }

  get monitorIndex(): number | null {
    return this.monitor;
  }

  private setBackground(id: string): void {
    if (id === this.currentBg) return;
    this.currentBg = id;
    this.background.texture = this.assets.get(id);
    cover(this.background, STAGE_W, STAGE_H - HUD_H + 40);
  }

  private setForeground(room: Room | null): void {
    const def = room ? FOREGROUND[room] : undefined;
    const key = def?.id ?? '';
    if (key === this.currentFg) return;
    this.currentFg = key;
    this.foreground.visible = !!def;
    if (!def) return;
    this.foreground.texture = this.assets.get(def.id);
    this.foreground.anchor.set(0.5);
    const scale = def.w / this.foreground.texture.width;
    this.foreground.scale.set(scale);
    this.foreground.position.set(def.x, def.y);
  }

  /** Static-only title of what the player sees when the run is over. */
  showEnding(kind: 'escaped' | 'caught'): void {
    this.setBackground(kind === 'escaped' ? 'bg_escape_dawn' : 'bg_game_over');
    this.setForeground(null);
    this.monsterSprite.visible = false;
    this.povMonster.visible = false;
    this.hotspotLayer.removeChildren();
    this.setLull(kind === 'escaped' ? 'lull_celebrating' : 'lull_sleeping');
    this.hud.visible = false;
    this.lullTarget = { x: 800, y: 480 };
    this.staticSprite.alpha = kind === 'caught' ? 0.1 : 0;
  }

  setHudVisible(visible: boolean): void {
    this.hud.visible = visible;
  }

  private setLull(id: string): void {
    const texture = this.assets.get(id);
    if (this.lull.texture !== texture) {
      this.lull.texture = texture;
      const scale = 150 / Math.max(texture.width, texture.height);
      this.lull.scale.set(scale);
    }
  }

  /** Holds the ending set up by showEnding. */
  drawEnding(dt: number): void {
    this.clock += dt;
    this.overlay.clear();
    this.drawLull(dt, 0, false);
    this.drawOverlays();
    this.app.render();
  }

  /** The screens before the run starts only need the room behind them. */
  drawIdle(room: Room, dt: number): void {
    this.clock += dt;
    this.setBackground(ROOM_BG[room]);
    this.setForeground(null);
    this.monsterSprite.visible = false;
    this.povMonster.visible = false;
    this.overlay.clear();
    this.setLull('lull_guiding');
    this.lullTarget = { x: 800, y: 300 };
    this.drawLull(dt, 0, true);
    this.drawScope();
    this.drawDial(0, dt);
    this.drawOverlays();
    this.app.render();
  }

  draw(run: Run, dt: number): void {
    this.clock += dt;
    const noise = run.breakdown?.noise ?? 0;
    const listener = run.listener;
    const encounter = run.inEncounter;
    const sameRoom = listener.room === run.playerRoom;

    const monitorRoom = this.monitor !== null ? MONITOR_ROOMS[this.monitor] : null;
    const viewRoom = monitorRoom ?? run.playerRoom;

    if (run.hidden && !monitorRoom) {
      const spot = HIDE_SPOTS[run.playerRoom];
      this.setBackground(POV[spot ?? 'under_desk']!);
      this.setForeground(null);
    } else {
      this.setBackground(ROOM_BG[viewRoom]);
      this.setForeground(monitorRoom ? null : viewRoom);
    }

    // The Listener in the room: only ever seen if it's actually there.
    const inView = !run.hidden || monitorRoom !== null;
    const present = listener.room === viewRoom && listener.state !== 'DORMANT';
    this.monsterVisible +=
      ((present && inView ? 1 : 0) - this.monsterVisible) * Math.min(1, dt * 2);
    this.monsterSprite.visible = this.monsterVisible > 0.02;
    if (this.monsterSprite.visible) {
      const pose = encounter
        ? listener.suspicion > 0.5
          ? 'listener_lean'
          : 'listener_tilt'
        : listener.state === 'LISTEN'
          ? 'listener_tilt'
          : 'listener_stalk';
      this.monsterSprite.texture = this.assets.get(pose);
      const height = encounter ? 640 + listener.suspicion * 90 : 470;
      this.monsterSprite.scale.set(height / this.monsterSprite.texture.height);
      this.monsterSprite.position.set(
        encounter ? 800 : 980 + Math.sin(this.clock / 3) * 70,
        STAGE_H - HUD_H + 8,
      );
      this.monsterSprite.alpha = this.monsterVisible;
    }

    // Seen from a hiding place: a dark shape through the slits. Multiply lets the cover show.
    const pov = encounter && run.hidden && !monitorRoom;
    this.povMonster.visible = pov;
    if (pov) {
      this.povMonster.texture = this.assets.get(
        listener.suspicion > 0.5 ? 'listener_lean' : 'listener_silhouette',
      );
      const lean = listener.suspicion;
      const height = 760 + lean * 260;
      this.povMonster.scale.set(height / this.povMonster.texture.height);
      this.povMonster.position.set(
        800 + Math.sin(this.clock * 0.35) * 26,
        STAGE_H - HUD_H + 40 + lean * 150,
      );
      this.povMonster.alpha = 0.9;
    }

    // Reel machine while a tape plays.
    const taping = run.task?.kind === 'tape' && !run.hidden && !monitorRoom;
    this.reel.visible = taping;
    if (taping) {
      this.reel.texture = this.assets.get('prop_reel_machine');
      const scale = 230 / this.reel.texture.width;
      this.reel.scale.set(scale);
      this.reel.anchor.set(0.5);
      this.reel.position.set(800, 490);
    }

    // Lighting: the room narrows to your hiding place in an encounter.
    this.overlay.clear();
    if (encounter) {
      this.overlay.rect(0, 0, STAGE_W, STAGE_H).fill({ color: 0x03060a, alpha: 0.28 });
    }
    // Slow room flicker, far below the 3 Hz photosensitivity limit.
    const flicker = 0.035 + 0.02 * Math.sin(this.clock * 1.3);
    this.overlay.rect(0, 0, STAGE_W, STAGE_H).fill({ color: 0x03060a, alpha: flicker });

    // Monitors: more static as the Listener gets closer to the camera's room.
    if (monitorRoom) {
      const close = listener.room === monitorRoom ? 1 : sameRoom ? 0.7 : 0.25;
      this.staticSprite.alpha = 0.06 + close * 0.14;
      // Move, don't re-randomise: looks like static, without full-screen flashing.
      this.staticSprite.x = -((this.clock * 37) % 20);
      this.staticSprite.y = -((this.clock * 23) % 20);
      this.staticSprite.width = STAGE_W + 40;
      this.staticSprite.height = STAGE_H + 40;
    } else {
      this.staticSprite.alpha = 0;
    }

    // Lull: a visual pacer and a mirror of how loud you are.
    const paused = run.breakdown?.listenerPaused;
    const weak = run.breakdown?.signalWeak;
    if (weak) {
      this.setLull('lull_lamp');
      this.lullTarget = { x: 800, y: 130 };
    } else if (encounter) {
      this.setLull('lull_shh');
      this.lullTarget = { x: 110, y: 610 };
    } else if (noise > 0.55) {
      this.setLull('lull_worried');
      this.lullTarget = { x: 110, y: 610 };
    } else if (run.phase === 'finale') {
      this.setLull('lull_guiding');
      this.lullTarget = { x: 800, y: 300 };
    } else {
      this.setLull(noise < 0.2 ? 'lull_happy' : 'lull_idle');
      this.lullTarget = { x: 110, y: 610 };
    }
    this.drawLull(dt, noise, !!paused);

    const target = encounter ? 1 : 0;
    this.hudGlow += (target - this.hudGlow) * Math.min(1, dt);
    this.drawScope();
    this.drawDial(noise, dt);
    this.drawHorns(listener.suspicion, encounter);
    this.drawOverlays();
    this.app.render();
  }

  private drawLull(dt: number, noise: number, resting: boolean): void {
    this.lullPos.x += (this.lullTarget.x - this.lullPos.x) * Math.min(1, dt * 1.5);
    this.lullPos.y += (this.lullTarget.y - this.lullPos.y) * Math.min(1, dt * 1.5);

    // A steady pacer at 6 breaths a minute, to breathe along with.
    this.lullBreath += dt;
    const pacer = 0.5 + 0.5 * Math.sin((2 * Math.PI * this.lullBreath) / 10);
    const calm = Math.max(0, 1 - noise);
    const bob = Math.sin(this.clock * 1.2) * 5;

    this.lull.position.set(this.lullPos.x, this.lullPos.y + bob);
    const baseScale = 150 / Math.max(this.lull.texture.width, this.lull.texture.height);
    this.lull.scale.set(baseScale * (0.94 + pacer * 0.1));
    this.lull.alpha = resting ? 0.7 : 0.45 + calm * 0.55;
    const grey = Math.round(120 + calm * 135);
    this.lull.tint = (grey << 16) | (grey << 8) | grey;

    this.lullGlow.clear();
    const glow = (0.06 + calm * 0.2) * (0.6 + pacer * 0.4);
    for (let i = 3; i > 0; i--) {
      this.lullGlow
        .circle(this.lull.x, this.lull.y, 48 + i * 22)
        .fill({ color: 0xbff4ee, alpha: glow / i / 1.5 });
    }
  }

  private drawScope(): void {
    const g = this.scopeG;
    g.clear();
    if (!this.hud.visible) return;
    const x = 60;
    const w = 1000;
    const glow = 0.75 + this.hudGlow * 0.25;
    this.trace(g, this.pleth, x, 26, w, 62, 0x7fe7dc, glow);
    this.trace(g, this.breath, x, 100, w, 62, 0xffffff, glow);
    this.readouts.text =
      `PULSE ${fmt(this.pulseBpm, this.pulseConf, 0.4)} bpm   ${pips(this.pulseConf)}\n` +
      `BREATH ${fmt(this.breathBpm, this.breathConf, 0.45)} br/min ${pips(this.breathConf)}`;
  }

  private trace(
    g: Graphics,
    scope: Scope,
    x: number,
    y: number,
    w: number,
    h: number,
    color: number,
    alpha: number,
  ): void {
    const samples = scope.samples;
    if (samples.length < 2) return;
    const range = Math.max(scope.hi - scope.lo, 1e-6);
    const n = samples.length;
    const step = Math.max(1, Math.floor(n / 500));
    for (let i = 0; i < n; i += step) {
      const px = x + (i / (n - 1)) * w;
      const py = y + h - ((samples[i]! - scope.lo) / range) * h;
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.stroke({ width: 2.5, color, alpha });
  }

  private drawDial(noise: number, dt: number): void {
    const g = this.dialG;
    g.clear();
    this.dialLabel.visible = this.hud.visible;
    if (!this.hud.visible) return;
    const cx = 1450;
    const cy = 112;
    const r = 88;
    // The dial is drawn here because the meter art has a needle painted into it.
    g.circle(cx, cy, r).fill(0x12181d).stroke({ width: 4, color: 0x3a4246 });
    g.circle(cx, cy, r - 6).fill(0xeadfc0);
    const from = Math.PI * 1.15;
    const span = Math.PI * 0.7;
    const angle = (v: number): number => from + (Math.min(1.5, v) / 1.5) * span;
    for (let i = 0; i <= 15; i++) {
      const a = angle(i / 10);
      const major = i % 5 === 0;
      const inner = r - (major ? 26 : 18);
      g.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner)
        .lineTo(cx + Math.cos(a) * (r - 11), cy + Math.sin(a) * (r - 11))
        .stroke({ width: major ? 2.5 : 1.2, color: 0x2b2519 });
    }
    g.arc(cx, cy, r - 14, angle(1), angle(1.5)).stroke({ width: 7, color: 0xb73a22 });

    this.needle += (noise - this.needle) * Math.min(1, dt * 5);
    const a = angle(this.needle);
    g.moveTo(cx, cy)
      .lineTo(cx + Math.cos(a) * (r - 16), cy + Math.sin(a) * (r - 16))
      .stroke({ width: 3, color: 0x111111 });
    g.circle(cx, cy, 7).fill(0x111111);
  }

  private drawHorns(suspicion: number, encounter: boolean): void {
    this.horns.forEach((horn, i) => {
      const lit = encounter && suspicion * 3 > i;
      horn.alpha = lit ? 1 : 0.22;
      // Horns swing round toward the player as suspicion rises.
      horn.rotation = encounter ? -0.5 + Math.min(1, suspicion) * 0.5 : -0.5;
    });
  }

  private drawOverlays(): void {
    const scan = this.assets.get('fx_scanlines');
    this.scanlines.texture = scan;
    this.scanlines.width = STAGE_W;
    this.scanlines.height = STAGE_H;
    this.scanlines.alpha = this.assets.url('fx_scanlines') ? 0.1 : 0;
    const vig = this.assets.get('fx_vignette');
    this.vignette.texture = vig;
    this.vignette.width = STAGE_W;
    this.vignette.height = STAGE_H;
    this.vignette.alpha = this.assets.url('fx_vignette') ? 0.7 : 0;
  }
}

export const MONITOR_ROOMS: Room[] = ['control', 'archive', 'boiler', 'corridor'];

function fmt(value: number | null, conf: number, threshold: number): string {
  if (value === null || conf < threshold) return ' --';
  return String(Math.round(value)).padStart(3, ' ');
}

/** Filled pips plus a text form, so confidence never relies on colour alone. */
function pips(conf: number): string {
  const filled = Math.round(conf * 4);
  return '●'.repeat(filled) + '○'.repeat(4 - filled);
}
