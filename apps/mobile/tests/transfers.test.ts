import assert from 'node:assert/strict';
import test from 'node:test';
import { Wallet } from 'ethers/wallet';
import { Transaction } from 'ethers/transaction';
import { keccak256 } from 'ethers/crypto';
import type { PreparedEvmTransaction } from '@sidhujag/sysweb3-keyring/cjs/software.js';
import type { EvmSignedBroadcast } from '@sidhujag/sysweb3-keyring/cjs/transactions/evm-submission.js';
import type { CustodySnapshot } from '../src/custody/types.ts';
import { NativeTransfers } from '../src/custody/transfers.ts';
import { EvmSignedReplay } from '../../../source/wallet/evmSignedReplay.ts';
import { EvmSignedRecords } from '../../../source/wallet/evmSignedRecords.ts';
import { createNativeSignedRecordView } from '../src/custody/sharedSignedRecords.ts';
import { signedRecordTestSession, historicalSignedBundle } from './signedRecordTestSession.ts';
import { getNativeNetwork } from '../src/custody/networkContext.ts';
import { NativeTransferRpc, NativeTransferRpcError } from '../src/custody/transferRpc.ts';
import type { Erc20TransferIntent } from '../src/custody/transferIntent.ts';
const wallet = Wallet.fromPhrase(
  'test test test test test test test test test test test junk'
);
const to = '0x1111111111111111111111111111111111111111';
const token = Object.freeze({
  contractAddress: '0x3333333333333333333333333333333333333333',
  name: 'Public fixture token',
  symbol: 'FIX',
  decimals: 2,
});
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
  let altered: 'value' | 'signer' | 'hash' | 'oversized' | 'noncanonical' | null = null;
  let signGate: Promise<void> | null = null;
  let beforeCommit: (() => Promise<void>) | undefined;
  let beforeBroadcastChainResponse: (() => Promise<void>) | undefined;
  let failWrite = false;
  const broadcasts: string[] = [];
  const rpcMethods: string[] = [];
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
  const signedRecords = new EvmSignedRecords({
    async read(profile) { return records[profile] as string | undefined; },
    async compareAndSet(profile, expected, value, check) {
      if (beforeCommit) await beforeCommit();
      check(); if (records[profile] !== expected) return false;
      if (failWrite) throw Error('Storage unavailable');
      records[profile] = value; return true;
    },
  });
  const runtime = {
    replay(guard: () => void, transport: Parameters<import('../src/custody/transfers.ts').NativeTransferRuntime['replay']>[1], options: Parameters<import('../src/custody/transfers.ts').NativeTransferRuntime['replay']>[2]) {
      return new EvmSignedReplay(signedRecords, () => ({recordSession:signedRecordTestSession(guard),assertCurrent:guard,
        context:{account:{id:0,type:'HDAccount',address:wallet.address},network:{kind:'ethereum',chainId:1,slip44:60,url:getNativeNetwork('ethereum').rpcUrl}},...transport}), options.now, options.randomBytes);
    },
    async submit(rawTransaction: string, _hash: string, guard: () => void, broadcast: EvmSignedBroadcast<string>, intent?: Erc20TransferIntent) {
      const journal = await runtime.journal(guard);
      try { await journal.saveSigned(rawTransaction,intent); guard(); }
      catch (error) { throw Object.assign(error as Error,{transactionNotBroadcast:true}); }
      await broadcast({ rawTransaction, admit: async (send, preflight) => { await preflight?.(); return send(); } });
    },
    async token(contractAddress: string, guard: () => void) {
      guard();
      assert.equal(contractAddress, token.contractAddress);
      return token;
    },
    async journal(guard: () => void) {
      guard();
      return { ...createNativeSignedRecordView(signedRecords, signedRecordTestSession(guard), '1'.repeat(64),
        { index: 0, type: 'HDAccount', address: wallet.address }, getNativeNetwork('ethereum')) };
    },
    assertUnlocked(guard: () => void) { guard(); assert.equal(state.phase, 'ready'); },
    async sign(
      transaction: PreparedEvmTransaction,
      guard: () => void
    ) {
      guard();
      signatures++;
      if (signGate) await signGate;
      guard();
      const signer = altered === 'signer'
        ? new Wallet(`0x${'22'.repeat(32)}`)
        : wallet;
      const raw = await signer.signTransaction({
        ...transaction,
        ...(altered === 'signer' ? { from: signer.address } : {}),
        nonce: Number(transaction.nonce),
        ...(altered === 'value' ? { value: '999' } : {}),
      });
      guard();
      const rawTransaction = altered === 'oversized'
        ? raw + '0'.repeat(4098 - raw.length)
        : altered === 'noncanonical'
        ? `0x${raw.slice(2).toUpperCase()}`
        : raw;
      return {
        rawTransaction,
        hash: altered === 'hash' ? `0x${'0'.repeat(64)}` : keccak256(rawTransaction),
      };
    },
  };
  const rpc = new NativeTransferRpc({ networkId: 'ethereum',
    fetch: async (_url, init) => {
      const body = JSON.parse(String(init.body));
      rpcMethods.push(body.method);
      let result: unknown;
      if (body.method === 'eth_chainId') {
        if (Object.keys(records).length > 0 && beforeBroadcastChainResponse)
          await beforeBroadcastChainResponse();
        result = '0x1';
      }
      else if (body.method === 'eth_getCode') result = '0x6000';
      else if (body.method === 'eth_call')
        result =
          '0x' +
          (body.params[0].data === '0x313ce567'
            ? 2n
            : body.params[0].data.startsWith('0x70a08231')
            ? 10000n
            : 1n)
            .toString(16)
            .padStart(64, '0');
      else if (body.method === 'eth_getBalance') result = availableBalance;
      else if (body.method === 'eth_getTransactionCount')
        result =
          body.params[1] !== 'pending' ? (final ? '0x1' : '0x0') : nonce;
      else if (body.method === 'eth_getBlockByNumber')
        result = { number: body.params[0] === 'latest' ? '0x20' : body.params[0], hash: '0x' + '2'.repeat(64), baseFeePerGas: baseFee, gasLimit: '0x1c9c380' };
      else if (body.method === 'eth_gasPrice') result = '0x2';
      else if (body.method === 'eth_feeHistory')
        result = { oldestBlock: '0x1', baseFeePerGas: ['0x1', baseFee] };
      else if (body.method === 'eth_maxPriorityFeePerGas') result = '0x1';
      else if (body.method === 'eth_estimateGas') result = '0x5208';
      else if (body.method === 'eth_sendRawTransaction') {
        const record = (JSON.parse(Object.values(records)[0] as string) as { entries: { phase: string }[] }).entries[0]!;
        assert(['signed', 'submitted'].includes(record.phase));
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
    signedRecords,
    records,
    broadcasts,
    rpcMethods,
    rpc,
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
    changeSignedFields(fault: NonNullable<typeof altered> = 'value') {
      altered = fault;
    },
    expire() {
      clock += 100000;
    },
    holdSigning(promise: Promise<void>) {
      signGate = promise;
    },
    holdWrite(wait: () => Promise<void>) {
      beforeCommit = wait;
    },
    holdBroadcastChainResponse(wait: () => Promise<void>) {
      beforeBroadcastChainResponse = wait;
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

for (const [kind, amount] of [
  ['zero', '0'],
  ['over-precision', '1.001'],
  ['malformed', '1e3'],
] as const) {
  test(`invalid ERC20 ${kind} amount leaves an editable controller and accepts correction`, async () => {
    const f = fixture();
    const before = f.source.getSnapshot();
    const phases: string[] = [];
    f.transfers.subscribe((snapshot) => phases.push(snapshot.phase));
    try {
      await assert.rejects(
        f.transfers.prepareToken(token.contractAddress, to, amount),
        { code: 'INVALID_INPUT' }
      );
      assert.equal(f.transfers.getSnapshot().phase, 'idle');
      assert.equal(f.transfers.getSnapshot().review, null);
      assert.equal(f.transfers.getSnapshot().hash, null);
      assert.deepEqual(phases, ['preparing', 'idle']);
      assert.equal(f.source.getSnapshot(), before);
      assert.deepEqual(f.records, {});
      assert.equal(f.rpcMethods.length, 0);
      assert.equal(f.signatures(), 0);
      assert.deepEqual(f.broadcasts, []);

      await f.transfers.prepareToken(token.contractAddress, to, '1.23');
      const corrected = f.transfers.getSnapshot();
      assert.equal(corrected.phase, 'review');
      assert.equal(corrected.review?.amountUnits, '123');
      assert.equal(corrected.review?.recipient, to);
      assert.equal(
        corrected.review?.intent?.token.contractAddress,
        token.contractAddress
      );
      assert.equal(f.source.getSnapshot(), before);
      assert(f.rpcMethods.includes('eth_estimateGas'));
      assert.equal(f.signatures(), 0);
      assert.deepEqual(f.records, {});
    } finally {
      f.close();
    }
  });
}

test('invalid ERC20 input makes no RPC or writes with a saved native transfer', async () => {
  const f = fixture();
  try {
    f.loseAcknowledgment();
    const approved = await review(f);
    await f.transfers.confirm(approved.id);
    const before = structuredClone(f.records);
    const calls = f.rpcMethods.length;
    await assert.rejects(
      f.transfers.prepareToken(token.contractAddress, to, '0'),
      { code: 'INVALID_INPUT' }
    );
    assert.equal(f.transfers.getSnapshot().phase, 'idle');
    assert.equal(f.transfers.getSnapshot().review, null);
    assert.deepEqual(f.records, before);
    assert.equal(f.rpcMethods.length, calls);
    assert.equal(f.signatures(), 1);
    assert.equal(f.broadcasts.length, 1);
  } finally {
    f.close();
  }
});

test('ordinary coin and token sends retain an explicit unused nonce when the pending nonce changes', async () => {
  for (const asset of ['coin', 'token'] as const) {
    const f = fixture();
    try {
      await (asset === 'coin'
        ? f.transfers.view.prepare(to, '0.001', '3')
        : f.transfers.view.prepareToken(token.contractAddress, to, '1.23', '3'));
      const approved = f.transfers.getSnapshot().review!;
      assert.equal(approved.nonce, '3');
      assert.equal(approved.nonceOverride, 3);
      assert.equal(f.signatures(), 0);
      f.nextNonce();
      await f.transfers.confirm(approved.id);
      assert.equal(f.broadcasts.length, 1);
      assert.equal(Transaction.from(f.broadcasts[0]!).nonce, 3);
      assert.equal((await (await f.runtime.journal(() => undefined)).load())?.nonce, 3);
      await assert.rejects(f.transfers.view.prepare(to, '0.001', '3'), { code: 'NONCE_RETAINED' });
      assert.equal(f.transfers.getSnapshot().phase, 'idle');
      await f.transfers.view.prepare(to, '0.001', '4');
      assert.equal(f.transfers.getSnapshot().review?.nonce, '4');
      assert.equal(f.broadcasts.length, 1);
    } finally { f.close(); }
  }
});

test('manual nonce rejects malformed inputs and accepts zero only while it is available', async () => {
  const f = fixture();
  try {
    for (const input of ['-1', '1.5', '0x0', '1e2', '9007199254740992']) {
      await assert.rejects(f.transfers.view.prepare(to, '0.001', input), { code: 'INVALID_NONCE' });
    }
    assert.equal(f.rpcMethods.length, 0);
    await f.transfers.view.prepare(to, '0.001', '0');
    const approved = f.transfers.getSnapshot().review!;
    assert.equal(approved.nonceOverride, 0);
    f.nextNonce();
    await assert.rejects(f.transfers.confirm(approved.id), { code: 'NONCE_UNAVAILABLE' });
    assert.equal(f.signatures(), 0);
    await assert.rejects(f.transfers.view.prepare(to, '0.001', '0'), { code: 'NONCE_UNAVAILABLE' });
    assert.equal(f.transfers.getSnapshot().phase, 'idle');
    assert.deepEqual(f.records, {});
  } finally { f.close(); }
});

test('a manual nonce claimed during durable append retains its exact signed bytes without posting', async () => {
  const f = fixture();
  try {
    await f.transfers.view.prepare(to, '0.001', '0');
    const approved = f.transfers.getSnapshot().review!;
    f.holdWrite(async () => f.nextNonce());
    await assert.rejects(f.transfers.confirm(approved.id), { code: 'NONCE_UNAVAILABLE' });
    assert.equal(f.signatures(), 1);
    assert.equal(f.broadcasts.length, 0);
    const saved = await (await f.runtime.journal(() => undefined)).load();
    assert.equal(saved?.nonce, 0);
    assert.equal(saved?.hash, f.transfers.getSnapshot().hash);
  } finally { f.close(); }
});

test('a pending nonce change during durable append preserves the approved bytes without posting', async () => {
  const f = fixture();
  try {
    const approved = await review(f);
    f.holdWrite(async () => f.nextNonce());
    await assert.rejects(f.transfers.confirm(approved.id), { code: 'EXPIRED' });
    assert.equal(f.signatures(), 1);
    assert.equal(f.broadcasts.length, 0);
    const saved = await (await f.runtime.journal(() => undefined)).load();
    assert.equal(saved?.nonce, 0);
    assert.equal(saved?.hash, f.transfers.getSnapshot().hash);
    assert.equal(f.transfers.getSnapshot().phase, 'unknown');
  } finally { f.close(); }
});

test('real signed bytes are journaled before one network submission and never exposed to UI', async () => {
  const f = fixture();
  try {
    const approved = await review(f);
    await f.transfers.confirm(approved.id);
    assert.equal(f.broadcasts.length, 1);
    assert.equal(f.signatures(), 1);
    assert.equal(f.transfers.getSnapshot().phase, 'pending');
    assert(
      !JSON.stringify(f.transfers.getSnapshot()).includes(f.broadcasts[0]!)
    );
    await assert.rejects(f.transfers.confirm(approved.id), {
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
        f.transfers.confirm(approved.id),
        { code: 'EXPIRED' }
      );
      assert.equal(f.signatures(), 0);
      assert.equal(f.broadcasts.length, 0);
    } finally {
      f.close();
    }
  }
});
test('locking after review prevents a signature or pending transaction', async () => {
  const f = fixture();
  try {
    const approved = await review(f);
    f.source.lock();
    await assert.rejects(f.transfers.confirm(approved.id), { code: 'EXPIRED' });
    assert.equal(f.signatures(), 0);
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
    const pending = f.transfers.confirm(approved.id);
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
    const pending = f.transfers.confirm(approved.id);
    await assert.rejects(f.transfers.confirm(approved.id), {
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
    await assert.rejects(f.transfers.confirm(approved.id));
    assert.equal(Object.keys(f.records).length, 0);
    assert.equal(f.broadcasts.length, 0);
    assert.equal(f.source.getSnapshot().phase, 'locked');
  } finally {
    f.close();
  }
});
for (const fault of ['signer', 'hash', 'oversized', 'noncanonical'] as const) {
  test(`a ${fault} signing result is rejected before durable admission`, async () => {
    const f = fixture();
    try {
      const approved = await review(f);
      f.changeSignedFields(fault);
      await assert.rejects(f.transfers.confirm(approved.id), { code: 'FAILED' });
      assert.equal(f.signatures(), 1);
      assert.equal(Object.keys(f.records).length, 0);
      assert.equal(f.broadcasts.length, 0);
      assert.equal(f.source.getSnapshot().phase, 'locked');
    } finally {
      f.close();
    }
  });
}
test('storage failure after signing never reaches the network', async () => {
  const f = fixture();
  try {
    const approved = await review(f);
    f.failStorage();
    await assert.rejects(f.transfers.confirm(approved.id));
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
    await f.transfers.confirm(approved.id);
    assert.equal(f.transfers.getSnapshot().phase, 'unknown');
    await assert.rejects(f.transfers.prepare(to, '0.002'), {
      code: 'PENDING_TRANSFER',
    });
    await f.transfers.recover(true);
    const retry = f.transfers.getSnapshot().review;
    assert(retry?.retry);
    await f.transfers.confirm(retry.id);
    assert.equal(f.signatures(), 1);
    assert.equal(f.broadcasts.length, 2);
    assert.equal(f.broadcasts[0], f.broadcasts[1]);
  } finally {
    f.close();
  }
});
test('a reentrant lock cannot bring back a cancelled saved-transaction review', async () => {
  const f = fixture();
  try {
    const approved = await review(f);
    f.loseAcknowledgment();
    await f.transfers.confirm(approved.id);
    const hash = f.transfers.getSnapshot().hash;
    assert(hash);
    f.transfers.cancel();
    f.transfers.subscribe((state) => {
      if (state.hash === hash) f.source.lock();
    });

    await assert.rejects(f.transfers.recover(true, hash), { code: 'CANCELLED' });
    assert.equal(f.transfers.getSnapshot().phase, 'idle');
    assert.equal(f.transfers.getSnapshot().hash, null);
    assert.equal(f.transfers.getSnapshot().review, null);
    assert.equal(f.signatures(), 1);
    assert.equal(f.broadcasts.length, 1);
  } finally {
    f.close();
  }
});
test('finalized receipt releases the journal and records the result', async () => {
  const f = fixture();
  try {
    const approved = await review(f);
    await f.transfers.confirm(approved.id);
    f.finalize();
    await f.transfers.recover();
    assert.equal(f.transfers.getSnapshot().phase, 'confirmed');
    assert.equal(
      (JSON.parse(Object.values(f.records)[0] as string) as { entries: { phase: string }[] }).entries[0]!.phase,
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
    await assert.rejects(f.transfers.confirm(approved.id), {
      code: 'CANCELLED',
    });
    assert.equal(f.broadcasts.length, 0);
    assert.deepEqual(f.records, {});
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
    await f.transfers.confirm(approved.id);
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
    await f.transfers.confirm(approved.id);
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

test('acknowledged transfer keeps its hash while the submitted marker is held and then fails', async () => {
  const f = fixture();
  const { promise: started, resolve: enter } = Promise.withResolvers<void>();
  const { promise: held, resolve: release } = Promise.withResolvers<void>();
  const open = f.runtime.journal;
  f.runtime.journal = async (guard) => {
    const journal = await open(guard);
    const transition = journal.transition.bind(journal);
    journal.transition = async (hash, phase) => {
      if (phase === 'submitted') {
        enter();
        await held;
        throw Error('Submitted marker write failed');
      }
      return transition(hash, phase);
    };
    return journal;
  };
  try {
    const approved = await review(f);
    const pending = f.transfers.confirm(approved.id);
    const completion = pending.catch((error: unknown) => error);
    await Promise.race([started, pending]);
    const whileMarking = f.transfers.getSnapshot();
    release();
    const error = await completion;
    assert.equal(f.broadcasts.length, 1);
    const hash = keccak256(f.broadcasts[0]!);
    assert.equal(whileMarking.hash, hash);
    assert.equal(error, undefined);
    assert.equal(f.source.getSnapshot().phase, 'ready');
    const state = f.transfers.getSnapshot();
    assert.equal(state.phase, 'pending');
    assert.equal(state.hash, hash);
    assert.match(state.message ?? '', /submitted.*activity may take longer/i);
    const saved = await (await f.runtime.journal(() => undefined)).load();
    assert.equal(saved!.rawTransaction, f.broadcasts[0]);
    assert.equal(saved!.phase, 'signed');
  } finally {
    release();
    f.close();
  }
});

test('a definite no-POST from the dispatch callback retains only the already saved identity', async () => {
  const f = fixture();
  f.rpc.broadcast = async () => {
    throw Object.assign(new NativeTransferRpcError('REVIEW_REQUIRED'), { transactionNotBroadcast: true });
  };
  try {
    const approved = await review(f);
    await assert.rejects(f.transfers.confirm(approved.id), { code: 'EXPIRED' });
    const saved = await (await f.runtime.journal(() => undefined)).load();
    assert(saved);
    assert.equal(f.broadcasts.length, 0);
    const outcome = f.transfers.getSnapshot();
    assert.equal(outcome.phase, 'unknown');
    assert.equal(outcome.hash, saved.hash);
    assert.match(outcome.message ?? '', /saved/i);
    assert.doesNotMatch(outcome.message ?? '', /submission may have completed/i);
  } finally { f.close(); }
});

test('unexpected recovery journal failure does not claim an existing submitted transaction was never sent', async () => {
  const f = fixture();
  try {
    const approved = await review(f);
    await f.transfers.confirm(approved.id);
    const before = structuredClone(f.records);
    f.finalize();
    const updateObservedPhase = f.signedRecords.updateObservedPhase.bind(f.signedRecords);
    f.signedRecords.updateObservedPhase = async (session, entry, revision, phase) => {
      if (phase === 'confirmed') throw Error('Unexpected storage failure during recovery');
      return updateObservedPhase(session, entry, revision, phase);
    };
    await assert.rejects(f.transfers.recover(), { code: 'FAILED' });
    assert.equal(f.source.getSnapshot().phase, 'locked');
    assert.equal(f.transfers.getSnapshot().hash, null);
    assert.match(f.transfers.getSnapshot().message ?? '', /check Activity for an existing transaction/);
    assert.doesNotMatch(f.transfers.getSnapshot().message ?? '', /not sent|no new transaction|pending transaction.*preserved/i);
    assert.deepEqual(f.records, before);
    assert.equal(f.broadcasts.length, 1);
  } finally { f.close(); }
});


test('expiry after a durable signed record preserves its recovery identity without broadcasting', async () => {
  const f = fixture(); const original = f.runtime.journal;
  f.runtime.journal = async (guard) => { const journal = await original(guard); const save = journal.saveSigned.bind(journal); journal.saveSigned = async (raw) => { const entry = await save(raw); f.expire(); return entry; }; return journal; };
  try { const approved = await review(f); await assert.rejects(f.transfers.confirm(approved.id), { code: 'EXPIRED' }); assert.equal(f.broadcasts.length, 0); assert.equal(f.transfers.getSnapshot().phase, 'unknown'); assert(f.transfers.getSnapshot().hash); } finally { f.close(); }
});

test('a final chain probe that outlives the review retains the exact signed record without a raw POST', async () => {
  const f = fixture();
  const { promise: entered, resolve: enter } = Promise.withResolvers<void>();
  const { promise: held, resolve: release } = Promise.withResolvers<void>();
  f.holdBroadcastChainResponse(async () => {
    enter();
    await held;
  });
  try {
    const approved = await review(f);
    const pending = f.transfers.confirm(approved.id);
    const expired = assert.rejects(pending, { code: 'EXPIRED' });
    await Promise.race([entered, pending]);
    const journal = await f.runtime.journal(() => undefined);
    const saved = await journal.load();
    assert(saved);
    assert.equal(saved.phase, 'signed');
    assert.equal(saved.hash, keccak256(saved.rawTransaction));
    assert.equal(f.rpcMethods.at(-1), 'eth_chainId');
    assert.deepEqual(f.broadcasts, []);

    f.expire();
    release();
    await expired;
    assert.deepEqual(f.broadcasts, []);
    assert.deepEqual(await journal.load(), saved);
    assert.equal(f.signatures(), 1);
    const outcome = f.transfers.getSnapshot();
    assert.equal(outcome.phase, 'unknown');
    assert.equal(outcome.hash, saved.hash);
    assert.equal(outcome.message, 'Your signed transaction is saved. Check it before sending again.');
  } finally {
    release();
    f.close();
  }
});

test('expiry before the signed record commits exposes no saved hash or retry', async () => {
  const f = fixture();
  const { promise: started, resolve: enter } = Promise.withResolvers<void>();
  const { promise: held, resolve: release } = Promise.withResolvers<void>();
  f.holdWrite(async () => { enter(); await held; });
  try {
    const approved = await review(f);
    const pending = f.transfers.confirm(approved.id);
    const expired = assert.rejects(pending, { code: 'EXPIRED' });
    await Promise.race([started, pending]);
    const whilePersisting = f.transfers.getSnapshot();
    f.expire();
    release();
    await expired;
    assert.equal(f.signatures(), 1);
    assert.equal(f.broadcasts.length, 0);
    assert.equal(Object.keys(f.records).length, 0);
    const outcome = f.transfers.getSnapshot();
    assert.equal(outcome.phase, 'idle');
    assert.equal(outcome.hash, null);
    assert.doesNotMatch(outcome.message ?? '', /saved|retry/i);
    assert.equal(whilePersisting.hash, null);
  } finally {
    release();
    f.close();
  }
});


test('rechecks the original approved maximum cost when fees and balance decrease', async () => {
  const f = fixture();
  try {
    const approved = await review(f);
    assert.equal(approved.totalUnits, '1000000000075600');
    f.lowerFeesWithReducedBalance();
    await assert.rejects(f.transfers.confirm(approved.id), { code: 'INSUFFICIENT_BALANCE' });
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
    await assert.rejects(f.transfers.confirm(approved.id));
    assert.equal(cancellationPhase, 'locked');
    assert.equal(f.source.getSnapshot().phase, 'locked');
    assert.equal(Object.keys(f.records).length, 0);
    assert.equal(f.broadcasts.length, 0);
  } finally {
    f.close();
  }
});


for (const type of [0, 2] as const) test(`current-format type ${type} terminal bytes above today's gas cap still reconcile`, async () => {
  const f = fixture();
  try {
    const signed = await wallet.signTransaction({ type, chainId: 1, nonce: 0, to, value: 1n, gasLimit: 17000000n,
      ...(type === 0 ? { gasPrice: 2n } : { maxFeePerGas: 2n, maxPriorityFeePerGas: 1n }) });
    const session = signedRecordTestSession();
    f.records[await session.keyring.getPrivateRecordProfileId()] = await historicalSignedBundle(session, signed);
    const before = JSON.stringify(f.records);
    f.finalize(); await f.transfers.recover();
    assert.equal(f.transfers.getSnapshot().phase, 'confirmed');
    assert.equal(f.transfers.getSnapshot().hash, keccak256(signed));
    assert.equal(JSON.stringify(f.records), before);
    assert.equal(f.signatures(), 0); assert.equal(f.broadcasts.length, 0);
    assert(!JSON.stringify(f.transfers.getSnapshot()).includes(signed));
  } finally { f.close(); }
});

test('predecessor choices page locally without changing consent or making more RPC reads',async()=>{
 const f=fixture();
 try {
  const raws = await Promise.all(Array.from({ length: 23 }, (_, index) =>
    wallet.signTransaction({ type: 2, chainId: 1, nonce: index === 22 ? 1 : 0, to, value: index + 1,
      gasLimit: 21000, maxFeePerGas: 2, maxPriorityFeePerGas: 1 })));
  const session = signedRecordTestSession();
  f.records[await session.keyring.getPrivateRecordProfileId()] = await historicalSignedBundle(session, raws, 'signed');
  await f.transfers.recover(true);
  const before=f.transfers.getSnapshot().review!;
  assert.equal(before.replay!.predecessorCount,22);assert.equal(before.replay!.predecessors.length,20);
  const requests=f.rpcMethods.length;
  await f.transfers.loadMorePredecessors();
  const after=f.transfers.getSnapshot().review!;
  assert.equal(after.id,before.id);assert.equal(after.replay!.predecessors.length,22);
  assert.equal(new Set(after.replay!.predecessors.map(row=>row.hash)).size,22);
  assert.equal(f.rpcMethods.length,requests);assert.equal(f.broadcasts.length,0);assert.equal(f.signatures(),0);
 } finally {f.close();}
});
