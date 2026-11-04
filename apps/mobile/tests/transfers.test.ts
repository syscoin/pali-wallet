import assert from 'node:assert/strict';
import test from 'node:test';
import { Wallet } from 'ethers/wallet';
import { keccak256 } from 'ethers/crypto';
import type { PreparedEvmTransaction } from '@sidhujag/sysweb3-keyring/cjs/software.js';
import type { CustodySnapshot } from '../src/custody/types.ts';
import { NativeTransfers } from '../src/custody/transfers.ts';
import { NativeTransferJournal } from '../src/custody/transferJournal.ts';
import { NativeTransferRpc } from '../src/custody/transferRpc.ts';
import type { KeyringStoragePort } from '../src/storage/types.ts';
const wallet = Wallet.fromPhrase(
  'test test test test test test test test test test test junk'
);
const to = '0x1111111111111111111111111111111111111111';
function fixture() {
  let state: CustodySnapshot = {
    phase: 'ready',
    revision: 1,
    presence: 'existing',
    backup: 'confirmed',
    account: { network: 'ethereum', address: wallet.address },
    error: null,
  };
  const listeners = new Set<(state: CustodySnapshot) => void>();
  const records: Record<string, unknown> = {};
  let availableBalance = '0x10000000000000000';
  let nonce = '0x0';
  let baseFee = '0x1';
  let dropped = false;
  let final = false;
  let receiptMissing = false;
  let signatures = 0;
  let altered = false;
  let signGate: Promise<void> | null = null;
  let failWrite = false;
  const broadcasts: string[] = [];
  const source = {
    getSnapshot: () => state,
    subscribe(listener: (state: CustodySnapshot) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    lock() {
      state = {
        ...state,
        phase: 'locked',
        revision: state.revision + 1,
        account: null,
      };
      for (const listener of listeners) listener(state);
    },
  };
  const store: KeyringStoragePort = {
    async get(key) {
      return records[key] === undefined
        ? undefined
        : structuredClone(records[key]);
    },
    async set(key, value) {
      if (failWrite) throw Error('Storage unavailable');
      records[key] = structuredClone(value);
    },
    async createManyIfAbsent(values) {
      if (failWrite) throw Error('Storage unavailable');
      if (Object.keys(values).some((key) => key in records)) return false;
      Object.assign(records, structuredClone(values));
      return true;
    },
    async deleteItem() {
      throw Error('Must not erase a pending transfer');
    },
  };
  const runtime = {
    async journal(guard: () => void) {
      guard();
      return new NativeTransferJournal(
        store,
        {
          walletFingerprint: '1'.repeat(64),
          address: wallet.address,
          chainId: '1',
        },
        guard
      );
    },
    async authorize(password: string, guard: () => void) {
      guard();
      if (password !== 'public-password') throw Error('Bad credential');
      guard();
    },
    async sign(
      transaction: PreparedEvmTransaction,
      password: string,
      guard: () => void
    ) {
      guard();
      if (password !== 'public-password') throw Error('Bad credential');
      signatures++;
      if (signGate) await signGate;
      guard();
      const raw = await wallet.signTransaction({
        ...transaction,
        nonce: Number(transaction.nonce),
        ...(altered ? { value: '999' } : {}),
      });
      guard();
      return { rawTransaction: raw, hash: keccak256(raw) };
    },
  };
  const rpc = new NativeTransferRpc({
    fetch: async (_url, init) => {
      const body = JSON.parse(String(init.body));
      let result: unknown;
      if (body.method === 'eth_chainId') result = '0x1';
      else if (body.method === 'eth_getBalance') result = availableBalance;
      else if (body.method === 'eth_getTransactionCount')
        result =
          body.params[1] === 'finalized' ? (final ? '0x1' : '0x0') : nonce;
      else if (body.method === 'eth_feeHistory')
        result = { oldestBlock: '0x1', baseFeePerGas: ['0x1', baseFee] };
      else if (body.method === 'eth_maxPriorityFeePerGas') result = '0x1';
      else if (body.method === 'eth_estimateGas') result = '0x5208';
      else if (body.method === 'eth_sendRawTransaction') {
        const record = Object.values(records)[0] as { phase: string };
        assert(['attempted', 'submitted'].includes(record.phase));
        broadcasts.push(body.params[0]);
        if (dropped) throw Error('Acknowledgment lost');
        result = keccak256(body.params[0]);
      } else if (body.method === 'eth_getTransactionReceipt')
        result =
          final && !receiptMissing
            ? {
                transactionHash: body.params[0],
                from: wallet.address,
                to,
                status: '0x1',
                blockNumber: '0x10',
                blockHash: '0x' + '2'.repeat(64),
              }
            : null;
      else throw Error('Unexpected method');
      return new Response(
        JSON.stringify({ jsonrpc: '2.0', id: body.id, result }),
        { headers: { 'content-type': 'application/json' } }
      );
    },
  });
  let clock = 100;
  let ids = 0;
  const transfers = new NativeTransfers(source, () => runtime, {
    rpc,
    now: () => clock,
    randomBytes: (length) => new Uint8Array(length).fill(++ids),
  });
  return {
    transfers,
    records,
    broadcasts,
    runtime,
    source,
    signatures: () => signatures,
    nextNonce() {
      nonce = '0x1';
    },
    insufficient() {
      availableBalance = '0x1';
    },
    lowerFeesWithReducedBalance() {
      baseFee = '0x0';
      availableBalance = '0x' + (1000000000000000n + 42000n).toString(16);
    },
    loseAcknowledgment() {
      dropped = true;
    },
    finalize() {
      final = true;
    },
    consumeElsewhere() {
      final = true;
      receiptMissing = true;
    },
    changeSignedFields() {
      altered = true;
    },
    expire() {
      clock += 100000;
    },
    holdSigning(promise: Promise<void>) {
      signGate = promise;
    },
    failStorage() {
      failWrite = true;
    },
    unlock() {
      state = {
        ...state,
        phase: 'ready',
        revision: state.revision + 1,
        account: { network: 'ethereum', address: wallet.address },
      };
      for (const listener of listeners) listener(state);
    },
    close() {
      transfers.dispose();
    },
  };
}
async function review(f: ReturnType<typeof fixture>) {
  await f.transfers.prepare(to, '0.001');
  const result = f.transfers.getSnapshot().review;
  assert(result);
  return result;
}

test('real signed bytes are journaled before one network submission and never exposed to UI', async () => {
  const f = fixture();
  try {
    const approved = await review(f);
    await f.transfers.confirm(approved.id, 'public-password');
    assert.equal(f.broadcasts.length, 1);
    assert.equal(f.signatures(), 1);
    assert.equal(f.transfers.getSnapshot().phase, 'pending');
    assert(
      !JSON.stringify(f.transfers.getSnapshot()).includes(f.broadcasts[0]!)
    );
    await assert.rejects(f.transfers.confirm(approved.id, 'public-password'), {
      code: 'EXPIRED',
    });
    assert.equal(f.broadcasts.length, 1);
  } finally {
    f.close();
  }
});
test('an expired review and a changed nonce cannot produce a signature or broadcast', async () => {
  for (const expire of [true, false]) {
    const f = fixture();
    try {
      const approved = await review(f);
      if (expire) f.expire();
      else f.nextNonce();
      await assert.rejects(
        f.transfers.confirm(approved.id, 'public-password'),
        { code: 'EXPIRED' }
      );
      assert.equal(f.signatures(), 0);
      assert.equal(f.broadcasts.length, 0);
    } finally {
      f.close();
    }
  }
});
test('wrong credentials lock the wallet and do not create a pending transaction', async () => {
  const f = fixture();
  try {
    const approved = await review(f);
    await assert.rejects(f.transfers.confirm(approved.id, 'wrong'));
    assert.equal(f.source.getSnapshot().phase, 'locked');
    assert.equal(Object.keys(f.records).length, 0);
    assert.equal(f.broadcasts.length, 0);
  } finally {
    f.close();
  }
});
test('lock while signing discards the late signature', async () => {
  const f = fixture();
  let release!: () => void;
  f.holdSigning(
    new Promise<void>((resolve) => {
      release = resolve;
    })
  );
  try {
    const approved = await review(f);
    const pending = f.transfers.confirm(approved.id, 'public-password');
    while (!f.signatures())
      await new Promise((resolve) => setImmediate(resolve));
    f.source.lock();
    release();
    await assert.rejects(pending, { code: 'CANCELLED' });
    assert.equal(f.broadcasts.length, 0);
    assert.equal(Object.keys(f.records).length, 0);
  } finally {
    f.close();
  }
});
test('duplicate confirmation cannot trigger a second signing request', async () => {
  const f = fixture();
  try {
    const approved = await review(f);
    const pending = f.transfers.confirm(approved.id, 'public-password');
    await assert.rejects(f.transfers.confirm(approved.id, 'public-password'), {
      code: 'BUSY',
    });
    await pending;
    assert.equal(f.signatures(), 1);
    assert.equal(f.broadcasts.length, 1);
  } finally {
    f.close();
  }
});
test('a valid signature for different fields is rejected before durable admission', async () => {
  const f = fixture();
  try {
    const approved = await review(f);
    f.changeSignedFields();
    await assert.rejects(f.transfers.confirm(approved.id, 'public-password'));
    assert.equal(Object.keys(f.records).length, 0);
    assert.equal(f.broadcasts.length, 0);
    assert.equal(f.source.getSnapshot().phase, 'locked');
  } finally {
    f.close();
  }
});
test('storage failure after signing never reaches the network', async () => {
  const f = fixture();
  try {
    const approved = await review(f);
    f.failStorage();
    await assert.rejects(f.transfers.confirm(approved.id, 'public-password'));
    assert.equal(f.signatures(), 1);
    assert.equal(f.broadcasts.length, 0);
    assert.equal(f.source.getSnapshot().phase, 'locked');
  } finally {
    f.close();
  }
});
test('lost acknowledgement retries the same bytes with fresh consent, without a new signature', async () => {
  const f = fixture();
  try {
    const approved = await review(f);
    f.loseAcknowledgment();
    await f.transfers.confirm(approved.id, 'public-password');
    assert.equal(f.transfers.getSnapshot().phase, 'unknown');
    await assert.rejects(f.transfers.prepare(to, '0.002'), {
      code: 'PENDING_TRANSFER',
    });
    await f.transfers.recover(true);
    const retry = f.transfers.getSnapshot().review;
    assert(retry?.retry);
    await f.transfers.confirm(retry.id, 'public-password');
    assert.equal(f.signatures(), 1);
    assert.equal(f.broadcasts.length, 2);
    assert.equal(f.broadcasts[0], f.broadcasts[1]);
  } finally {
    f.close();
  }
});
test('finalized receipt releases the journal and records the result', async () => {
  const f = fixture();
  try {
    const approved = await review(f);
    await f.transfers.confirm(approved.id, 'public-password');
    f.finalize();
    await f.transfers.recover();
    assert.equal(f.transfers.getSnapshot().phase, 'confirmed');
    assert.equal(
      (Object.values(f.records)[0] as { phase: string }).phase,
      'confirmed'
    );
  } finally {
    f.close();
  }
});
test('a reentrant observer can lock before submission without leaking signed bytes to the network', async () => {
  const f = fixture();
  try {
    const approved = await review(f);
    f.transfers.subscribe((state) => {
      if (state.phase === 'submitting') f.source.lock();
    });
    await assert.rejects(f.transfers.confirm(approved.id, 'public-password'), {
      code: 'CANCELLED',
    });
    assert.equal(f.broadcasts.length, 0);
    const entry = Object.values(f.records)[0] as { phase: string };
    assert.equal(entry.phase, 'attempted');
    assert.equal(f.transfers.getSnapshot().hash, null);
  } finally {
    f.close();
  }
});

test('effect replay recovers the pending journal after cancellation drains', async () => {
  const f = fixture();
  try {
    const approved = await review(f);
    f.loseAcknowledgment();
    await f.transfers.confirm(approved.id, 'public-password');
    const hash = f.transfers.getSnapshot().hash;
    const first = f.transfers.recover().catch((error) => error.code);
    f.transfers.cancel();
    const replay = f.transfers.recover();
    assert.equal(await first, 'CANCELLED');
    await replay;
    assert.equal(f.transfers.getSnapshot().phase, 'unknown');
    assert.equal(f.transfers.getSnapshot().hash, hash);
  } finally {
    f.close();
  }
});
test('cancelling a queued recovery prevents it from reviving an abandoned screen', async () => {
  const f = fixture();
  try {
    const first = f.transfers.recover().catch((error) => error.code);
    f.transfers.cancel();
    const queued = f.transfers.recover().catch((error) => error.code);
    f.transfers.cancel();
    assert.equal(await first, 'CANCELLED');
    assert.equal(await queued, 'CANCELLED');
    assert.equal(f.transfers.getSnapshot().phase, 'idle');
  } finally {
    f.close();
  }
});
test('disposal is terminal before a subscriber can reenter it', async () => {
  const f = fixture();
  let publications = 0;
  f.transfers.subscribe(() => {
    publications++;
    f.transfers.dispose();
  });
  f.transfers.dispose();
  f.transfers.dispose();
  assert.equal(publications, 1);
  assert.equal(f.transfers.getSnapshot().review, null);
  await assert.rejects(f.transfers.recover(), { code: 'CANCELLED' });
  await assert.rejects(f.transfers.prepare(to, '1'), { code: 'CANCELLED' });
});
test('a finalized nonce without the original receipt retires obsolete retries without claiming failure', async () => {
  const f = fixture();
  try {
    const approved = await review(f);
    f.loseAcknowledgment();
    await f.transfers.confirm(approved.id, 'public-password');
    f.consumeElsewhere();
    await f.transfers.recover(true);
    assert.equal(f.transfers.getSnapshot().phase, 'nonce-consumed');
    assert.equal(f.transfers.getSnapshot().review, null);
    assert.match(
      f.transfers.getSnapshot().message ?? '',
      /result is unavailable/
    );
    f.nextNonce();
    await f.transfers.prepare(to, '0.002');
    assert.equal(f.transfers.getSnapshot().review?.nonce, '1');
  } finally {
    f.close();
  }
});

test('insufficient funds is reported without inventing a pending transaction', async () => {
  const f = fixture();
  try {
    f.insufficient();
    await assert.rejects(f.transfers.prepare(to, '1'), {
      code: 'INSUFFICIENT_BALANCE',
    });
    assert.equal(f.transfers.getSnapshot().hash, null);
    assert.equal(f.transfers.getSnapshot().phase, 'idle');
    assert.match(f.transfers.getSnapshot().message ?? '', /Not enough ETH/);
    assert.equal(f.broadcasts.length, 0);
  } finally {
    f.close();
  }
});


test('expiry after a durable signed record preserves its recovery identity without broadcasting', async () => {
  const f = fixture(); const original = f.runtime.journal;
  f.runtime.journal = async (guard) => { const journal = await original(guard); const save = journal.saveSigned.bind(journal); journal.saveSigned = async (raw) => { const entry = await save(raw); f.expire(); return entry; }; return journal; };
  try { const approved = await review(f); await assert.rejects(f.transfers.confirm(approved.id, 'public-password'), { code: 'EXPIRED' }); assert.equal(f.broadcasts.length, 0); assert.equal(f.transfers.getSnapshot().phase, 'unknown'); assert(f.transfers.getSnapshot().hash); } finally { f.close(); }
});


test('rechecks the original approved maximum cost when fees and balance decrease', async () => {
  const f = fixture();
  try {
    const approved = await review(f);
    assert.equal(approved.totalUnits, '1000000000063000');
    f.lowerFeesWithReducedBalance();
    await assert.rejects(f.transfers.confirm(approved.id, 'public-password'), { code: 'INSUFFICIENT_BALANCE' });
    assert.equal(f.signatures(), 0);
    assert.equal(f.broadcasts.length, 0);
    assert.equal(Object.keys(f.records).length, 0);
    assert.equal(f.source.getSnapshot().phase, 'ready');
  } finally { f.close(); }
});

test('cancelling read-only preparation or recovery does not lock custody', async () => {
  for (const recover of [false, true]) {
    for (const dispose of [false, true]) {
      const f = fixture();
      const journal = f.runtime.journal;
      let entered!: () => void;
      let release!: () => void;
      const started = new Promise<void>((resolve) => { entered = resolve; });
      const gate = new Promise<void>((resolve) => { release = resolve; });
      f.runtime.journal = async (guard) => {
        entered();
        await gate;
        return journal(guard);
      };
      try {
        const pending = recover
          ? f.transfers.recover()
          : f.transfers.prepare(to, '0.001');
        const rejected = assert.rejects(pending, { code: 'CANCELLED' });
        await started;
        if (dispose) f.transfers.dispose();
        else f.transfers.cancel();
        assert.equal(f.source.getSnapshot().phase, 'ready');
        release();
        await rejected;
        assert.equal(f.source.getSnapshot().phase, 'ready');
        assert.equal(f.signatures(), 0);
        assert.equal(f.broadcasts.length, 0);
      } finally {
        release();
        f.close();
      }
    }
  }
});

test('a rejected secret operation revokes custody before a queued cancellation can hide its failure', async () => {
  const f = fixture();
  let cancellationPhase: string | undefined;
  f.runtime.sign = () => {
    const failure = Promise.reject(new Error('Signing failed after SDK cleanup'));
    void failure.catch(() => {
      // The first reaction queues cancellation after runSecretOperation resumes
      // but before the outer transfer catch can observe the signing failure.
      queueMicrotask(() => {
        f.transfers.cancel();
        cancellationPhase = f.source.getSnapshot().phase;
      });
    });
    return failure;
  };
  try {
    const approved = await review(f);
    await assert.rejects(f.transfers.confirm(approved.id, 'public-password'));
    assert.equal(cancellationPhase, 'locked');
    assert.equal(f.source.getSnapshot().phase, 'locked');
    assert.equal(Object.keys(f.records).length, 0);
    assert.equal(f.broadcasts.length, 0);
  } finally {
    f.close();
  }
});
