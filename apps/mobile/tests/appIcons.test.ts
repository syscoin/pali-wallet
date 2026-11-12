import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

const root = new URL('../', import.meta.url);
const { expo } = JSON.parse(readFileSync(new URL('app.json', root), 'utf8'));
function png(asset: string) {
  const bytes = readFileSync(new URL(asset, root));
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(bytes.subarray(12, 16).toString('ascii'), 'IHDR');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), colorType: bytes[25] };
}

test('the installed iOS icon is a configured opaque 1024px RGB image', () => {
  assert.equal(expo.icon, './assets/app-icon.png');
  assert.deepEqual(png(expo.icon), { width: 1024, height: 1024, colorType: 2 });
});

test('Android has separate adaptive, themed and notification icon assets', () => {
  const adaptive = expo.android.adaptiveIcon;
  assert.equal(adaptive.backgroundColor, '#07152a');
  for (const asset of [adaptive.foregroundImage, adaptive.monochromeImage]) {
    assert.deepEqual(png(asset), { width: 1024, height: 1024, colorType: 6 });
  }
  const notifications = expo.plugins.find((plugin: unknown) => Array.isArray(plugin) && plugin[0] === 'expo-notifications');
  assert.deepEqual(png(notifications[1].icon), { width: 96, height: 96, colorType: 6 });
});

test('icon vector sources retain the official Pali mark geometry', () => {
  const paths = (source: string) => [...source.matchAll(/<path[^>]*\sd="([^"]+)"/g)].map(match => match[1]);
  const original = paths(readFileSync(new URL('../../docs/portal/static/img/logo.svg', root), 'utf8'));
  assert.equal(original.length, 2);
  for (const asset of ['app-icon', 'adaptive-icon', 'monochrome-icon', 'notification-icon']) {
    const source = readFileSync(new URL(`assets/${asset}.svg`, root), 'utf8');
    assert.deepEqual(paths(source), original);
    assert(!source.includes('<image'), 'icons must be rendered from vector paths, not an enlarged bitmap');
  }
});
