const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fitTiles } = require('../screen-layout');
for (const [width, height] of [[592,276],[1312,570],[1872,882],[2512,1242],[960,500]]) {
  for (let count = 1; count <= 8; count++) {
    test(`${count} screens fit ${width}x${height} without overflow`, () => {
      const box = fitTiles(width, height, count);
      const rows = Math.ceil(count / box.columns);
      assert.ok(box.width > 0 && box.height > 0);
      assert.ok(box.width * box.columns + 12 * (box.columns - 1) <= width + .001);
      assert.ok(box.height * rows + 12 * (rows - 1) <= height + .001);
      assert.ok(Math.abs(box.width / box.height - 16/9) < .001);
    });
  }
}
