import test from 'node:test';
import assert from 'node:assert/strict';
import { NoiseCalibrator } from '../src/calibration.js';

test('calibration produces hysteresis thresholds from a quiet room', () => {
  const calibrator = new NoiseCalibrator(2000);
  for (let time = 0; time <= 2000; time += 100) calibrator.add(0.004, time);
  const result = calibrator.finish();
  assert.equal(result.ok, true);
  assert.ok(result.openDb > result.closeDb);
});

test('calibration rejects a sustained voice during the quiet check', () => {
  const calibrator = new NoiseCalibrator(2000);
  for (let time = 0; time <= 1600; time += 100) calibrator.add(time < 300 ? 0.004 : 0.1, time);
  assert.equal(calibrator.finish().reason, 'voice-detected');
});
