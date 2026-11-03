import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import test from 'node:test';
import { captureQualificationCryptoLoad } from '../qualification/capture-crypto-load.ts';
import type { MetroErrorUtils } from '../src/crypto/quickCryptoLoad.ts';

async function withGuard(run: () => Promise<void>): Promise<void> {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'ErrorUtils');
  let handler: ReturnType<MetroErrorUtils['getGlobalHandler']> = () => undefined;
  Object.defineProperty(globalThis, 'ErrorUtils', { configurable: true, value: {
    getGlobalHandler: () => handler,
    setGlobalHandler: (value: typeof handler) => { handler = value; },
  } });
  try { await run(); }
  finally {
    if (previous) Object.defineProperty(globalThis, 'ErrorUtils', previous);
    else Reflect.deleteProperty(globalThis, 'ErrorUtils');
  }
}

test('successful qualification cold load preserves load-before-install order without emitting an error artifact', async () => withGuard(async () => {
  const events: string[] = [];
  await captureQualificationCryptoLoad(() => { events.push('load'); return {}; }, async () => { events.push('write'); }, () => { events.push('observe'); });
  events.push('install');
  assert.deepEqual(events, ['load', 'install']);
}));

test('a failed qualification cold load records the original error and never retries or creates a wallet', async () => withGuard(async () => {
  const original = new Error('exact public fixture failure');
  original.stack = 'Error: exact public fixture failure\n    at fixture (address at main.jsbundle:1:43)';
  let loads = 0, creates = 0;
  let artifact = '';
  await assert.rejects(captureQualificationCryptoLoad(() => { loads++; throw original; }, async (text) => { artifact = text; }, () => undefined)
    .then(() => { creates++; }), (error) => error === original);
  assert.equal(loads, 1);
  assert.equal(creates, 0);
  const parsed = JSON.parse(artifact);
  assert.equal(parsed.error.message, original.message);
  assert.equal(parsed.error.stack, original.stack);
  assert.equal(parsed.stage, 'quick-crypto-load');
}));

test('raw qualification error evidence remains within 64 KiB and failed writes cannot hide the original failure', async () => withGuard(async () => {
  const original = new Error('\u0000'.repeat(100000));
  original.stack = '🔐'.repeat(100000);
  let artifact = '';
  await assert.rejects(captureQualificationCryptoLoad(() => { throw original; }, async (text) => { artifact = text; throw Error('write failed'); }, () => undefined), (error) => error === original);
  assert(new TextEncoder().encode(artifact).byteLength <= 64 * 1024);
  assert.equal(JSON.parse(artifact).version, 1);
}));

test('production entries and bootstrap cannot import the qualification-only raw capture', () => {
  for (const path of ['../index.ts', '../src/entry.native.tsx', '../src/platform/cryptoBootstrap.native.ts']) {
    const source = readFileSync(new NodeURL(path, import.meta.url), 'utf8');
    assert(!source.includes('captureQualificationCryptoLoad'));
    assert(!/from ['"].*qualification\//.test(source));
  }
  const pkg = JSON.parse(readFileSync(new NodeURL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.main, 'index.ts');
});
