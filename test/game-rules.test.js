import test from 'node:test';
import assert from 'node:assert/strict';
import { ToneGame, gateCanClear } from '../src/game-rules.js';
import { RANGE_PRESETS } from '../src/music.js';

test('exactly zero cents is a valid gate hit', () => {
  assert.equal(gateCanClear({ pitchMidi: 48, targetMidi: 48, current: true }), true);
  assert.equal(gateCanClear({ pitchMidi: 48, targetMidi: 48, current: false }), false);
});

test('a gate waits for a stable note and never penalizes a breath', () => {
  const game = new ToneGame(RANGE_PRESETS.lower, { approachMs: 100, holdMs: 300 });
  game.setViewport(900);
  let snapshot = game.update(80, { current: false, midi: null, ageMs: Infinity });
  snapshot = game.update(20, { current: false, midi: null, ageMs: Infinity });
  assert.equal(snapshot.phase, 'holding');
  snapshot = game.update(100, { current: true, midi: game.targetMidi });
  assert.equal(snapshot.holdProgress > 0, true);
  snapshot = game.update(100, { current: false, midi: game.targetMidi, ageMs: 50 });
  assert.equal(snapshot.holdProgress > 0, true);
  snapshot = game.update(80, { current: true, midi: game.targetMidi });
  snapshot = game.update(80, { current: true, midi: game.targetMidi });
  snapshot = game.update(80, { current: true, midi: game.targetMidi });
  assert.equal(snapshot.phase, 'crossing');
  assert.equal(snapshot.gatesCleared, 0);
});

test('the eighth gate completes the scale after it fully clears', () => {
  const game = new ToneGame(RANGE_PRESETS.lower, { approachMs: 1, holdMs: 1 });
  game.setViewport(500);
  for (let gate = 0; gate < 8; gate += 1) {
    for (let frame = 0; frame < 12; frame += 1) game.update(80, { current: true, midi: game.targetMidi });
    for (let frame = 0; frame < 50; frame += 1) game.update(80, { current: true, midi: game.targetMidi });
  }
  assert.equal(game.complete, true);
  assert.equal(game.gatesCleared, 8);
});
