import type { VitalsFrame } from '@hush/signals';
import { PeakDetector } from './manifest';
import type { Settings } from './settings';
import { voiceKey, type VoicePack } from './voice';

const VOICE_BASE = '/hush-voice/';

/**
 * All sound is synthesised, so there are no audio files to license. Everything goes through a
 * limiter, so nothing can ever be painfully loud.
 */
export class GameAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private heartBus!: GainNode;
  private fxBus!: GainNode;
  private ambient!: GainNode;
  private breathGain!: GainNode;
  private readonly peaks = new PeakDetector();
  private fallbackTimer = 0;
  private sinceBeat = 0;
  private bpm: number | null = null;
  private breathEnv = 0;
  private traceLo = Infinity;
  private traceHi = -Infinity;
  private footTimer = 0;
  private creakTimer = 8;
  /** 0..1.5 current noise: your heart gets louder as you do. */
  noise = 0;
  /** During encounters the room drops away, leaving mostly your heartbeat. */
  duck = false;

  constructor(private readonly settings: Settings) {}

  /** Browsers only allow audio after a click, so this runs from the first button press. */
  start(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const AudioCtor = window.AudioContext;
    if (!AudioCtor) return;
    const ctx = new AudioCtor();
    this.ctx = ctx;

    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -14;
    limiter.knee.value = 6;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.2;
    limiter.connect(ctx.destination);

    this.master = ctx.createGain();
    this.master.connect(limiter);
    this.heartBus = ctx.createGain();
    this.heartBus.connect(this.master);
    this.fxBus = ctx.createGain();
    this.fxBus.connect(this.master);
    this.ambient = ctx.createGain();
    this.ambient.gain.value = 0.5;
    this.ambient.connect(this.master);
    this.applyVolumes();

    const noise = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    const loop = (): AudioBufferSourceNode => {
      const src = ctx.createBufferSource();
      src.buffer = noise;
      src.loop = true;
      src.start();
      return src;
    };

    // Tape hiss.
    const hissFilter = ctx.createBiquadFilter();
    hissFilter.type = 'highpass';
    hissFilter.frequency.value = 4000;
    const hissGain = ctx.createGain();
    hissGain.gain.value = 0.012;
    loop().connect(hissFilter).connect(hissGain).connect(this.ambient);

    // Boiler hum.
    for (const [freq, level] of [
      [50, 0.05],
      [100, 0.02],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.frequency.value = freq;
      const gain = ctx.createGain();
      gain.gain.value = level;
      osc.connect(gain).connect(this.ambient);
      osc.start();
    }

    // Your own breath, following the live waveform.
    const breathFilter = ctx.createBiquadFilter();
    breathFilter.type = 'bandpass';
    breathFilter.frequency.value = 900;
    breathFilter.Q.value = 0.7;
    this.breathGain = ctx.createGain();
    this.breathGain.gain.value = 0;
    loop().connect(breathFilter).connect(this.breathGain).connect(this.fxBus);
  }

  applyVolumes(): void {
    if (!this.ctx) return;
    this.master.gain.value = this.settings.master;
    this.heartBus.gain.value = this.settings.heartbeat;
    this.fxBus.gain.value = 1;
  }

  ingest(frame: VitalsFrame): void {
    if (frame.pulse && frame.pulse.conf >= 0.4) this.bpm = frame.pulse.bpm;
    if (frame.pleth?.samples.length) {
      const beats = this.peaks.push(frame.pleth.samples, frame.pleth.hz);
      if (beats > 0 && frame.pleth.stable !== false) this.beat();
    }
    if (frame.breathTrace?.samples.length) {
      for (const v of frame.breathTrace.samples) {
        this.traceLo = Math.min(v, this.traceLo + 0.001);
        this.traceHi = Math.max(v, this.traceHi - 0.001);
      }
      const v = frame.breathTrace.samples.at(-1)!;
      const range = this.traceHi - this.traceLo;
      this.breathEnv = range > 0 ? (v - this.traceLo) / range : 0;
    }
  }

  private beat(): void {
    if (!this.ctx) return;
    this.sinceBeat = 0;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    // Lub-dub: two low thumps, louder with noise.
    const level = 0.22 + Math.min(1, this.noise) * 0.35 + (this.duck ? 0.15 : 0);
    for (const [offset, scale] of [
      [0, 1],
      [0.14, 0.6],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(70, now + offset);
      osc.frequency.exponentialRampToValueAtTime(38, now + offset + 0.12);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(level * scale, now + offset + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.18);
      osc.connect(gain).connect(this.heartBus);
      osc.start(now + offset);
      osc.stop(now + offset + 0.2);
    }
  }

  private burst(freq: number, q: number, level: number, duration: number, pan = 0): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const size = Math.ceil(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, size, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < size; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / size) ** 2;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.value = level;
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    src.connect(filter).connect(gain).connect(panner).connect(this.fxBus);
    src.start(now);
  }

  /**
   * Call each frame. `distance` is rooms between you and the Listener (0 = same room);
   * `pan` is -1..1, and null distance means it isn't walking.
   */
  update(dt: number, footsteps: { distance: number; pan: number } | null): void {
    if (!this.ctx) return;
    this.sinceBeat += dt;
    // No beat detected from the waveform lately: keep the heart going from the pulse rate.
    this.fallbackTimer -= dt;
    if (this.bpm && this.sinceBeat > (60 / this.bpm) * 1.6 && this.fallbackTimer <= 0) {
      this.beat();
      this.fallbackTimer = 60 / this.bpm;
    }

    const t = this.ctx.currentTime;
    this.ambient.gain.setTargetAtTime(this.duck ? 0.12 : 0.5, t, 0.8);
    this.breathGain.gain.setTargetAtTime(0.015 + this.breathEnv * 0.06, t, 0.1);

    if (footsteps) {
      this.footTimer -= dt;
      if (this.footTimer <= 0) {
        this.footTimer = 0.85;
        const near = 1 / (1 + footsteps.distance);
        this.burst(220, 1, 0.5 * near + 0.04, 0.16, footsteps.pan);
      }
    }
    this.creakTimer -= dt;
    if (this.creakTimer <= 0) {
      this.creakTimer = 9 + Math.random() * 14;
      this.burst(600 + Math.random() * 500, 7, 0.03, 0.5, Math.random() * 2 - 1);
    }
  }

  /** Small rising tone for good news. */
  chime(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    [440, 660].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.frequency.value = freq;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now + i * 0.14);
      gain.gain.exponentialRampToValueAtTime(0.07, now + i * 0.14 + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.14 + 0.5);
      osc.connect(gain).connect(this.fxBus);
      osc.start(now + i * 0.14);
      osc.stop(now + i * 0.14 + 0.55);
    });
  }

  /** A sudden sting. Gentle Mode removes these altogether. */
  sting(): void {
    if (!this.ctx || this.settings.gentle) return;
    this.burst(320, 4, 0.5, 1.2);
  }

  /** Soft bed for the pause screen, and quiet otherwise. */
  setPaused(paused: boolean): void {
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(
      paused ? this.settings.master * 0.25 : this.settings.master,
      this.ctx.currentTime,
      0.3,
    );
  }

  silence(): void {
    void this.ctx?.suspend();
  }

  /** Null until the first click has started audio, or if the clip can't be decoded. */
  async decode(data: ArrayBuffer): Promise<AudioBuffer | null> {
    return this.ctx ? this.ctx.decodeAudioData(data).catch(() => null) : null;
  }

  /** Plays through the limiter like every other sound. Returns how to stop it, or null if it can't play. */
  playVoice(buffer: AudioBuffer): (() => void) | null {
    if (!this.ctx) return null;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const gain = this.ctx.createGain();
    gain.gain.value = this.settings.voice;
    src.connect(gain).connect(this.master);
    src.start();
    return () => {
      try {
        src.stop();
      } catch {
        /* Already finished. */
      }
    };
  }
}

/**
 * The Listener's voice: pre-rendered clips from tools/gen-voice.ts, or Web Speech with a low, slow
 * setting for any line without one. Every line also gets a subtitle.
 */
export class Whisperer {
  private voice: SpeechSynthesisVoice | null = null;
  private pack: VoicePack | null = null;
  private readonly clips = new Map<string, Promise<AudioBuffer | null>>();
  private stopClip: (() => void) | null = null;
  /** Bumped on every say and stop, so a clip that loads too late stays silent. */
  private latest = 0;

  constructor(
    private readonly settings: Settings,
    private readonly audio: GameAudio,
  ) {
    const pick = (): void => {
      const voices = window.speechSynthesis?.getVoices() ?? [];
      this.voice =
        voices.find((v) => /en/i.test(v.lang) && /male|david|mark|guy/i.test(v.name)) ??
        voices.find((v) => /en/i.test(v.lang)) ??
        null;
    };
    pick();
    if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = pick;
  }

  /** Loads the voice pack if one has been generated. The game works the same without it. */
  async init(): Promise<void> {
    try {
      const res = await fetch(`${VOICE_BASE}manifest.json`);
      if (res.ok) this.pack = (await res.json()) as VoicePack;
    } catch {
      /* No pack: Web Speech it is. */
    }
  }

  /** True when players will hear generated clips, which must be disclosed to them. */
  get usesGeneratedVoice(): boolean {
    return Object.keys(this.pack?.clips ?? {}).length > 0;
  }

  say(text: string): void {
    this.stop();
    if (this.settings.voice <= 0) return;
    const file = this.pack?.clips[voiceKey(text)];
    if (!file) {
      this.speak(text);
      return;
    }
    const request = this.latest;
    void this.loadClip(file).then((buffer) => {
      if (request !== this.latest) return;
      this.stopClip = buffer ? this.audio.playVoice(buffer) : null;
      if (!this.stopClip) this.speak(text);
    });
  }

  private loadClip(file: string): Promise<AudioBuffer | null> {
    let clip = this.clips.get(file);
    if (!clip) {
      clip = fetch(VOICE_BASE + file)
        .then((res) => (res.ok ? res.arrayBuffer() : null))
        .then((data) => (data ? this.audio.decode(data) : null))
        .catch(() => null);
      this.clips.set(file, clip);
    }
    return clip;
  }

  private speak(text: string): void {
    if (!window.speechSynthesis) return;
    const speech = new SpeechSynthesisUtterance(text.replace(/\.\.\./g, ' '));
    if (this.voice) speech.voice = this.voice;
    speech.rate = 0.6;
    speech.pitch = 0.1;
    speech.volume = Math.min(1, this.settings.voice * this.settings.master * 0.7);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(speech);
  }

  stop(): void {
    this.latest++;
    this.stopClip?.();
    this.stopClip = null;
    window.speechSynthesis?.cancel();
  }
}
