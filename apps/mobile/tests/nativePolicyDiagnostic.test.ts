import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import test from 'node:test';

import { createStorageQualificationDiagnostic } from '../qualification/storage-diagnostics.ts';
import { createNativePolicyObserver } from '../src/storage/nativePolicyDiagnostic.ts';
import { STORAGE_OPEN_STAGES } from '../src/storage/openStages.ts';

test('native policy diagnostic preserves success, failure identity, and the first failing operation', async () => {
  const diagnostic = createStorageQualificationDiagnostic();
  diagnostic.observe('policy-acquire');
  const observe = createNativePolicyObserver(diagnostic.observe);
  const value = {};
  let calls = 0;
  assert.equal(await observe(async () => { calls++; return value; }), value);
  const first = Object.assign(Error('SECRET native error'), { code: 'PALI_STORAGE_POLICY_BACKUP_CHECK' });
  await assert.rejects(observe(async () => { calls++; throw first; }), (error) => error === first);
  assert.deepEqual(diagnostic.report(), { stage: 'ios-policy-backup-check' });
  const cleanup = { code: 'PALI_STORAGE_POLICY_LEASE_RELEASE' };
  await assert.rejects(observe(async () => { calls++; throw cleanup; }), (error) => error === cleanup);
  assert.equal(calls, 3);
  assert.deepEqual(diagnostic.report(), { stage: 'ios-policy-backup-check' });
});

test('malformed native error codes cannot invoke accessors, change diagnostics or replace errors', async () => {
  let reads = 0;
  const errors = [
    null,
    'SECRET',
    { code: 'SECRET code' },
    { code: 'PALI_STORAGE_POLICY_BACKUP_CHECK suffix' },
    Object.create({ code: 'PALI_STORAGE_POLICY_BACKUP_CHECK' }),
    Object.defineProperty({}, 'code', { get() { reads++; throw Error('SECRET getter'); } }),
    Object.defineProperty({}, 'code', { get() { reads++; return reads === 1 ? 'PALI_STORAGE_POLICY_BACKUP_CHECK' : 'SECRET'; } }),
    new Proxy({}, { getOwnPropertyDescriptor() { throw Error('SECRET proxy'); } }),
  ];
  for (const failure of errors) {
    const stages: string[] = [];
    const observe = createNativePolicyObserver((stage) => { stages.push(stage); });
    let observed: unknown = 'not rejected';
    try { await observe(async () => { throw failure; }); } catch (error) { observed = error; }
    assert.equal(observed, failure);
    assert.deepEqual(stages, []);
    // Even an unknown first failure cannot be replaced by a cleanup diagnosis.
    await assert.rejects(observe(async () => { throw { code: 'PALI_STORAGE_POLICY_LEASE_RELEASE' }; }));
    assert.deepEqual(stages, []);
  }
  assert.equal(reads, 0);
});

test('native policy observer failures remain inert, including rejection and thenable failure', async () => {
  const failure = { code: 'PALI_STORAGE_POLICY_DIRECTORY_CREATE' };
  for (const observer of [
    undefined,
    () => { throw Error('observer failure'); },
    async () => { throw Error('async observer failure'); },
    () => ({ then() { throw Error('thenable observer failure'); } }),
  ]) {
    const observe = createNativePolicyObserver(observer);
    await assert.rejects(observe(async () => { throw failure; }), (error) => error === failure);
  }
  await new Promise<void>((resolve) => setImmediate(resolve));
});

test('all fixed Swift policy failure codes are represented by the TypeScript boundary', async () => {
  const swift = readFileSync(new NodeURL('../modules/pali-wallet-storage/ios/PaliWalletStorageModule.swift', import.meta.url), 'utf8');
  const codes = [...swift.matchAll(/case \w+ = "(PALI_STORAGE_POLICY_[A-Z_]+)"/g)].map((match) => match[1]!);
  assert.equal(codes.length, 22);
  for (const code of codes) {
    const observed: string[] = [];
    const observe = createNativePolicyObserver((stage) => { observed.push(stage); });
    await assert.rejects(observe(async () => { throw { code }; }));
    const expected = `ios-policy-${code.slice('PALI_STORAGE_POLICY_'.length).toLowerCase().replaceAll('_', '-')}`;
    assert.deepEqual(observed, [expected]);
    assert.equal(STORAGE_OPEN_STAGES.includes(expected as (typeof STORAGE_OPEN_STAGES)[number]), true);
  }
});
