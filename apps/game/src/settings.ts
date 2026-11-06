import type { DifficultyName } from '@hush/engine';

export interface Settings {
  difficulty: DifficultyName;
  gentle: boolean;
  subtitles: boolean;
  master: number;
  voice: number;
  heartbeat: number;
  debug: boolean;
  consented: boolean;
  tutorialSeen: boolean;
  /** Local LLM report narration; off unless asked for, and only ever talks to localhost. */
  ollama: boolean;
  webcamPreview: boolean;
}

const KEY = 'hush.settings.v1';

const defaults: Settings = {
  difficulty: 'standard',
  gentle: false,
  subtitles: true,
  master: 0.8,
  voice: 0.8,
  heartbeat: 0.8,
  debug: false,
  consented: false,
  tutorialSeen: false,
  ollama: false,
  webcamPreview: false,
};

/** Storage can throw or be empty (private windows), and the game must work regardless. */
export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...defaults, ...(JSON.parse(raw) as Partial<Settings>) } : { ...defaults };
  } catch {
    return { ...defaults };
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* Nothing to do: settings just won't persist. */
  }
}
