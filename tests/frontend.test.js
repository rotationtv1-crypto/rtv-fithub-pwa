const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = filename => fs.readFileSync(path.join(root, filename), 'utf8');

test('PWA shell provides install action, wallet, workouts mount, manifest and ecosystem footer', () => {
  const html = read('index.html');
  for (const expected of ['id="install-button"', 'id="coin-count"', 'id="workout-list"',
    'href="./manifest.json"', 'src="./app.js"', 'A Member of the RotationTV Network Ecosystem']) {
    assert.ok(html.includes(expected), `missing ${expected}`);
  }
  const manifest = JSON.parse(read('manifest.json'));
  assert.equal(manifest.start_url, './index.html?source=pwa');
  for (const icon of manifest.icons) assert.ok(fs.statSync(path.join(root, icon.src)).size > 1000);
});

test('all five workouts have valid step lists and one unique completion ID', () => {
  const workouts = JSON.parse(read('workouts.json'));
  assert.equal(workouts.length, 5);
  assert.equal(new Set(workouts.map(item => item.id)).size, 5);
  for (const workout of workouts) {
    assert.ok(workout.steps.length > 0);
    assert.ok(workout.coins > 0);
  }
});

test('offline shell includes every runtime static dependency and excludes API endpoints', () => {
  const worker = read('service-worker.js');
  for (const asset of ['index.html', 'app.js', 'config.js', 'workouts.json', 'manifest.json', 'icon-192.png', 'icon-512.png']) {
    assert.ok(worker.includes(asset), `missing offline asset ${asset}`);
  }
  assert.match(worker, /event\.request\.method !== 'GET'/);
  assert.match(worker, /pathname\.includes\('\/api\/'\)/);
});
