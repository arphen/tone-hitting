import test from 'node:test';
import assert from 'node:assert/strict';
import { RANGE_PRESETS, centsBetween, frequencyFromMidi, midiFromFrequency, midiToY, targetForIndex } from '../src/music.js';

test('music mapping round trips MIDI and frequency', () => {
  for (const midi of [48, 50, 52, 53, 55, 57, 59, 60]) {
    assert.ok(Math.abs(midiFromFrequency(frequencyFromMidi(midi)) - midi) < 1e-9);
  }
});

test('the eight solfege targets share one semitone scale', () => {
  assert.deepEqual([...Array(8)].map((_, index) => targetForIndex(index, RANGE_PRESETS.lower).midi), [48, 50, 52, 53, 55, 57, 59, 60]);
  assert.equal(centsBetween(440, 440), 0);
});

test('higher notes render higher on the board', () => {
  const ys = [48, 50, 52, 53, 55, 57, 59, 60].map((midi) => midiToY(midi, 400, RANGE_PRESETS.lower));
  assert.equal(ys[0] > ys.at(-1), true);
  assert.equal(ys.at(-1), 48);
});
