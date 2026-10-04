import test from 'node:test';
import assert from 'node:assert/strict';

// Exercise the same dependency-free camera module that the browser serves.
const { GraphCamera, MIN_ZOOM, MAX_ZOOM } = await import(new URL('../packages/web/public/graph-viewport.js', import.meta.url).href);
const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test('dense and small graphs reset to readable CSS pixels and fit within the viewport', () => {
  for (const contentHeight of [230, 8091]) {
    const camera = new GraphCamera(850, contentHeight);
    camera.resize(400, 500);
    assert.equal(camera.scale, 1); assert.equal(camera.y, 20);
    camera.fit();
    assert.ok(camera.scale >= MIN_ZOOM && camera.scale <= 1);
    assert.ok(camera.x >= 20 && camera.y >= 20);
    assert.ok(camera.x + 850 * camera.scale <= 380 + 1e-8);
    assert.ok(camera.y + contentHeight * camera.scale <= 480 + 1e-8);
    camera.zoom(2); camera.pan(200, -700); camera.reset();
    assert.equal(camera.scale, 1); assert.equal(camera.x, 20); assert.equal(camera.y, 20);
  }
});

test('repeated pointer-anchored zoom preserves the graph point and clamps at both bounds', () => {
  const camera = new GraphCamera(850, 5000); camera.resize(800, 600);
  const anchorX = 123, anchorY = 456;
  const pointX = (anchorX - camera.x) / camera.scale, pointY = (anchorY - camera.y) / camera.scale;
  for (let i = 0; i < 50; i++) camera.zoom(1.25, anchorX, anchorY);
  assert.equal(camera.scale, MAX_ZOOM);
  near((anchorX - camera.x) / camera.scale, pointX); near((anchorY - camera.y) / camera.scale, pointY);
  const position = { x: camera.x, y: camera.y }; camera.zoom(1.25, anchorX, anchorY);
  near(camera.x, position.x); near(camera.y, position.y);
  for (let i = 0; i < 50; i++) camera.zoom(0.8, anchorX, anchorY);
  assert.equal(camera.scale, MIN_ZOOM);
  near((anchorX - camera.x) / camera.scale, pointX); near((anchorY - camera.y) / camera.scale, pointY);
});

test('resize retains manual viewport center, refits in fit mode, and ignores hidden dimensions', () => {
  const camera = new GraphCamera(850, 8091); camera.resize(800, 600);
  camera.zoom(2); camera.pan(25, -900);
  const centerX = (400 - camera.x) / camera.scale, centerY = (300 - camera.y) / camera.scale;
  camera.resize(350, 300);
  assert.equal(camera.scale, 2);
  near((175 - camera.x) / camera.scale, centerX); near((150 - camera.y) / camera.scale, centerY);
  const visible = { x: camera.x, y: camera.y, width: camera.width, height: camera.height };
  camera.resize(0, 0);
  assert.deepEqual({ x: camera.x, y: camera.y, width: camera.width, height: camera.height }, visible);
  camera.fit(); camera.resize(900, 600);
  near(camera.scale, 560 / 8091);
  camera.reset(); camera.resize(1000, 500);
  assert.equal(camera.scale, 1); assert.equal(camera.x, 75); assert.equal(camera.y, 20);
});
