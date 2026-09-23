import { frequencyFromMidi, targetForIndex, targetMidiForIndex } from './music.js';

export const GAME_DEFAULTS = {
  boardWidth: 900,
  approachMs: 4000,
  innerToleranceCents: 50,
  holdMs: 300,
  dropoutGraceMs: 100,
  boardWidthPx: 48,
  ballXRatio: 0.2,
};

export function gateCanClear({ pitchMidi, targetMidi, current, toleranceCents = GAME_DEFAULTS.innerToleranceCents }) {
  if (!current || !Number.isFinite(pitchMidi) || !Number.isFinite(targetMidi)) return false;
  return Math.abs((pitchMidi - targetMidi) * 100) <= toleranceCents;
}

export class ToneGame {
  constructor(range, options = {}) {
    this.range = range;
    this.options = { ...GAME_DEFAULTS, ...options };
    this.reset();
  }

  reset() {
    this.gateIndex = 0;
    this.gatesCleared = 0;
    this.gateX = 0;
    this.gateWidth = this.options.boardWidthPx;
    this.phase = 'approach';
    this.holdMs = 0;
    this.lastValidAt = null;
    this.complete = false;
    this.paused = false;
    this.viewportWidth = 900;
  }

  setRange(range) { this.range = range; this.reset(); }
  setViewport(width) { this.viewportWidth = Math.max(320, width || 900); if (this.gateX === 0) this.gateX = this.viewportWidth * 0.82; }
  setPaused(paused) { this.paused = paused; }

  get target() { return targetForIndex(this.gateIndex, this.range); }
  get targetMidi() { return targetMidiForIndex(this.gateIndex, this.range); }
  get waitX() { return this.viewportWidth * this.options.ballXRatio + 58; }
  get ballX() { return this.viewportWidth * this.options.ballXRatio; }
  get approachSpeed() { return Math.max(45, (this.viewportWidth * 0.82 - this.waitX) / (this.options.approachMs / 1000)); }

  update(dtMs, observation = {}) {
    if (this.complete || this.paused) return this.snapshot(observation);
    const dt = Math.max(0, Math.min(dtMs, 80));
    if (this.phase === 'approach') {
      this.gateX -= this.approachSpeed * dt / 1000;
      if (this.gateX <= this.waitX) { this.gateX = this.waitX; this.phase = 'holding'; }
    }
    if (this.phase === 'holding') this.updateHold(dt, observation);
    if (this.phase === 'crossing') {
      this.gateX -= this.viewportWidth * 0.55 * dt / 1000;
      if (this.gateX < -this.gateWidth - 10) {
        this.gatesCleared += 1;
        if (this.gateIndex >= 7) { this.complete = true; this.phase = 'complete'; }
        else { this.gateIndex += 1; this.gateX = this.viewportWidth * 0.82; this.phase = 'approach'; this.holdMs = 0; this.lastValidAt = null; }
      }
    }
    return this.snapshot(observation);
  }

  updateHold(dt, observation) {
    const current = observation.current === true && Number.isFinite(observation.midi);
    const cents = current ? Math.abs((observation.midi - this.targetMidi) * 100) : null;
    if (current && cents <= this.options.innerToleranceCents) {
      this.holdMs += dt;
      this.lastValidAt = 0;
    } else if (!current && this.lastValidAt !== null && (observation.ageMs || 0) <= this.options.dropoutGraceMs) {
      this.lastValidAt = (this.lastValidAt || 0) + dt;
    } else {
      this.holdMs = 0;
      this.lastValidAt = null;
    }
    if (this.holdMs >= this.options.holdMs) this.phase = 'crossing';
  }

  snapshot(observation = {}) {
    const cents = observation.current && Number.isFinite(observation.midi) ? Math.round((observation.midi - this.targetMidi) * 100) : null;
    return { gateIndex: this.gateIndex, gatesCleared: this.gatesCleared, gateX: this.gateX, phase: this.phase, holdMs: this.holdMs, holdProgress: Math.min(1, this.holdMs / this.options.holdMs), complete: this.complete, target: this.target, targetMidi: this.targetMidi, cents, inTune: cents !== null && Math.abs(cents) <= this.options.innerToleranceCents };
  }
}

export function referenceFrequency(targetMidi) { return frequencyFromMidi(targetMidi); }
