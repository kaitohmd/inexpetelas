const test = require('node:test');
const assert = require('node:assert/strict');
const quality = require('../screen-quality.js');

test('focused screen keeps selected quality and preview streams are downscaled', () => {
  const focused = quality.outgoingProfile(true, 'smooth', 3);
  const preview = quality.outgoingProfile(false, 'smooth', 3);

  assert.deepEqual([focused.width, focused.height, focused.maxFramerate, focused.scaleResolutionDownBy], [1280, 720, 60, 1]);
  assert.deepEqual([preview.width, preview.height, preview.maxFramerate, preview.scaleResolutionDownBy], [640, 360, 15, 1]);
  assert.ok(preview.maxBitrate < focused.maxBitrate);
});

test('SFU upstream bitrate stays one stream regardless of viewer count', () => {
  for (let viewers = 0; viewers <= 7; viewers += 1) {
    assert.equal(quality.outgoingProfile(true, 'sharp', viewers).maxBitrate, quality.maxUpstreamBitrate);
    assert.equal(quality.outgoingProfile(true, 'smooth', viewers).maxBitrate, 5_000_000);
  }
});

test('capture keeps previews fluid until somebody focuses the stream', () => {
  assert.deepEqual(quality.captureProfile(false, 'smooth'), { width: 640, height: 360, frameRate: 15 });
  assert.deepEqual(quality.captureProfile(true, 'smooth'), { width: 1280, height: 720, frameRate: 60 });
});

test('CPU pressure reduces a focused share to 540p24 and deprioritizes preview encoders', () => {
  assert.deepEqual(quality.captureProfile(true, 'smooth', true), { width: 960, height: 540, frameRate: 24 });
  assert.equal(quality.outgoingProfile(true, 'sharp', 4, true).maxFramerate, 24);
  assert.equal(quality.outgoingProfile(false, 'smooth', 4).priority, 'low');
});
