import assert from 'node:assert/strict';
import test from 'node:test';
import { getAddress } from 'ethers/address';
import { inspectGuardianRemovals } from '../../../source/wallet/guardianRemoval.ts';
import { getPaliEntryPointAddress, getPaliModuleAddress, paliEntryPointInterface } from '../../../source/utils/smartAccount/contracts.ts';
import type { RetainedSmartAccountOperation } from '../../../source/wallet/smartAccountActivity.ts';

const account = '0x' + '11'.repeat(20), payer = '0x' + '22'.repeat(20);
const moduleAddress = getAddress(getPaliModuleAddress(1, 'guardian-recovery'));
const blockHash = '0x' + 'aa'.repeat(32);
const entry = (nonce: number): RetainedSmartAccountOperation => ({ account, chainId: '1', payer, payerNonce: nonce,
  hash: '0x' + (nonce + 1).toString(16).padStart(64, '0'), operationHash: '0x' + (nonce + 2).toString(16).padStart(64, '0'),
  operationNonce: String(nonce), guardianRemoval: { moduleAddress } });
function fixture(entries: RetainedSmartAccountOperation[], mode: 'mined' | 'missing' | 'failed' = 'missing') {
  let receipts = 0, live = true, nonce = '0x0';
  let current = entries;
  const inspect = () => inspectGuardianRemovals({ account, chainId: 1, moduleAddress,
    assertCurrent() { assert(live); },
    records: { profileId: 'ab'.repeat(32), async read(fresh) { assert(fresh); return current; } },
    async read(method, params) {
      if (mode === 'failed') throw Error('unavailable');
      if (method === 'eth_chainId') return '0x1';
      if (method === 'eth_getTransactionCount') return nonce;
      if (method === 'eth_getBlockByNumber') return { number: '0x1', hash: blockHash, gasLimit: '0x100000' };
      receipts++;
      if (mode === 'missing') return null;
      const candidate = entries.find(value => value.hash === params[0])!;
      const event = paliEntryPointInterface.encodeEventLog(paliEntryPointInterface.getEvent('UserOperationEvent')!,
        [candidate.operationHash, account, '0x' + '00'.repeat(20), candidate.operationNonce, true, 1, 1]);
      return { transactionHash: candidate.hash, from: payer, to: getPaliEntryPointAddress(1), status: '0x1', blockNumber: '0x1', blockHash,
        logs: [{ ...event, address: getPaliEntryPointAddress(1), transactionHash: candidate.hash, blockHash, blockNumber: '0x1' }] };
    },
  });
  return { inspect, receipts: () => receipts, nonce(value: string) { nonce = value; }, replace(value: RetainedSmartAccountOperation[]) { current = value; }, retire() { live = false; } };
}

test('unresolved authenticated removals block retry and bound public rows', async () => {
  const f = fixture(Array.from({ length: 25 }, (_, index) => entry(index)));
  const result = await f.inspect();
  assert.equal(result.status, 'pending'); assert.equal(result.totalPending, 25); assert.equal(result.transactions.length, 20);
});

test('49 historical removals share one canonical payer consumption bound', async () => {
  const f = fixture(Array.from({ length: 49 }, (_, index) => entry(index)), 'mined');
  assert.equal((await f.inspect()).status, 'retry-ready'); assert.equal(f.receipts(), 1);
});

test('49 distinct unresolved payers exhaust the bounded query budget without granting retry', async () => {
  const f = fixture(Array.from({ length: 49 }, (_, index) => ({ ...entry(index), payer: '0x' + (index + 1).toString(16).padStart(40, '0') })));
  const result = await f.inspect(); assert.equal(result.status, 'unknown'); assert.equal(f.receipts(), 48);
});

test('missing transactions use the canonical latest nonce to release consumed attempts', async () => {
  const f = fixture([entry(2), entry(1)]); f.nonce('0x3');
  assert.equal((await f.inspect()).status, 'retry-ready'); assert.equal(f.receipts(), 1);
});

test('RPC failure and retired owners cannot grant retry', async () => {
  await assert.rejects(fixture([entry(0)], 'failed').inspect());
  const f = fixture([entry(0)]); f.retire(); await assert.rejects(f.inspect());
});

test('a complete empty journal permits a fresh explicit removal review', async () => {
  const result = await inspectGuardianRemovals({ account, chainId: 1, moduleAddress,
    records: { profileId: 'ab'.repeat(32), async read() { return []; } }, assertCurrent() {}, async read() { assert.fail('no request'); } });
  assert.equal(result.status, 'retry-ready');
});


test('a changed authenticated journal during observation cannot grant retry', async () => {
  const f = fixture([entry(0)]);
  const pending = f.inspect();
  f.replace([]);
  await assert.rejects(pending, /records changed/);
});

test('an owner retired during observation cannot publish a result', async () => {
  const f = fixture([entry(0)]);
  const pending = f.inspect();
  f.retire();
  await assert.rejects(pending);
});
