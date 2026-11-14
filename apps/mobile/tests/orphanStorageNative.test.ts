import { walletUiFixture } from './walletUiFixture.ts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import * as coordinator from '../src/storage/coordinator.ts';
import { WalletStorageError } from '../src/storage/types.ts';

const ready = JSON.stringify({ version: 1, status: 'ready', installationId: '1'.repeat(32), key: '2'.repeat(64) });
const settle = () => new Promise<void>(resolve => setImmediate(resolve));

function fixture() {
  let held = false, acquisitions = 0, reads = 0, releases = 0, unavailable = false;
  let gate: ReturnType<typeof Promise.withResolvers<string | null>> | null = Promise.withResolvers<string | null>();
  const policy = {
    async acquire() {
      acquisitions++; assert.equal(held, false, 'only one orphan probe may hold the native lease'); held = true;
      return { token: 'lease', directory: 'private-fixture', databaseExists: false };
    },
    async inspect(token: string) { assert.equal(token, 'lease'); assert(held); return { databaseExists: false }; },
    async release(token: string) { assert.equal(token, 'lease'); assert(held); releases++; held = false; },
  };
  const modules: Record<string, unknown> = {
    'expo-modules-core': { requireNativeModule(name: string) {
      assert.equal(name, 'PaliWalletStorage'); if (unavailable) throw Error('NATIVE_UNAVAILABLE'); return policy;
    } },
    'expo-secure-store': {
      WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only',
      async getItemAsync(name: string, options: Record<string, unknown>) {
        reads++; assert.equal(name, coordinator.WALLET_KEY_NAME);
        assert.equal(options.keychainService, coordinator.WALLET_KEY_SERVICE);
        assert.equal(options.keychainAccessible, 'device-only'); assert.equal(options.requireAuthentication, false);
        return gate ? gate.promise : ready;
      },
      deleteItemAsync() { assert.fail('availability probe must never delete a key'); },
      setItemAsync() { assert.fail('availability probe must never write a key'); },
    },
    'expo-sqlite': { openDatabaseAsync() { assert.fail('availability probe must not open a database'); } },
    './coordinator.ts': coordinator,
    './sqlCipher.ts': { requireSqlCipher() { assert.fail('availability probe must not open SQLCipher'); } },
    './types.ts': { WalletStorageError },
    './openStages.ts': { observeStorageOpen() {} },
    './nativePolicyDiagnostic.ts': { observeNativeStoragePolicy() { assert.fail('availability probe uses its own read-only policy'); } },
  };
  const module = { exports: {} as { canResetNativeWalletStorage(): Promise<boolean> } };
  const source = readFileSync(new URL('../src/storage/native.native.ts', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  runInNewContext(code, { module, exports: module.exports, require(name: string) { const walletUi = walletUiFixture(name, modules); if (walletUi) return walletUi;
    assert(Object.hasOwn(modules, name), `Unexpected native storage import: ${name}`); return modules[name];
  } });
  return {
    probe: module.exports.canResetNativeWalletStorage,
    counts: () => ({ held, acquisitions, reads, releases }),
    resolve() { const active = gate; gate = null; active?.resolve(ready); },
    reject() { const active = gate; gate = null; active?.reject(Error('SECURE_READ_UNAVAILABLE')); },
    unavailable(value: boolean) { unavailable = value; },
  };
}

test('remounted orphan consumer joins a held key read instead of seeing a busy lease', async () => {
  const f = fixture();
  const firstMount = f.probe(); await settle();
  assert.deepEqual(f.counts(), { held: true, acquisitions: 1, reads: 1, releases: 0 });
  // The first screen may have unmounted; its read is drained and shared by the new screen.
  const remount = f.probe(); assert.strictEqual(remount, firstMount);
  f.resolve(); assert.deepEqual(await Promise.all([firstMount, remount]), [true, true]);
  assert.deepEqual(f.counts(), { held: false, acquisitions: 1, reads: 1, releases: 1 });
  const refresh = f.probe(); assert.notStrictEqual(refresh, firstMount); assert.equal(await refresh, true);
  assert.deepEqual(f.counts(), { held: false, acquisitions: 2, reads: 2, releases: 2 });
});

test('failed shared key read drains its lease and allows a fresh successful probe', async () => {
  const f = fixture();
  const first = f.probe(); await settle(); const second = f.probe();
  f.reject(); assert.deepEqual(await Promise.all([first, second]), [false, false]);
  assert.deepEqual(f.counts(), { held: false, acquisitions: 1, reads: 1, releases: 1 });
  assert.equal(await f.probe(), true);
  assert.deepEqual(f.counts(), { held: false, acquisitions: 2, reads: 2, releases: 2 });
});

test('native module rejection clears the pending probe for a later mount', async () => {
  const f = fixture(); f.unavailable(true);
  const first = f.probe(), second = f.probe(); assert.strictEqual(first, second);
  await assert.rejects(first, /NATIVE_UNAVAILABLE/); await assert.rejects(second, /NATIVE_UNAVAILABLE/);
  assert.deepEqual(f.counts(), { held: false, acquisitions: 0, reads: 0, releases: 0 });
  f.unavailable(false); f.resolve(); assert.equal(await f.probe(), true);
  assert.deepEqual(f.counts(), { held: false, acquisitions: 1, reads: 1, releases: 1 });
});
