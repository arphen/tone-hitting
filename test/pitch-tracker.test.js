import test from 'node:test';
import assert from 'node:assert/strict';
import { PitchTracker } from '../src/pitch-tracker.js';
import { frequencyFromMidi } from '../src/music.js';

const sampleRate = 48000;
const frameSize = 4096;

function tone(midi, amplitude = 0.12, noise = 0, phase = 0) {
  const frequency = frequencyFromMidi(midi);
  return Float32Array.from({ length: frameSize }, (_, index) => {
    const t = index / sampleRate;
    const fundamental = Math.sin(2 * Math.PI * frequency * t + phase);
    const second = 0.25 * Math.sin(4 * Math.PI * frequency * t + phase * 1.7);
    const seededNoise = noise * Math.sin(index * 12.9898 + phase * 7.31);
    return amplitude * (fundamental + second + seededNoise);
  });
}

test('detects clean and harmonic-rich targets at the actual sample rate', () => {
  const tracker = new PitchTracker({ frameSize, defaultOpenDb: -60 });
  for (const midi of [48, 52, 57, 60]) {
    tracker.reset();
    let result;
    for (let frame = 0; frame < 8; frame += 1) result = tracker.process(tone(midi, 0.12, 0.03, frame), sampleRate, frame * 25);
    assert.equal(result.current, true);
    assert.ok(Math.abs(result.midi - midi) < 0.1, `${midi} became ${result.midi}`);
    assert.ok(result.clarity > 0.85);
  }
});

test('does not let a single octave spike teleport the filtered pitch', () => {
  const tracker = new PitchTracker({ frameSize, defaultOpenDb: -60 });
  for (let frame = 0; frame < 8; frame += 1) tracker.process(tone(57), sampleRate, frame * 25);
  const spike = tracker.process(tone(69), sampleRate, 200);
  assert.ok(Math.abs(spike.midi - 57) < 0.1);
  const secondSpike = tracker.process(tone(69), sampleRate, 225);
  assert.equal(secondSpike.current, false);
  assert.ok(Math.abs(secondSpike.midi - 57) < 0.1);
});

test('brief dropouts freeze display without producing current evidence', () => {
  const tracker = new PitchTracker({ frameSize, defaultOpenDb: -60 });
  for (let frame = 0; frame < 4; frame += 1) tracker.process(tone(57), sampleRate, frame * 25);
  const dropout = tracker.process(new Float32Array(frameSize), sampleRate, 125);
  assert.equal(dropout.current, false);
  assert.equal(dropout.displayVisible, true);
  const silence = tracker.process(new Float32Array(frameSize), sampleRate, 325);
  assert.equal(silence.current, false);
  assert.equal(silence.midi, null);
});
