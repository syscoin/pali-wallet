import assert from 'node:assert/strict';
import test from 'node:test';
import { Wallet } from 'ethers/wallet';
import { keccak256 } from 'ethers/crypto';
import { NativeTransferJournal, journalRequiresReopen } from '../src/custody/transferJournal.ts';
import type { KeyringStoragePort } from '../src/storage/types.ts';

const wallet = Wallet.fromPhrase(
  'test test test test test test test test test test test junk'
);
const scope = {
  walletFingerprint: '1'.repeat(64),
  address: wallet.address,
  chainId: '1' as const,
};
async function raw(nonce = 0, overrides: Record<string, unknown> = {}) {
  return wallet.signTransaction({
    type: 2,
    chainId: 1,
    nonce,
    to: '0x1111111111111111111111111111111111111111',
    value: 1n,
    data: '0x',
    gasLimit: 21000n,
    maxFeePerGas: 2n,
    maxPriorityFeePerGas: 1n,
    ...overrides,
  });
}
function fixture() {
  let value: unknown;
  let fail = false;
  let current = true;
  let writes = 0;
  const port: KeyringStoragePort = {
    async compareAndSet(_key, expected, next) {
      if (value === undefined || JSON.stringify(value) !== JSON.stringify(expected)) return false;
      writes++;
      if (fail) throw new Error('Write unavailable');
      value = structuredClone(next); return true;
    },
    async get() {
      return value === undefined ? undefined : structuredClone(value);
    },
    async set(_key, next) {
      writes++;
      if (fail) throw new Error('Write unavailable');
      value = structuredClone(next);
    },
    async deleteItem() {
      throw new Error('Journal must not delete unresolved transfers');
    },
    async createManyIfAbsent(entries) {
      if (value !== undefined) return false;
      writes++;
      if (fail) throw new Error('Write unavailable');
      value = structuredClone(Object.values(entries)[0]);
      return true;
    },
  };
  const guard = () => {
    if (!current) throw new Error('Locked');
  };
  // This unit fixture isolates journal transitions; real archive durability has
  // separate SQLite coverage in activityHistoryStorage.test.ts.
  const journal = new NativeTransferJournal(port, scope, guard, () => 1000, 0, undefined, async () => undefined);
  return {
    port,
    journal,
    guard,
    revoke() {
      current = false;
    },
    fail() {
      fail = true;
    },
    value: () => value,
    writes: () => writes,
    corrupt(next: unknown) {
      value = next;
    },
  };
}

test('type0 bytes retain their exact generic EVM gas limit across restart', async () => {
  const f = fixture();
  const signed = await wallet.signTransaction({ type: 0, chainId: 1, nonce: 0,
    to: '0x1111111111111111111111111111111111111111', value: 1n,
    gasLimit: 17000000n, gasPrice: 2n });
  const entry = await f.journal.saveSigned(signed);
  await f.journal.transition(entry.hash, 'attempted');
  const before = structuredClone(f.value());
  const reopened = new NativeTransferJournal(f.port, scope, f.guard, () => 2000);
  assert.equal((await reopened.load())?.rawTransaction, signed);
  assert.deepEqual(f.value(), before);
  const terminal = await reopened.transition(entry.hash, 'confirmed');
  assert.equal(terminal.rawTransaction, signed);
  assert.equal(terminal.phase, 'confirmed');
});

test('durably saves exact signed bytes and requires attempted before submitted', async () => {
  const f = fixture();
  const signed = await raw();
  const entry = await f.journal.saveSigned(signed);
  assert.equal(entry.rawTransaction, signed);
  assert.equal(entry.hash, keccak256(signed));
  assert.equal(entry.phase, 'signed');
  assert(Object.isFrozen(entry));
  assert(Object.isFrozen(entry.scope));
  await assert.rejects(f.journal.transition(entry.hash, 'submitted'), {
    code: 'INVALID_TRANSITION',
  });
  assert.equal(
    (await f.journal.transition(entry.hash, 'attempted')).phase,
    'attempted'
  );
  assert.equal(
    (await f.journal.transition(entry.hash, 'submitted')).phase,
    'submitted'
  );
  assert.equal((await f.journal.load())?.phase, 'submitted');
});

test('cold reopen preserves unresolved identity and refuses another send', async () => {
  const f = fixture();
  const entry = await f.journal.saveSigned(await raw());
  await f.journal.transition(entry.hash, 'attempted');
  const reopened = new NativeTransferJournal(f.port, scope, f.guard);
  assert.equal((await reopened.load())?.hash, entry.hash);
  await assert.rejects(reopened.saveSigned(await raw(1)), {
    code: 'PENDING_TRANSFER',
  });
  assert.equal((await reopened.load())?.rawTransaction, entry.rawTransaction);
});

test('two journal instances share one admission queue', async () => {
  const f = fixture();
  const another = new NativeTransferJournal(f.port, scope, f.guard);
  const settled = await Promise.allSettled([
    f.journal.saveSigned(await raw()),
    another.saveSigned(await raw(1)),
  ]);
  assert.equal(settled.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal(settled.filter((item) => item.status === 'rejected').length, 1);
  assert.equal((await f.journal.load())?.nonce, 0);
});

test('a terminal record can only be replaced by a later nonce', async () => {
  const f = fixture();
  const entry = await f.journal.saveSigned(await raw());
  await f.journal.transition(entry.hash, 'attempted');
  await f.journal.transition(entry.hash, 'confirmed');
  await assert.rejects(f.journal.saveSigned(await raw()), {
    code: 'INVALID_TRANSITION',
  });
  const next = await f.journal.saveSigned(await raw(1));
  assert.equal(next.nonce, 1);
  assert.equal(next.phase, 'signed');
});

test('ambiguous storage failure never advances the returned submission state', async () => {
  const f = fixture();
  const entry = await f.journal.saveSigned(await raw());
  f.fail();
  await assert.rejects(
    f.journal.transition(entry.hash, 'attempted'),
    /REOPEN_REQUIRED/
  );
  assert.equal(journalRequiresReopen(f.port), true);
  await assert.rejects(f.journal.load(), /REOPEN_REQUIRED/);
  assert.equal((await new NativeTransferJournal({ ...f.port }, scope, f.guard).load())?.phase, 'signed');
});

test('lock before queued storage work prevents journal mutation', async () => {
  const f = fixture();
  const signed = await raw();
  const pending = f.journal.saveSigned(signed);
  f.revoke();
  await assert.rejects(pending, /Locked/);
  assert.equal(f.writes(), 0);
});

test('rejects wrong account, chain, contract calls and unprotected legacy signatures', async () => {
  for (const overrides of [
    { chainId: 2 },
    { data: '0x1234' },
    {
      type: 0,
      chainId: 0,
      gasPrice: 1n,
      maxFeePerGas: undefined,
      maxPriorityFeePerGas: undefined,
    },
    { to: null },
  ]) {
    const f = fixture();
    const signed = await raw(0, overrides);
    assert.throws(() => f.journal.saveSigned(signed), { code: 'CORRUPT' });
    assert.equal(f.writes(), 0);
  }
  const f = fixture();
  const other = new Wallet('0x' + '2'.repeat(64));
  const signed = await other.signTransaction({
    to: wallet.address,
    chainId: 1,
    nonce: 0,
    gasPrice: 1,
    gasLimit: 21000,
    value: 1,
    type: 0,
  });
  assert.throws(() => f.journal.saveSigned(signed), { code: 'CORRUPT' });
});

test('rejects tampered persisted identity, fields and wallet binding', async () => {
  const f = fixture();
  await f.journal.saveSigned(await raw());
  const saved = structuredClone(f.value()) as any;
  for (const patch of [
    { hash: '0x' + '0'.repeat(64) }, { nonce: 5 }, { phase: 'unknown' }, { extra: true }, { rawTransaction: '0x12' },
  ]) {
    f.corrupt({ ...saved, entries: [{ ...saved.entries[0], ...patch }] });
    await assert.rejects(f.journal.load(), { code: 'CORRUPT' });
  }
  f.corrupt({ ...saved, walletFingerprint: '2'.repeat(64) });
  await assert.rejects(f.journal.load(), { code: 'CONTEXT_CHANGED' });
});

test('does not allow an old transaction hash to change a later signed entry', async () => {
  const f = fixture();
  const first = await f.journal.saveSigned(await raw());
  await f.journal.transition(first.hash, 'attempted');
  await f.journal.transition(first.hash, 'reverted');
  const next = await f.journal.saveSigned(await raw(1));
  await assert.rejects(f.journal.transition(first.hash, 'confirmed'), {
    code: 'INVALID_TRANSITION',
  });
  assert.equal((await f.journal.load())?.hash, next.hash);
});

test('a lost write acknowledgment stays unresolved after reopen and cannot permit a replacement', async () => {
  const f = fixture();
  const entry = await f.journal.saveSigned(await raw());
  const compare = f.port.compareAndSet;
  f.port.compareAndSet = async (...args) => {
    const result = await compare(...args);
    if (result) throw new Error('Acknowledgment lost');
    return result;
  };
  await assert.rejects(
    f.journal.transition(entry.hash, 'attempted'),
    /REOPEN_REQUIRED/
  );
  const reopened = new NativeTransferJournal({ ...f.port, compareAndSet: compare }, scope, f.guard);
  assert.equal((await reopened.load())?.phase, 'attempted');
  await assert.rejects(reopened.saveSigned(await raw(1)), {
    code: 'PENDING_TRANSFER',
  });
});

test('lock during an acknowledged journal write withholds authority to broadcast', async () => {
  const f = fixture();
  const entry = await f.journal.saveSigned(await raw());
  const compare = f.port.compareAndSet;
  f.port.compareAndSet = async (...args) => {
    const result = await compare(...args);
    f.revoke();
    return result;
  };
  await assert.rejects(f.journal.transition(entry.hash, 'attempted'), /Locked/);
  assert.equal(journalRequiresReopen(f.port), false);
  const reopened = new NativeTransferJournal(f.port, scope, () => undefined);
  assert.equal((await reopened.load())?.phase, 'attempted');
});

test('invalid scope getters are not invoked and missing journal data is not inferred from null', async () => {
  const f = fixture();
  let reads = 0;
  const hostile = {
    ...scope,
    get address() {
      reads++;
      return scope.address;
    },
  };
  assert.throws(() => new NativeTransferJournal(f.port, hostile, f.guard), {
    code: 'CORRUPT',
  });
  assert.equal(reads, 0);
  f.corrupt(null);
  await assert.rejects(f.journal.load(), { code: 'CORRUPT' });
});


test('an externally finalized nonce can retire a saved unsubmitted signature without deleting it', async () => {
  const f = fixture(); const first = await f.journal.saveSigned(await raw());
  const retired = await f.journal.transition(first.hash, 'nonce-consumed');
  assert.equal(retired.rawTransaction, first.rawTransaction);
  assert.equal((await f.journal.saveSigned(await raw(1))).nonce, 1);
});
