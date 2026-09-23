import { decibelsForRms, median } from './pitch-tracker.js';

export class NoiseCalibrator {
  constructor(durationMs = 2000) {
    this.durationMs = durationMs;
    this.reset();
  }

  reset() {
    this.startedAt = null;
    this.samples = [];
    this.peakDb = -Infinity;
  }

  start(timestampMs) {
    this.reset();
    this.startedAt = timestampMs;
  }

  add(rms, timestampMs) {
    if (this.startedAt === null) this.start(timestampMs);
    const db = decibelsForRms(rms);
    if (Number.isFinite(db)) this.samples.push(db);
    this.peakDb = Math.max(this.peakDb, db);
    const elapsedMs = timestampMs - this.startedAt;
    return { elapsedMs, progress: Math.min(1, elapsedMs / this.durationMs), complete: elapsedMs >= this.durationMs };
  }

  finish() {
    if (this.samples.length < 8) return { ok: false, reason: 'too-quiet', noiseDb: -Infinity };
    const sorted = [...this.samples].sort((a, b) => a - b);
    const quietSlice = sorted.slice(0, Math.max(1, Math.ceil(sorted.length * 0.25)));
    const noiseDb = median(quietSlice);
    const loudFrameCount = this.samples.filter((db) => db > noiseDb + 10).length;
    const speechDuringCalibration = loudFrameCount / this.samples.length > 0.25;
    if (speechDuringCalibration) return { ok: false, reason: 'voice-detected', noiseDb, peakDb: this.peakDb };
    return { ok: true, noiseDb, openDb: Math.max(-48, noiseDb + 10), closeDb: Math.max(-54, noiseDb + 6), peakDb: this.peakDb };
  }
}
