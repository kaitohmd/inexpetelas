const test = require('node:test');
const assert = require('node:assert/strict');
const quality = require('../screen-quality.js');

test('focused screen keeps selected quality and grid preview remains 720p30', () => {
  const focused = quality.outgoingProfile(true, 'smooth', 3);
  const preview = quality.outgoingProfile(false, 'smooth', 3);

  assert.deepEqual([focused.width, focused.height, focused.maxFramerate, focused.scaleResolutionDownBy], [1280, 720, 60, 1]);
  assert.deepEqual([preview.width, preview.height, preview.maxFramerate, preview.scaleResolutionDownBy], [1280, 720, 30, 1]);
  assert.ok(preview.maxBitrate < focused.maxBitrate);
});

test('SFU upstream bitrate stays one stream regardless of viewer count', () => {
  for (let viewers = 0; viewers <= 7; viewers += 1) {
    assert.equal(quality.outgoingProfile(true, 'sharp', viewers).maxBitrate, quality.maxUpstreamBitrate);
    assert.equal(quality.outgoingProfile(true, 'smooth', viewers).maxBitrate, 5_000_000);
  }
});

test('capture starts at the selected maximum so Chromium can later deliver full quality', () => {
  assert.deepEqual(quality.captureProfile(false, 'smooth'), { width: 1280, height: 720, frameRate: 60 });
  assert.deepEqual(quality.captureProfile(true, 'smooth'), { width: 1280, height: 720, frameRate: 60 });
});

test('CPU pressure reduces sender load without locking the capture track at low quality', () => {
  assert.deepEqual(quality.captureProfile(true, 'smooth', true), { width: 1280, height: 720, frameRate: 60 });
  assert.equal(quality.outgoingProfile(true, 'sharp', 4, true).maxFramerate, 24);
  assert.equal(quality.outgoingProfile(true, 'smooth', 4, true).scaleResolutionDownBy, 1.33);
  assert.equal(quality.outgoingProfile(false, 'smooth', 4).priority, 'high');
});
