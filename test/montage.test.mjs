import assert from 'node:assert/strict';
import test from 'node:test';

import { montageFrame, scrollProgress, stageAt, stagePosition } from '../public/montage.js';

test('progress starts at the full-screen section and ends when the sticky frame releases', () => {
  assert.equal(scrollProgress(120, 960), 0);
  assert.equal(scrollProgress(-480, 960), 0.5);
  assert.equal(scrollProgress(-1200, 960), 1);
  assert.equal(scrollProgress(-20, 0), 0);
});

test('captions follow the five actual stages of the time-lapse in both directions', () => {
  assert.deepEqual([0, 0.15, 0.16, 0.37, 0.68, 0.9, 1, 0.5, 0].map(stageAt),
    [0, 0, 1, 2, 3, 4, 4, 2, 0]);
});

test('manual navigation seeks to a visible point inside each actual stage', () => {
  const positions = [0, 1, 2, 3, 4].map(stagePosition);
  assert.deepEqual(positions.map(stageAt), [0, 1, 2, 3, 4]);
  assert.ok(positions[0] > 0 && positions[4] < 1);
});

test('scroll selects consecutive frames from the generated time-lapse across sheet boundaries', () => {
  assert.deepEqual(montageFrame(0), { sheet: 0, column: 0, row: 0 });
  assert.deepEqual(montageFrame(15 / 95), { sheet: 0, column: 3, row: 3 });
  assert.deepEqual(montageFrame(16 / 95), { sheet: 1, column: 0, row: 0 });
  assert.deepEqual(montageFrame(1), { sheet: 5, column: 3, row: 3 });
});
