import test from 'node:test';
import assert from 'node:assert/strict';
import { createStorageQualificationDiagnostic } from '../qualification/storage-diagnostics.ts';
import { observeStorageOpen } from '../src/storage/openStages.ts';
import type { StorageOpenStage } from '../src/storage/openStages.ts';
import { WalletStorageError } from '../src/storage/types.ts';

test('qualification storage evidence admits only fixed stages and typed codes', () => {
  const diagnostic = createStorageQualificationDiagnostic();
  diagnostic.observe('key-read');
  diagnostic.observe('SECRET path SQL keychain value' as StorageOpenStage);
  const failure = new WalletStorageError('STORAGE_ORPHAN_KEY');
  Object.defineProperty(failure, 'message', {
    get: () => { throw Error('Exception text must not be inspected'); },
  });
  diagnostic.capture(failure);
  diagnostic.observe('ready'); // Cleanup cannot overwrite the failing checkpoint.
  assert.deepEqual(diagnostic.report(), {
    stage: 'key-read',
    code: 'STORAGE_ORPHAN_KEY',
  });
  assert.equal(Object.isFrozen(diagnostic.report()), true);
});

test('untyped exceptions and a successful open expose no incidental values', () => {
  const failed = createStorageQualificationDiagnostic();
  failed.observe('sqlite-open');
  failed.capture({ code: 'STORAGE_UNAVAILABLE', message: 'SECRET' });
  assert.deepEqual(failed.report(), { stage: 'sqlite-open' });
  const completed = createStorageQualificationDiagnostic();
  completed.observe('ready');
  completed.observe('key-read');
  completed.capture(new WalletStorageError('STORAGE_UNAVAILABLE'));
  assert.deepEqual(completed.report(), { stage: 'ready' });
});

test('hostile error accessors and proxies cannot replace the original failure', () => {
  let reads = 0;
  const errors = [
    new Proxy({}, { getPrototypeOf() { throw Error('SECRET proxy'); } }),
    new Proxy(new WalletStorageError('STORAGE_CORRUPT'), {
      getOwnPropertyDescriptor() { throw Error('SECRET descriptor'); },
    }),
    Object.defineProperty(new WalletStorageError('STORAGE_CORRUPT'), 'code', {
      get() { reads++; throw Error('SECRET getter'); },
    }),
    Object.defineProperty(new WalletStorageError('STORAGE_CORRUPT'), 'code', {
      get() { reads++; return reads === 1 ? 'STORAGE_CORRUPT' : 'SECRET changing code'; },
    }),
  ];
  for (const error of errors) {
    const diagnostic = createStorageQualificationDiagnostic();
    diagnostic.observe('key-read');
    assert.doesNotThrow(() => diagnostic.capture(error));
    diagnostic.observe('ready');
    assert.deepEqual(diagnostic.report(), { stage: 'key-read' });
  }
  assert.equal(reads, 0);
});

test('omitted, throwing and rejecting storage observers cannot alter the caller', async () => {
  assert.doesNotThrow(() => observeStorageOpen(undefined, 'policy-acquire'));
  assert.doesNotThrow(() => observeStorageOpen(() => {
    throw Error('SECRET observer failure');
  }, 'policy-acquire'));
  observeStorageOpen(async () => { throw Error('SECRET async observer failure'); }, 'policy-acquire');
  observeStorageOpen(() => ({ then: () => { throw Error('SECRET thenable failure'); } }), 'policy-acquire');
  await new Promise<void>((resolve) => setImmediate(resolve));
});
