import { describe, expect, it } from 'vitest';
import {
  FRAME_HEADER_BYTES,
  isAuthFailure,
  isLogNoise,
  mergeFrames,
  parseFrameHeader,
  safeSessionName,
  StartWatchdog,
} from '../src/protocol';

describe('parseFrameHeader', () => {
  it('reads the browser header', () => {
    const b = Buffer.alloc(FRAME_HEADER_BYTES + 4);
    b.writeUInt32LE(1280, 0);
    b.writeUInt32LE(720, 4);
    b.writeUInt32LE(1280, 8);
    b.writeUInt32LE(4, 12);
    b.writeDoubleLE(1.5e6, 16);
    expect(parseFrameHeader(b)).toEqual({
      width: 1280,
      height: 720,
      stride: 1280,
      pixelFormat: 4,
      timestampUs: 1.5e6,
    });
  });

  it('rejects short or empty frames', () => {
    expect(parseFrameHeader(Buffer.alloc(4))).toBeNull();
    expect(parseFrameHeader(Buffer.alloc(FRAME_HEADER_BYTES))).toBeNull();
  });
});

describe('safeSessionName', () => {
  it('blocks path traversal', () => {
    expect(safeSessionName('calm_60s')).toBe('calm_60s');
    expect(safeSessionName('../../evil')).toBeNull();
    expect(safeSessionName('a/b')).toBeNull();
    expect(safeSessionName('')).toBeNull();
    expect(safeSessionName(5)).toBeNull();
  });
});

describe('mergeFrames', () => {
  it('accumulates waveforms and keeps the newest scalars', () => {
    const a = {
      t: 1,
      source: 'live' as const,
      pulse: { bpm: 70, conf: 1 },
      pleth: { samples: [1, 2], hz: 30 },
    };
    const b = { t: 2, source: 'live' as const, pleth: { samples: [3], hz: 30 } };
    const merged = mergeFrames(a, b);
    expect(merged.t).toBe(2);
    expect(merged.pulse?.bpm).toBe(70);
    expect(merged.pleth?.samples).toEqual([1, 2, 3]);
    expect(mergeFrames(null, b)).toBe(b);
  });
});

describe('SDK log reading', () => {
  it('recognises a rejected key', () => {
    expect(isAuthFailure('{"detail":"Invalid or missing API key"}')).toBe(true);
    expect(isAuthFailure('auth_client.cc:441] Usage verification failed. Status code: 401')).toBe(
      true,
    );
  });
  it('does not mistake a network timeout for a bad key', () => {
    expect(isAuthFailure('Usage verification failed. Status code: 0')).toBe(false);
  });
  it('filters known noise only', () => {
    expect(isLogNoise('W0000 inference_feedback_manager.cc:114] Feedback manager')).toBe(true);
    expect(isLogNoise('E2026 physiology_inference_calculator.cc:562] Model load failed.')).toBe(
      false,
    );
  });
});

describe('StartWatchdog', () => {
  it('fires only when start never reached running', () => {
    const w = new StartWatchdog(100);
    expect(w.expired(1000)).toBe(false);
    w.begin(0);
    expect(w.expired(50)).toBe(false);
    expect(w.expired(101)).toBe(true);
    w.markRunning();
    expect(w.expired(500)).toBe(false);
    w.begin(0);
    w.clear();
    expect(w.expired(500)).toBe(false);
  });
});
