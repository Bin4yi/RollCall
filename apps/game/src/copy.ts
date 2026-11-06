/** Player-facing notices in one place, so they stay accurate and can be checked in a test. */
export const BANNED_UI_WORDS = [
  'anxiety',
  'panic',
  'stress',
  'disorder',
  'diagnos',
  'vagal',
  'nervous system',
  'apnea',
  'treatment',
  'therapy',
];

export const DISCLAIMER =
  'Horror content. For adults (18+). HUSH is a game, not a medical device. Pulse and breathing readings are estimates for gameplay only and must not be used for any health decision.';

/** OpenAI's usage policies require telling players that a voice is AI-generated. */
export const VOICE_NOTICE = "The Listener's voice is AI-generated.";

/** Matches docs/SDK_NOTES.md. Says what's documented, and doesn't overclaim about the SDK. */
export const CONSENT_POINTS = [
  'Your webcam is used only while a run is active, and the light on your camera shows when it is.',
  'HUSH saves no video. Session files contain numbers only, and stay on this computer unless you share them.',
  'The Presage SmartSpectra SDK measures your pulse, breathing, face and expression. Presage documents vitals as computed on your device, but it needs the internet to check the API key and usage.',
  "HUSH turns off the SDK's optional telemetry and doesn't use its cloud LLM feature. No accounts, no analytics.",
];

export const SETUP_TIPS = [
  'Put a lamp or window in front of you, not behind. Your screen alone is not enough, and its flicker can affect the reading.',
  'Sit back so your face and upper chest are both in view.',
  "Rest your camera on something solid. A moving camera can't read breathing.",
  'Plain, lighter clothes read best. Very dark tops or tight stripes make breathing harder to read.',
];

export const ROOM_NAMES = {
  desk: 'Security Desk',
  corridor: 'Corridor',
  control: 'Control Room',
  archive: 'Tape Archive',
  boiler: 'Boiler Room',
} as const;
