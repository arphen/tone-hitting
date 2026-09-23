import { PitchDetector } from 'pitchy';
import { midiFromFrequency } from './music.js';

export const TRACKER_DEFAULTS = {
  frameSize: 4096,
  minHz: 70,
  maxHz: 1000,
  acquireClarity: 0.9,
  continueClarity: 0.85,
  defaultOpenDb: -48,
  defaultCloseDb: -54,
  dropoutGraceMs: 150,
  filterTauMs: 100,
  jumpSemitones: 7,
  jumpSettleMs: 130,
};

export function rmsFor(samples) {
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / samples.length);
}

export function decibelsForRms(rms) {
  return rms > 0 ? 20 * Math.log10(rms) : -Infinity;
}

export function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

export class PitchTracker {
  constructor(options = {}) {
    this.options = { ...TRACKER_DEFAULTS, ...options };
    this.detector = PitchDetector.forFloat32Array(this.options.frameSize);
    this.history = [];
    this.filteredMidi = null;
    this.lastTimestamp = null;
    this.lastCurrentAt = null;
    this.lastResult = this.emptyResult();
    this.jumpCandidate = null;
    this.openDb = this.options.defaultOpenDb;
    this.closeDb = this.options.defaultCloseDb;
  }

  emptyResult(overrides = {}) {
    return { current: false, voiced: false, pitchHz: null, midi: this.filteredMidi, clarity: 0, rms: 0, db: -Infinity, ageMs: Infinity, analysisMs: 0, reason: 'quiet', ...overrides };
  }

  setVoiceThresholds({ openDb, closeDb }) {
    if (Number.isFinite(openDb)) this.openDb = openDb;
    if (Number.isFinite(closeDb)) this.closeDb = closeDb;
  }

  reset() {
    this.history = [];
    this.filteredMidi = null;
    this.lastTimestamp = null;
    this.lastCurrentAt = null;
    this.lastResult = this.emptyResult();
    this.jumpCandidate = null;
  }

  process(samples, sampleRate, timestampMs = 0) {
    const started = typeof performance === 'undefined' ? Date.now() : performance.now();
    const rms = rmsFor(samples);
    const db = decibelsForRms(rms);
    const [pitchHz, clarity] = this.detector.findPitch(samples, sampleRate);
    const wasCurrent = this.lastCurrentAt !== null && timestampMs - this.lastCurrentAt <= this.options.dropoutGraceMs;
    const voiced = Number.isFinite(pitchHz) && pitchHz >= this.options.minHz && pitchHz <= this.options.maxHz && Number.isFinite(clarity) && clarity >= (this.lastResult.current ? this.options.continueClarity : this.options.acquireClarity) && db >= (this.lastResult.current ? this.closeDb : this.openDb);

    if (!voiced) {
      const ageMs = this.lastCurrentAt === null ? Infinity : timestampMs - this.lastCurrentAt;
      const displayMidi = this.filteredMidi;
      const stillVisible = displayMidi !== null && ageMs <= this.options.dropoutGraceMs;
      this.lastTimestamp = timestampMs;
      this.lastResult = this.emptyResult({ current: false, displayVisible: stillVisible, voiced: false, midi: stillVisible ? displayMidi : null, clarity: Number.isFinite(clarity) ? clarity : 0, rms, db, ageMs, reason: stillVisible ? 'dropout' : (db < this.openDb ? 'quiet' : 'unclear'), analysisMs: elapsedSince(started) });
      if (!stillVisible) { this.history = []; this.filteredMidi = null; }
      return this.lastResult;
    }

    const rawMidi = midiFromFrequency(pitchHz);
    this.history = [...this.history.slice(-2), rawMidi];
    const stableMidi = median(this.history);
    const previousMidi = this.filteredMidi;
    if (previousMidi !== null && Math.abs(stableMidi - previousMidi) > this.options.jumpSemitones) {
      if (!this.jumpCandidate || Math.abs(this.jumpCandidate.midi - stableMidi) > 1.5) this.jumpCandidate = { midi: stableMidi, startedAt: timestampMs };
      if (timestampMs - this.jumpCandidate.startedAt < this.options.jumpSettleMs) {
        this.lastTimestamp = timestampMs;
        this.lastResult = this.emptyResult({ current: false, displayVisible: wasCurrent, voiced: true, midi: previousMidi, pitchHz, clarity, rms, db, ageMs: 0, reason: 'settling', analysisMs: elapsedSince(started) });
        return this.lastResult;
      }
    } else {
      this.jumpCandidate = null;
    }

    const dtMs = this.lastTimestamp === null ? 25 : Math.max(1, timestampMs - this.lastTimestamp);
    const alpha = 1 - Math.exp(-dtMs / this.options.filterTauMs);
    this.filteredMidi = previousMidi === null ? stableMidi : previousMidi + (stableMidi - previousMidi) * alpha;
    this.lastCurrentAt = timestampMs;
    this.lastTimestamp = timestampMs;
    this.lastResult = { current: true, voiced: true, pitchHz, midi: this.filteredMidi, clarity, rms, db, ageMs: 0, reason: 'current', analysisMs: elapsedSince(started) };
    return this.lastResult;
  }
}

function elapsedSince(started) {
  const now = typeof performance === 'undefined' ? Date.now() : performance.now();
  return Math.max(0, now - started);
}
