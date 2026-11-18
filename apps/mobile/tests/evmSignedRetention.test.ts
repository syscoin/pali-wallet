import { paliSmartAccountInterface, getPaliModuleAddress, paliEntryPointInterface, getPaliEntryPointAddress } from '../../../source/utils/smartAccount/contracts.ts';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import test from 'node:test';
import { getAddress, Interface, parseEther, Transaction, Wallet } from 'ethers';
import {
  captureEvmSubmission,
  evmSubmissionFailure,
  submitSignedEvmTransaction,
} from '@sidhujag/sysweb3-keyring/cjs/transactions/evm-submission.js';
import {
  EVM_SIGNED_RECORD_LIMITS,
  EvmSignedRecords,
  createEvmSignedRecordLifecycle,
  consumeSignedEvmCapacityRefusal,
  type EvmSignedRecordStorage,
} from '../../../source/wallet/evmSignedRecords.ts';
import { ERC7579_MODE_SINGLE_DEFAULT, encodeERC7579Executions } from '../../../source/utils/smartAccount/account.ts';
import { getPrivacyPool } from '../../../source/utils/privacy/registry.ts';
import { signedRecordTestSession } from './signedRecordTestSession.ts';

Object.defineProperty(globalThis, 'crypto', {
  value: webcrypto,
  configurable: true,
});
const signer = new Wallet(`0x${'31'.repeat(32)}`);
const otherSigner = new Wallet(`0x${'32'.repeat(32)}`);
const chainId = '7654321';
const domain = 'org.syscoin.pali.evm.signed.root.v1';
const scope = { chainId, from: signer.address };

function fixture() {
  let value: string | undefined,
    revision = 0,
    writes = 0;
  const port: EvmSignedRecordStorage = {
    async read() {
      return value;
    },
    async compareAndSet(_id, expected, next, check) {
      check();
      if (value !== expected) return false;
      value = next;
      writes++;
      return true;
    },
  };
  const session = () => {
    const captured = revision;
    return signedRecordTestSession(() => {
      if (captured !== revision) throw new Error('revoked');
    });
  };
  return {
    records: new EvmSignedRecords(port),
    port,
    session,
    value: () => value,
    replace(next: string | undefined) {
      value = next;
    },
    writes: () => writes,
    revoke() {
      revision++;
    },
  };
}
async function signed(
  nonce: number,
  wallet = signer,
  network = chainId,
  call?: { to: string; data: string; value: bigint }
) {
  const rawTransaction = await wallet.signTransaction({
    type: 2,
    chainId: network,
    nonce,
    to: wallet.address,
    value: 1,
    gasLimit: 21_000,
    maxFeePerGas: 3,
    maxPriorityFeePerGas: 1,
    ...call,
  });
  return {
    rawTransaction,
    hash: Transaction.from(rawTransaction).hash!,
    from: wallet.address,
    chainId: network,
    nonce,
    type: 2,
    context: {
      account: { type: 'HDAccount', id: 0, address: wallet.address },
      network: {
        kind: 'ethereum',
        chainId: Number(network),
        slip44: 60,
        url: 'https://offline.invalid',
      },
      operation: 'send' as const,
    },
  };
}
test('an earlier handoff protects the same fresh entry if the initial preflight subsequently refuses', async () => {
  const f = fixture();
  const session = f.session();
  const record = await signed(0);
  const lifecycle = createEvmSignedRecordLifecycle(f.records, session, {
    walletSendCleanupSession: session,
    retirementReadForChain: null,
  });
  await lifecycle.persistSigned(record);
  const handoff = await f.records.withReplayAdmission(session,
    { ...record, operation: 'send', metadata: undefined },
    async () => ({ result: true }));
  assert.equal(handoff?.result, true);
  await assert.rejects(lifecycle.dispatchSigned(record,
    async () => assert.fail('the refused attempt cannot dispatch'),
    async () => { throw new Error('review expired'); }), /review expired/);
  assert.equal((await f.records.readExact(session, chainId, signer.address, record.hash))?.hash, record.hash);
});

test('an uncertain cleanup write quarantines storage and never enters the broadcast callback', async () => {
  const f = fixture(), session = f.session(), record = await signed(0);
  const lifecycle = createEvmSignedRecordLifecycle(f.records, session, {
    walletSendCleanupSession: session,
    retirementReadForChain: null,
  });
  await lifecycle.persistSigned(record);
  const commit = f.port.compareAndSet.bind(f.port);
  f.port.compareAndSet = async (...args) => {
    await commit(...args);
    throw Object.assign(new Error('cleanup acknowledgement lost'), { code: 'STORAGE_REOPEN_REQUIRED' });
  };
  await assert.rejects(lifecycle.dispatchSigned(record,
    async () => assert.fail('the refused attempt cannot dispatch'),
    async () => { throw new Error('review expired'); }), { code: 'STORAGE_REOPEN_REQUIRED' });
  assert.equal(f.records.requiresReopen, true);
});

async function rootPayload(f: ReturnType<typeof fixture>) {
  const bundle = JSON.parse(f.value()!);
  const bytes = await f.session().keyring.decryptPrivateRecord({
    domain,
    recordId: 'manifest',
    envelope: bundle.root,
  });
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } finally {
    bytes.fill(0);
  }
}
async function replaceRoot(
  f: ReturnType<typeof fixture>,
  payload: Record<string, unknown>
) {
  const bundle = JSON.parse(f.value()!);
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  try {
    bundle.root = await f.session().keyring.encryptPrivateRecord({
      domain,
      recordId: 'manifest',
      plaintext: bytes,
    });
  } finally {
    bytes.fill(0);
  }
  f.replace(JSON.stringify(bundle));
}

async function fillToCapacity(
  f: ReturnType<typeof fixture>,
  wallet = signer,
  network = chainId
) {
  const first = await signed(0, wallet, network),
    second = await signed(1, wallet, network);
  const maximum = Object.fromEntries(
    Array.from({ length: 1023 }, (_, i) => [
      `k${String(i).padStart(4, '0')}`,
      'x'.repeat(8192),
    ])
  );
  await f.records.append(f.session(), first, maximum);
  const probe = fixture();
  probe.replace(f.value());
  await probe.records.append(probe.session(), second, {});
  let remaining =
    2 + EVM_SIGNED_RECORD_LIMITS.bytes - Buffer.byteLength(probe.value()!) - 64;
  const metadata = Object.fromEntries(
    Object.keys(maximum).map((key) => [key, ''])
  );
  remaining -= Buffer.byteLength(JSON.stringify(metadata));
  for (const key of Object.keys(metadata)) {
    const size = Math.min(remaining, 8192);
    metadata[key] = 'x'.repeat(size);
    remaining -= size;
  }
  assert.equal(remaining, 0);
  await f.records.append(f.session(), second, metadata);
}

async function clear(f: ReturnType<typeof fixture>, store = f.records) {
  const session = f.session();
  return store.clearScope(session, {
    profileId: await session.keyring.getPrivateRecordProfileId(),
    ...scope,
  });
}
test('clear removes selected sender/chain records and floors but preserves other scopes', async () => {
  const f = fixture(),
    entries = [
      await signed(5),
      await signed(0, otherSigner),
      await signed(0, signer, '57'),
    ];
  for (const entry of entries) await f.records.append(f.session(), entry);
  const payload = await rootPayload(f);
  payload.nonceFloors = [
    { chainId, from: signer.address.toLowerCase(), nonce: 5 },
  ];
  await replaceRoot(f, payload);
  assert.equal(await clear(f), 1);
  const reopened = new EvmSignedRecords(f.port);
  assert.equal(await reopened.validate(f.session()), 2);
  assert.equal(
    (
      await reopened.captureAutoNonceSnapshot(
        f.session(),
        chainId,
        signer.address
      )
    ).minimumNonce,
    0
  );
  for (const entry of entries.slice(1))
    assert.equal(
      (
        await reopened.readExact(
          f.session(),
          entry.chainId,
          entry.from,
          entry.hash
        )
      )?.rawTransaction,
      entry.rawTransaction
    );
  assert.deepEqual((await rootPayload(f)).nonceFloors, []);
  await reopened.append(f.session(), await signed(0));
});
test('clear revokes an external replacement binding whose original was untracked', async () => {
  const f = fixture(),
    original = await signed(0),
    binding = await f.records.captureVerifiedReplacement(f.session(), {
      ...scope,
      nonce: 0,
      originalHash: original.hash,
      operation: 'speed-up',
    });
  assert.equal(binding.expectedTipHash, null);
  await clear(f);
  const replacement = {
    ...original,
    context: {
      ...original.context,
      operation: 'speed-up' as const,
      originalHash: original.hash,
    },
  };
  await assert.rejects(
    f.records.append(f.session(), replacement, undefined, binding),
    /ORIGINAL_CHANGED/
  );
  assert.equal(await f.records.validate(f.session()), 0);
});
test('clear invalidates snapshots and a delayed signing lifecycle', async () => {
  const f = fixture(),
    first = await signed(0),
    next = await signed(1);
  await f.records.append(f.session(), first);
  const old = f.session(),
    snapshot = await f.records.captureAutoNonceSnapshot(
      old,
      chainId,
      signer.address
    ),
    lifecycle = createEvmSignedRecordLifecycle(f.records, old, {
      retirementReadForChain: null,
    });
  await clear(f);
  await assert.rejects(snapshot.readMaximumCost(first.hash), /CONTEXT_CHANGED/);
  await assert.rejects(lifecycle.persistSigned(next), /CONTEXT_CHANGED/);
  await assert.rejects(
    f.records.readExact(old, chainId, signer.address, first.hash),
    /CONTEXT_CHANGED/
  );
  assert.equal(await f.records.validate(f.session()), 0);
});
test('clear blocks held dispatch before broadcast', async () => {
  const f = fixture(),
    first = await signed(0);
  await f.records.append(f.session(), first);
  let release!: () => void, entered!: () => void;
  const waiting = new Promise<void>((r) => {
      release = r;
    }),
    started = new Promise<void>((r) => {
      entered = r;
    });
  let posts = 0;
  const admission = f.records.withReplayAdmission(
    f.session(),
    { ...first, operation: 'send', metadata: undefined },
    async () => {
      posts++;
      return { result: undefined };
    },
    undefined,
    {
      assertCurrent() {},
      async run() {
        entered();
        await waiting;
      },
    }
  );
  await started;
  const resetSession = f.session();
  const profileId = await resetSession.keyring.getPrivateRecordProfileId();
  const resetting = f.records.clearScope(resetSession, { ...scope, profileId });
  release();
  await assert.rejects(admission, /CONTEXT_CHANGED/);
  await resetting;
  assert.equal(posts, 0);
});
test('persisted reset generation prevents another instance restoring stale signed bytes', async () => {
  const f = fixture(),
    first = await signed(0),
    next = await signed(1);
  await f.records.append(f.session(), first);
  const other = new EvmSignedRecords({ ...f.port });
  let release!: () => void, entered!: () => void;
  const waiting = new Promise<void>((r) => {
      release = r;
    }),
    started = new Promise<void>((r) => {
      entered = r;
    });
  const session = f.session(),
    encrypt = session.keyring.encryptPrivateRecord.bind(session.keyring);
  let paused = false;
  session.keyring.encryptPrivateRecord = async (input) => {
    if (!paused) {
      paused = true;
      entered();
      await waiting;
    }
    return encrypt(input);
  };
  const appending = f.records.append(session, next);
  await started;
  await clear(f, other);
  release();
  await assert.rejects(appending, /CONTEXT_CHANGED/);
  assert.equal(await f.records.validate(f.session()), 0);
});
test('clear refuses a mismatched profile and revoked commit without erasing records', async () => {
  const f = fixture();
  await f.records.append(f.session(), await signed(0));
  const before = f.value();
  await assert.rejects(
    f.records.clearScope(f.session(), {
      ...scope,
      profileId: '0x' + '12'.repeat(32),
    }),
    /CONTEXT_CHANGED/
  );
  assert.equal(f.value(), before);
  const original = f.port.compareAndSet;
  f.port.compareAndSet = async (...args) => {
    f.revoke();
    return original(...args);
  };
  await assert.rejects(clear(f), /revoked/);
  assert.equal(f.value(), before);
});
test('existing authenticated manifests remain readable and invalid floors fail closed', async () => {
  const f = fixture();
  await f.records.append(f.session(), await signed(0));
  const payload = await rootPayload(f);
  delete payload.nonceFloors;
  delete payload.resetGeneration;
  await replaceRoot(f, payload);
  const before = f.value();
  assert.equal(await f.records.validate(f.session()), 1);
  assert.equal(f.value(), before);
  payload.nonceFloors = [
    { chainId, from: signer.address.toLowerCase(), nonce: 1 },
  ];
  await replaceRoot(f, payload);
  await assert.rejects(f.records.validate(f.session()), /CORRUPT/);
});
test('capacity refuses before POST and preserves bytes without RPC-driven deletion', async () => {
  const f = fixture();
  await fillToCapacity(f);
  const next = await signed(2),
    session = f.session(),
    before = f.value();
  let reads = 0;
  const boundary = captureEvmSubmission(
    next.context,
    session.assertCurrent,
    () =>
      createEvmSignedRecordLifecycle(f.records, session, {
        retirementReadForChain: () => async () => {
          reads++;
          return '0x5';
        },
      })
  );
  let posts = 0,
    failure: unknown;
  try {
    await submitSignedEvmTransaction(
      next.rawTransaction,
      ({ admit }) =>
        admit(async () => {
          posts++;
          return next.hash;
        }),
      boundary,
      undefined,
      Transaction.from(next.rawTransaction).unsignedSerialized
    );
  } catch (e) {
    failure = e;
  }
  assert(failure instanceof Error);
  assert.equal(failure.message, 'EVM_SIGNED_RECORD_CAPACITY');
  assert.equal(
    consumeSignedEvmCapacityRefusal(failure, evmSubmissionFailure),
    true
  );
  assert.equal(posts, 0);
  assert.equal(reads, 0);
  assert.equal(f.value(), before);
  assert.equal(
    (
      await f.records.captureAutoNonceSnapshot(
        f.session(),
        chainId,
        signer.address
      )
    ).minimumNonce,
    0
  );
  assert.equal(await clear(f), 2);
  await createEvmSignedRecordLifecycle(f.records, f.session(), {
    retirementReadForChain: null,
  }).persistSigned(next);
  assert.equal(await f.records.validate(f.session()), 1);
});

test('automatic cleanup requires a terminal group and exact finalized inclusion, without installing a floor', async () => {
  const f = fixture();
  await fillToCapacity(f);
  const first = await signed(0),
    second = await signed(1),
    next = await signed(2);
  for (const entry of [first, second])
    await f.records.updatePhase(
      f.session(),
      chainId,
      signer.address,
      entry.hash,
      'confirmed'
    );
  const blockHash = '0x' + 'ab'.repeat(32),
    finalHash = '0x' + 'cd'.repeat(32);
  let reads = 0,
    posts = 0;
  const read = async (
    method: string,
    params: readonly unknown[]
  ): Promise<unknown> => {
    reads++;
    if (method === 'eth_chainId') return '0x' + BigInt(chainId).toString(16);
    if (method === 'eth_getTransactionCount') return '0x5';
    if (method === 'eth_getTransactionReceipt')
      return {
        transactionHash: params[0],
        from: signer.address,
        to: signer.address,
        status: '0x1',
        blockNumber: '0x10',
        blockHash,
        transactionIndex: params[0] === first.hash ? '0x0' : '0x1',
      };
    if (params[0] === '0x10')
      return {
        number: '0x10',
        hash: blockHash,
        gasLimit: '0x1c9c380',
        transactions: [first.hash, second.hash],
      };
    return {
      number: '0x20',
      hash: finalHash,
      gasLimit: '0x1c9c380',
      transactions: [],
    };
  };
  const session = f.session(),
    boundary = captureEvmSubmission(next.context, session.assertCurrent, () =>
      createEvmSignedRecordLifecycle(f.records, session, {
        retirementReadForChain: () => read,
      })
    );
  await submitSignedEvmTransaction(
    next.rawTransaction,
    ({ admit }) =>
      admit(async () => {
        posts++;
        return next.hash;
      }),
    boundary,
    undefined,
    Transaction.from(next.rawTransaction).unsignedSerialized
  );
  assert.equal(posts, 1);
  assert(reads > 0);
  assert.equal(await f.records.validate(f.session()), 1);
  assert.deepEqual((await rootPayload(f)).nonceFloors, []);
  assert.equal(
    (await f.records.readExact(f.session(), chainId, signer.address, next.hash))
      ?.rawTransaction,
    next.rawTransaction
  );
});

test('unresolved replacement siblings and a receipt without indexed inclusion prevent cleanup', async () => {
  const f = fixture(),
    first = await signed(0);
  await f.records.append(f.session(), first);
  const binding = await f.records.captureVerifiedReplacement(f.session(), {
    ...scope,
    nonce: 0,
    operation: 'speed-up',
    originalHash: first.hash,
  });
  const raw = await signer.signTransaction({
    type: 2,
    chainId,
    nonce: 0,
    to: signer.address,
    value: 1,
    gasLimit: 21000,
    maxFeePerGas: 4,
    maxPriorityFeePerGas: 2,
  });
  await f.records.append(
    f.session(),
    {
      ...first,
      rawTransaction: raw,
      hash: Transaction.from(raw).hash!,
      context: {
        ...first.context,
        operation: 'speed-up',
        originalHash: first.hash,
      },
    },
    undefined,
    binding
  );
  await f.records.updatePhase(
    f.session(),
    chainId,
    signer.address,
    first.hash,
    'confirmed'
  );
  let reads = 0;
  assert.equal(
    await f.records.retireFinalized(
      f.session(),
      scope,
      async () => {
        reads++;
        return '0x5';
      },
      { removed: 0 }
    ),
    0
  );
  assert.equal(reads, 0);
  assert.equal(await f.records.validate(f.session()), 2);
  const g = fixture();
  await g.records.append(g.session(), first);
  await g.records.updatePhase(
    g.session(),
    chainId,
    signer.address,
    first.hash,
    'confirmed'
  );
  const before = g.value();
  assert.equal(
    await g.records.retireFinalized(
      g.session(),
      scope,
      async (method) => {
        if (method === 'eth_chainId')
          return '0x' + BigInt(chainId).toString(16);
        if (method === 'eth_getTransactionReceipt')
          return {
            transactionHash: first.hash,
            from: signer.address,
            to: signer.address,
            status: '0x1',
            blockNumber: '0x10',
            blockHash: '0x' + 'ab'.repeat(32),
          };
        return {
          number: '0x10',
          hash: '0x' + 'ab'.repeat(32),
          gasLimit: '0x1c9c380',
        };
      },
      { removed: 0 }
    ),
    0
  );
  assert.equal(g.value(), before);
});

function finalizedRead(
  entries: Awaited<ReturnType<typeof signed>>[],
  network = chainId
) {
  const included = '0x' + 'ab'.repeat(32);
  const finalized = '0x' + 'cd'.repeat(32);
  return async (
    method: string,
    params: readonly unknown[]
  ): Promise<unknown> => {
    if (method === 'eth_chainId') return '0x' + BigInt(network).toString(16);
    if (method === 'eth_getTransactionCount') return '0x100';
    if (method === 'eth_getTransactionReceipt') {
      const index = entries.findIndex((entry) => entry.hash === params[0]);
      assert(index >= 0);
      return {
        transactionHash: entries[index]!.hash,
        from: signer.address,
        to: signer.address,
        status: '0x1',
        blockNumber: '0x10',
        blockHash: included,
        transactionIndex: '0x' + index.toString(16),
      };
    }
    assert.equal(method, 'eth_getBlockByNumber');
    if (params[0] === '0x10')
      return {
        number: '0x10',
        hash: included,
        gasLimit: '0x1c9c380',
        transactions: entries.map((entry) => entry.hash),
      };
    assert(params[0] === 'finalized' || params[0] === '0x20');
    return {
      number: '0x20',
      hash: finalized,
      gasLimit: '0x1c9c380',
      transactions: [],
    };
  };
}
async function terminalFixture(count = 1) {
  const f = fixture();
  const entries: Awaited<ReturnType<typeof signed>>[] = [];
  for (let nonce = 0; nonce < count; nonce++) {
    const entry = await signed(nonce);
    entries.push(entry);
    await f.records.append(f.session(), entry);
    await f.records.updatePhase(
      f.session(),
      chainId,
      signer.address,
      entry.hash,
      'confirmed'
    );
  }
  return { f, entries, read: finalizedRead(entries) };
}
function hold() {
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    started,
    release,
    async wait() {
      entered();
      await waiting;
    },
  };
}

for (const change of ['missing receipt', 'changed outcome', 'reorg'] as const) {
  test(`terminal cleanup preserves bytes when ${change} appears before commit`, async () => {
    const { f, read } = await terminalFixture();
    const before = f.value();
    let receipts = 0;
    const pruning = f.records.retireFinalized(
      f.session(),
      scope,
      async (method, params) => {
        const value = await read(method, params);
        if (method === 'eth_getTransactionReceipt' && ++receipts === 2) {
          if (change === 'missing receipt') return null;
          return {
            ...(value as object),
            ...(change === 'changed outcome'
              ? { status: '0x0' }
              : { blockHash: '0x' + 'ef'.repeat(32) }),
          };
        }
        return value;
      },
      { removed: 0 }
    );
    if (change === 'reorg') await assert.rejects(pruning, /CONTEXT_CHANGED/);
    else assert.equal(await pruning, 0);
    assert.equal(receipts, 2);
    assert.equal(f.value(), before);
    assert.equal(await f.records.validate(f.session()), 1);
  });
}

for (const phase of ['read', 'commit'] as const) {
  test(`terminal cleanup rejects a session revoked during ${phase}`, async () => {
    const { f, read } = await terminalFixture();
    const before = f.value(),
      paused = hold();
    const original = f.port.compareAndSet;
    if (phase === 'commit')
      f.port.compareAndSet = async (...args) => {
        f.revoke();
        return original(...args);
      };
    const pruning = f.records.retireFinalized(
      f.session(),
      scope,
      async (method, params) => {
        if (phase === 'read' && method === 'eth_getTransactionReceipt')
          await paused.wait();
        return read(method, params);
      },
      { removed: 0 }
    );
    const rejected = assert.rejects(pruning, /revoked/);
    if (phase === 'read') {
      await paused.started;
      f.revoke();
      paused.release();
    }
    await rejected;
    assert.equal(f.value(), before);
    assert.equal(await f.records.validate(f.session()), 1);
  });
}

test('automatic terminal cleanup leaves marked and unmarked privacy transactions untouched', async () => {
  const f = fixture();
  const session = f.session();
  const mainnet = '1';
  const payerScope = { chainId: mainnet, from: signer.address };
  const pool = getPrivacyPool('eth-0.1');
  const abi = new Interface([
    'function deposit(bytes32 commitment) payable',
    'function withdraw(bytes proof,bytes32 root,bytes32 nullifierHash,address recipient,address relayer,uint256 fee,uint256 refund) payable',
  ]);
  const digest = '0x' + 'ab'.repeat(32);
  const markedDeposit = await signed(0, signer, mainnet);
  const markedWithdrawal = await signed(1, signer, mainnet);
  const unmarkedDeposit = await signed(2, signer, mainnet, {
    to: pool.address,
    data: abi.encodeFunctionData('deposit', [digest]),
    value: parseEther(pool.amount),
  });
  const unmarkedWithdrawal = await signed(3, signer, mainnet, {
    to: pool.address,
    data: abi.encodeFunctionData('withdraw', [
      '0x' + '12'.repeat(256),
      digest,
      digest,
      signer.address,
      otherSigner.address,
      0,
      0,
    ]),
    value: 0n,
  });
  const ordinary = await signed(4, signer, mainnet);
  const privateRecords = [
    markedDeposit,
    markedWithdrawal,
    unmarkedDeposit,
    unmarkedWithdrawal,
  ];
  await f.records.append(session, markedDeposit, { privateDeposit: true });
  await f.records.append(session, markedWithdrawal, { privateWithdrawal: true });
  for (const entry of [unmarkedDeposit, unmarkedWithdrawal, ordinary])
    await f.records.append(session, entry);
  const binding = await f.records.captureVerifiedReplacement(session, {
    ...payerScope,
    nonce: unmarkedDeposit.nonce,
    operation: 'cancel',
    originalHash: unmarkedDeposit.hash,
  });
  const cancelRaw = await signer.signTransaction({
    type: 2,
    chainId: mainnet,
    nonce: unmarkedDeposit.nonce,
    to: signer.address,
    value: 0,
    gasLimit: Transaction.from(unmarkedDeposit.rawTransaction).gasLimit,
    maxFeePerGas: 4,
    maxPriorityFeePerGas: 2,
  });
  const cancellation = {
    ...unmarkedDeposit,
    rawTransaction: cancelRaw,
    hash: Transaction.from(cancelRaw).hash!,
    context: {
      ...unmarkedDeposit.context,
      operation: 'cancel' as const,
      originalHash: unmarkedDeposit.hash,
    },
  };
  await f.records.append(session, cancellation, undefined, binding);
  const protectedRecords = [...privateRecords, cancellation];
  const expectedPhase = (hash: string) =>
    hash === unmarkedDeposit.hash ? 'nonce-consumed' : 'confirmed';
  for (const entry of [...protectedRecords, ordinary])
    await f.records.updatePhase(
      session,
      mainnet,
      signer.address,
      entry.hash,
      expectedPhase(entry.hash)
    );

  const read = finalizedRead([ordinary], mainnet);
  const calls: Array<{ method: string; params: readonly unknown[] }> = [];
  const removed = await f.records.retireAvailableFinalized(
    session,
    payerScope,
    (network) => {
      assert.equal(network, mainnet);
      return async (method, params) => {
        calls.push({ method, params });
        return read(method, params);
      };
    }
  );

  assert.equal(removed, 1);
  assert.deepEqual(
    new Set(
      calls
        .filter(({ method }) => method === 'eth_getTransactionReceipt')
        .map(({ params }) => params[0])
    ),
    new Set([ordinary.hash])
  );
  for (const entry of protectedRecords) {
    assert(!JSON.stringify(calls).includes(entry.hash));
    const retained = await f.records.readExact(
      session,
      mainnet,
      signer.address,
      entry.hash
    );
    assert.equal(retained?.phase, expectedPhase(entry.hash));
    assert.equal(retained.rawTransaction, entry.rawTransaction);
  }
  assert.equal(
    await f.records.readExact(session, mainnet, signer.address, ordinary.hash),
    null
  );
});

test('automatic terminal cleanup shares a 64-read budget across groups', async () => {
  const { f, entries, read } = await terminalFixture(10);
  let reads = 0;
  const removed = await f.records.retireAvailableFinalized(
    f.session(),
    scope,
    () => async (method, params) => {
      reads++;
      return read(method, params);
    }
  );
  assert.equal(reads, 64);
  const retainedCount = await f.records.validate(f.session());
  assert(
    retainedCount < entries.length,
    'fixture must reclaim some completed groups before exhausting its budget'
  );
  assert(removed > 0 && removed < entries.length);
  assert.equal(await f.records.validate(f.session()), entries.length - removed);
  for (const entry of entries) {
    const remaining = await f.records.readExact(
      f.session(),
      chainId,
      signer.address,
      entry.hash
    );
    if (remaining) assert.equal(remaining.rawTransaction, entry.rawTransaction);
  }
  assert.deepEqual((await rootPayload(f)).nonceFloors, []);
});

test('automatic terminal cleanup times out at 12 seconds and cannot apply a late response', async (t) => {
  const { f, read } = await terminalFixture();
  const before = f.value(),
    paused = hold();
  let clock = 0,
    signal: AbortSignal | undefined;
  t.mock.method(performance, 'now', () => clock);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pruning = f.records.retireAvailableFinalized(
    f.session(),
    scope,
    (_chain, ownerSignal) => {
      signal = ownerSignal;
      return async (method, params) => {
        await paused.wait();
        return read(method, params);
      };
    }
  );
  await paused.started;
  let settled = false;
  void pruning.then(() => {
    settled = true;
  });
  clock = 11_999;
  t.mock.timers.tick(11_999);
  await Promise.resolve();
  assert.equal(settled, false);
  clock = 12_000;
  t.mock.timers.tick(1);
  assert.equal(await pruning, 0);
  assert.equal(signal?.aborted, true);
  paused.release();
  await f.records.validate(f.session());
  assert.equal(f.value(), before);
});

test('unsupported finality leaves completed and pending recovery bytes intact', async () => {
  const { f, entries, read } = await terminalFixture();
  const pending = await signed(1);
  await f.records.append(f.session(), pending);
  const before = f.value();
  const removed = await f.records.retireAvailableFinalized(
    f.session(),
    scope,
    () => async (method, params) => {
      if (method === 'eth_getBlockByNumber' && params[0] === 'finalized')
        throw Object.assign(new Error('Unsupported block tag'), {
          code: -32602,
        });
      return read(method, params);
    }
  );
  assert.equal(removed, 0);
  assert.equal(f.value(), before);
  for (const entry of [...entries, pending])
    assert.equal(
      (
        await f.records.readExact(
          f.session(),
          chainId,
          signer.address,
          entry.hash
        )
      )?.rawTransaction,
      entry.rawTransaction
    );
});

test('a competing writer adding an unresolved sibling defeats terminal cleanup CAS', async () => {
  const { f, entries, read } = await terminalFixture();
  const first = entries[0]!,
    other = new EvmSignedRecords({ ...f.port }),
    paused = hold();
  let receipts = 0;
  const pruning = f.records.retireFinalized(
    f.session(),
    scope,
    async (method, params) => {
      if (method === 'eth_getTransactionReceipt' && ++receipts === 2)
        await paused.wait();
      return read(method, params);
    },
    { removed: 0 }
  );
  await paused.started;
  // A separate host observes a reorg and prepares a legitimate fee replacement.
  await other.updatePhase(
    f.session(),
    chainId,
    signer.address,
    first.hash,
    'submitted'
  );
  const binding = await other.captureVerifiedReplacement(f.session(), {
    ...scope,
    nonce: 0,
    operation: 'speed-up',
    originalHash: first.hash,
  });
  const raw = await signer.signTransaction({
    type: 2,
    chainId,
    nonce: 0,
    to: signer.address,
    value: 1,
    gasLimit: 21000,
    maxFeePerGas: 4,
    maxPriorityFeePerGas: 2,
  });
  await other.append(
    f.session(),
    {
      ...first,
      rawTransaction: raw,
      hash: Transaction.from(raw).hash!,
      context: {
        ...first.context,
        operation: 'speed-up',
        originalHash: first.hash,
      },
    },
    undefined,
    binding
  );
  paused.release();
  assert.equal(await pruning, 0);
  assert.equal(await f.records.validate(f.session()), 2);
  assert.equal(
    (
      await f.records.readExact(
        f.session(),
        chainId,
        signer.address,
        first.hash
      )
    )?.rawTransaction,
    first.rawTransaction
  );
  assert.equal(
    (
      await f.records.readExact(
        f.session(),
        chainId,
        signer.address,
        Transaction.from(raw).hash!
      )
    )?.rawTransaction,
    raw
  );
});

test('the aggregate deadline reports groups already committed before a later read stalls', async (t) => {
  const { f, entries, read } = await terminalFixture(2);
  const paused = hold();
  let clock = 0;
  t.mock.method(performance, 'now', () => clock);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pruning = f.records.retireAvailableFinalized(
    f.session(),
    scope,
    () => async (method, params) => {
      if (
        method === 'eth_getTransactionReceipt' &&
        params[0] === entries[1]!.hash
      )
        await paused.wait();
      return read(method, params);
    }
  );
  await paused.started;
  try {
    assert.equal(await f.records.validate(f.session()), 1);
    clock = 12_000;
    t.mock.timers.tick(12_000);
    assert.equal(await pruning, 1);
  } finally {
    paused.release();
  }
  assert.equal(await f.records.validate(f.session()), 1);
});

test('a completed group beyond the read budget is reached on the next cleanup attempt', async () => {
  const { f, entries, read } = await terminalFixture(17);
  const later = entries[16]!;
  let reads = 0;
  const receipts: string[] = [];
  const resolveRead =
    () =>
    async (method: Parameters<typeof read>[0], params: readonly unknown[]) => {
      reads++;
      if (method === 'eth_getTransactionReceipt') {
        receipts.push(String(params[0]));
        if (params[0] !== later.hash) return null;
      }
      return read(method, params);
    };
  assert.equal(
    await f.records.retireAvailableFinalized(f.session(), scope, resolveRead),
    0
  );
  assert.equal(reads, 64);
  assert.deepEqual(
    receipts,
    entries.slice(0, 16).map((entry) => entry.hash)
  );
  assert.equal(await f.records.validate(f.session()), 17);

  reads = 0;
  receipts.length = 0;
  assert.equal(
    await f.records.retireAvailableFinalized(f.session(), scope, resolveRead),
    1
  );
  assert.equal(receipts[0], later.hash);
  assert(reads <= 64);
  assert.equal(
    await f.records.readExact(f.session(), chainId, signer.address, later.hash),
    null
  );
  assert.equal(await f.records.validate(f.session()), 16);
  for (const entry of entries.slice(0, 16))
    assert.equal(
      (
        await f.records.readExact(
          f.session(),
          chainId,
          signer.address,
          entry.hash
        )
      )?.rawTransaction,
      entry.rawTransaction
    );
});

test('an interrupted validation resumes before trailing groups after a 63-read prefix', async () => {
  const { f, entries, read } = await terminalFixture(18);
  const invalid = entries[15]!,
    later = entries[16]!;
  let reads = 0;
  const receipts: string[] = [];
  const resolveRead =
    () =>
    async (method: Parameters<typeof read>[0], params: readonly unknown[]) => {
      reads++;
      if (method === 'eth_getTransactionReceipt') {
        receipts.push(String(params[0]));
        if (params[0] !== invalid.hash && params[0] !== later.hash) return null;
        if (params[0] === invalid.hash)
          return {
            transactionHash: invalid.hash,
            from: signer.address,
            to: signer.address,
            status: '0x1',
            blockNumber: '0x9',
            blockHash: '0x' + 'ef'.repeat(32),
            transactionIndex: '0x0',
          };
      }
      if (method === 'eth_getBlockByNumber' && params[0] === '0x9')
        return {
          number: '0x9',
          hash: '0x' + 'ff'.repeat(32),
          gasLimit: '0x1c9c380',
          transactions: [invalid.hash],
        };
      return read(method, params);
    };
  assert.equal(
    await f.records.retireAvailableFinalized(f.session(), scope, resolveRead),
    0
  );
  assert.equal(reads, 64);
  assert.equal(receipts.length, 16);
  receipts.length = 0;
  reads = 0;
  assert.equal(
    await f.records.retireAvailableFinalized(f.session(), scope, resolveRead),
    1
  );
  assert.equal(receipts[0], later.hash);
  assert(reads <= 64);
  assert.equal(await f.records.validate(f.session()), 17);
});

test('a timed-out receipt yields to the next completed group on the next attempt', async (t) => {
  const { f, entries, read } = await terminalFixture(2);
  const paused = hold();
  let clock = 0,
    stall = true;
  const receipts: string[] = [];
  t.mock.method(performance, 'now', () => clock);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const resolveRead =
    () =>
    async (method: Parameters<typeof read>[0], params: readonly unknown[]) => {
      if (method === 'eth_getTransactionReceipt') {
        receipts.push(String(params[0]));
        if (params[0] === entries[0]!.hash) {
          if (stall) await paused.wait();
          return null;
        }
      }
      return read(method, params);
    };
  const first = f.records.retireAvailableFinalized(
    f.session(),
    scope,
    resolveRead
  );
  await paused.started;
  clock = 12_000;
  t.mock.timers.tick(12_000);
  assert.equal(await first, 0);
  stall = false;
  receipts.length = 0;
  const second = f.records.retireAvailableFinalized(
    f.session(),
    scope,
    resolveRead
  );
  assert.equal(await second, 1);
  assert.equal(receipts[0], entries[1]!.hash);
  paused.release();
  assert.equal(await f.records.validate(f.session()), 1);
});

test('an elapsed deadline yields its group even before timeout callbacks run', async (t) => {
  const { f, entries, read } = await terminalFixture(2);
  let clock = 0,
    jump = true;
  const receipts: string[] = [];
  t.mock.method(performance, 'now', () => clock);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const resolveRead =
    () =>
    async (method: Parameters<typeof read>[0], params: readonly unknown[]) => {
      if (method === 'eth_getTransactionReceipt') {
        receipts.push(String(params[0]));
        if (params[0] === entries[0]!.hash && jump) {
          jump = false;
          clock = 12_000;
        }
      }
      return read(method, params);
    };
  assert.equal(
    await f.records.retireAvailableFinalized(f.session(), scope, resolveRead),
    0
  );
  receipts.length = 0;
  assert.equal(
    await f.records.retireAvailableFinalized(f.session(), scope, resolveRead),
    2
  );
  assert.equal(receipts[0], entries[1]!.hash);
});


test('Smart preparation reads only scoped payer summaries without opening signed payloads', async () => {
  const f = fixture(), session = f.session();
  await f.records.append(session, await signed(0, signer, '1'));
  await f.records.append(session, await signed(0, otherSigner, '1'));
  await f.records.append(session, await signed(0, signer, '2'));
  const opened: string[] = [];
  const decrypt = session.keyring.decryptPrivateRecord.bind(session.keyring);
  session.keyring.decryptPrivateRecord = async input => { opened.push(input.recordId); return decrypt(input); };
  const reader = await f.records.captureSmartAccountPendingRecords(session, '1', '0x1111111111111111111111111111111111111111');
  const records = await reader.readPayerRecords!(signer.address);
  assert.equal(records.length, 1);
  assert.equal(records[0]!.from.toLowerCase(), signer.address.toLowerCase());
  assert.equal(records[0]!.chainId, '1');
  assert(opened.every(id => id === 'manifest'));
  f.revoke();
  await assert.rejects(async () => reader.readPayerRecords!(signer.address), /revoked/);
});

test('Smart nonce projection caches one owned snapshot and invalidates on writes, final refresh and lock', async () => {
  const f = fixture(), session = f.session();
  const smart = '0x1111111111111111111111111111111111111111';
  const create = async (nonce: number, wallet: Wallet) => {
    const operation = { sender: smart, nonce, initCode: '0x', callData: '0x12345678',
      accountGasLimits: '0x' + '00'.repeat(15) + '01' + '00'.repeat(15) + '01', preVerificationGas: 1,
      gasFees: '0x' + '00'.repeat(15) + '01' + '00'.repeat(15) + '03', paymasterAndData: '0x', signature: '0x1234' };
    const submission = await signed(nonce, wallet, '1');
    const bytes = await wallet.signTransaction({ chainId: 1, nonce, to: getPaliEntryPointAddress(1), gasLimit: 500000, gasPrice: 2,
      data: paliEntryPointInterface.encodeFunctionData('handleOps', [[operation], wallet.address]) });
    return { ...submission, type: 0, rawTransaction: bytes, hash: Transaction.from(bytes).hash! };
  };
  await f.records.append(session, await create(0, signer));
  let decryptions = 0, storageReads = 0;
  const original = session.keyring.decryptPrivateRecord.bind(session.keyring);
  session.keyring.decryptPrivateRecord = async (input) => { decryptions++; return original(input); };
  const readStorage = f.port.read.bind(f.port);
  f.port.read = async (id) => { storageReads++; return readStorage(id); };
  const reader = await f.records.captureSmartAccountPendingRecords(session, '1', smart);
  const first = await reader.read(false);
  const firstDecryptions = decryptions, firstStorageReads = storageReads;
  assert.equal(first.length, 1);
  const cached = await reader.read(false);
  assert.deepEqual(cached, first);
  assert.strictEqual(cached[0], first[0]);
  assert.equal(decryptions, firstDecryptions);
  assert.equal(storageReads, firstStorageReads);
  await f.records.append(session, await create(1, otherSigner));
  const afterWriteDecryptions = decryptions, afterWriteStorageReads = storageReads;
  const updated = await reader.read(false);
  assert.equal(updated.length, 2);
  assert(decryptions > afterWriteDecryptions);
  assert(storageReads > afterWriteStorageReads);
  const updatedDecryptions = decryptions, updatedStorageReads = storageReads;
  f.replace(undefined);
  assert.deepEqual(await reader.read(false), updated);
  assert.equal(decryptions, updatedDecryptions);
  assert.equal(storageReads, updatedStorageReads);
  assert.equal((await reader.read(true)).length, 0);
  assert(storageReads > updatedStorageReads);
  f.revoke();
  await assert.rejects(async () => reader.read(false), /revoked/);
});


test('the existing owned Smart projection retains removal identity through phase updates, reopen and fresh storage reads', async () => {
  const f = fixture(),
    session = f.session();
  const smart = '0x1111111111111111111111111111111111111111';
  const moduleAddress = getAddress(
    getPaliModuleAddress(1, 'guardian-recovery')
  );
  const removal = paliSmartAccountInterface.encodeFunctionData(
    'uninstallModule',
    [2, moduleAddress, '0x']
  );
  const callData = paliSmartAccountInterface.encodeFunctionData('execute', [
    ERC7579_MODE_SINGLE_DEFAULT,
    smart + '0'.repeat(64) + removal.slice(2),
  ]);
  const operation = {
    sender: smart,
    nonce: 7,
    initCode: '0x',
    callData,
    accountGasLimits: '0x' + '00'.repeat(15) + '01' + '00'.repeat(15) + '01',
    preVerificationGas: 1,
    gasFees: '0x' + '00'.repeat(15) + '01' + '00'.repeat(15) + '03',
    paymasterAndData: '0x',
    signature: '0x1234',
  };
  const original = await signed(0, signer, '1');
  const rawTransaction = await signer.signTransaction({
    chainId: 1,
    nonce: 0,
    type: 0,
    to: getPaliEntryPointAddress(1),
    gasLimit: 500000,
    gasPrice: 2,
    data: paliEntryPointInterface.encodeFunctionData('handleOps', [
      [operation],
      signer.address,
    ]),
  });
  const hash = Transaction.from(rawTransaction).hash!;
  await f.records.append(session, {
    ...original,
    type: 0,
    rawTransaction,
    hash,
  });
  let decryptions = 0, storageReads = 0;
  const decrypt = session.keyring.decryptPrivateRecord.bind(session.keyring);
  session.keyring.decryptPrivateRecord = async (input) => { decryptions++; return decrypt(input); };
  const readStorage = f.port.read.bind(f.port);
  f.port.read = async (id) => { storageReads++; return readStorage(id); };
  const reader = await f.records.captureSmartAccountPendingRecords(
    session,
    '1',
    smart
  );
  const first = await reader.read(false);
  const firstDecryptions = decryptions, firstStorageReads = storageReads;
  assert.deepEqual(first[0]!.guardianRemoval, { moduleAddress });
  const cached = await reader.read(false);
  assert.deepEqual(cached, first);
  assert.strictEqual(cached[0], first[0]);
  assert.equal(decryptions, firstDecryptions);
  assert.equal(storageReads, firstStorageReads);
  await f.records.updatePhase(session, '1', signer.address, hash, 'confirmed');
  const afterWriteDecryptions = decryptions, afterWriteStorageReads = storageReads;
  const updated = await reader.read(false);
  assert.notStrictEqual(updated[0], first[0]);
  assert(decryptions > afterWriteDecryptions);
  assert(storageReads > afterWriteStorageReads);
  assert.deepEqual(updated[0]!.guardianRemoval, { moduleAddress });
  const reopened = await new EvmSignedRecords(
    f.port
  ).captureSmartAccountPendingRecords(session, '1', smart);
  assert.deepEqual(await reopened.read(true), updated);
  const updatedDecryptions = decryptions, updatedStorageReads = storageReads;
  f.replace(undefined);
  assert.deepEqual(await reader.read(false), updated);
  assert.equal(decryptions, updatedDecryptions);
  assert.equal(storageReads, updatedStorageReads);
  assert.deepEqual(await reader.read(true), []);
  assert(storageReads > updatedStorageReads);
  f.revoke();
  await assert.rejects(async () => reader.read(false), /revoked/);
});

test('signed Smart dispatch projects its authenticated journal inside the admission queue', async () => {
  const { createSmartAccountPendingState } = await import('../../../source/utils/smartAccount/pendingState.ts');
  const f = fixture(), session = f.session();
  const smart = '0x1111111111111111111111111111111111111111';
  const execution = encodeERC7579Executions([{ target: signer.address, value: '0', data: '0x' }]);
  const operation = { sender: smart, nonce: '0', initCode: '0x', callData: paliSmartAccountInterface.encodeFunctionData('execute', [execution.mode, execution.executionCalldata]),
    accountGasLimits: '0x' + '00'.repeat(15) + '01' + '00'.repeat(15) + '01', preVerificationGas: '1',
    gasFees: '0x' + '00'.repeat(15) + '01' + '00'.repeat(15) + '03', paymasterAndData: '0x', signature: '0x1234' };
  const rawTransaction = await signer.signTransaction({ chainId: 1, nonce: 0, to: getPaliEntryPointAddress(1), gasLimit: 500000, gasPrice: 2,
    data: paliEntryPointInterface.encodeFunctionData('handleOps', [[operation], signer.address]) });
  const record = { ...await signed(0, signer, '1'), type: 0, rawTransaction, hash: Transaction.from(rawTransaction).hash! };
  const receipt = await f.records.retainSmartAccountAuthorization(session, {
    chainId: 1,
    observedAt: { number: '1', hash: '0x' + '44'.repeat(32) },
    payer: signer.address,
    userOperation: operation,
  });
  const records = await f.records.captureSmartAccountPendingRecords(session, '1', smart);
  const authorizedRecords = records.forAuthorization!(receipt);
  let projectionReads = 0, broadcasts = 0;
  const nonceTags: unknown[] = [];
  const lifecycle = createEvmSignedRecordLifecycle(f.records, session, {
    retirementReadForChain: null,
    preflight: async (current, check, snapshot) => {
      assert(snapshot.readSmartAccountOperations);
      const provider = {
        verifyConfiguredChainId: async (fresh: boolean) => { assert.equal(fresh, true); },
        send: async (method: string, params: readonly any[]) => {
          assert.equal(method, 'eth_call');
          assert.deepEqual(params[0], {
            to: getPaliEntryPointAddress(1),
            data: paliEntryPointInterface.encodeFunctionData('getNonce', [smart, 0]),
          });
          nonceTags.push(params[1]);
          return paliEntryPointInterface.encodeFunctionResult('getNonce', [0]);
        },
      };
      // A historical outer alone must not exempt a disclosed instruction.
      // Only its current opaque, durably issued receipt grants that exception.
      await assert.rejects(
        createSmartAccountPendingState(provider, {
          ...records,
          read: async () => { throw new Error('Storage queue reentry'); },
          readAuthorizations: async () => { throw new Error('Storage queue reentry'); },
        }, 1, smart, check).onProvider(provider, current.hash, snapshot).assertNonce(operation),
        /SMART_ACCOUNT_PENDING_STATE/
      );
      assert.equal(broadcasts, 0);
      const readOperations = snapshot.readSmartAccountOperations!;
      const pending = createSmartAccountPendingState(provider, {
        ...authorizedRecords,
        read: async () => { throw new Error('Storage queue reentry'); },
        readAuthorizations: async () => { throw new Error('Storage queue reentry'); },
      }, 1, smart, check).onProvider(provider, current.hash, {
        ...snapshot,
        readSmartAccountOperations: async (chainId, address) => {
          projectionReads++;
          return readOperations(chainId, address);
        },
      });
      await pending.assertNonce(operation);
    },
  });
  await lifecycle.persistSigned(record);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      lifecycle.dispatchSigned(record, async () => { broadcasts++; return 'submitted'; }, async () => undefined),
      new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('nested journal queue')), 1000); }),
    ]);
    assert.equal(result, 'submitted');
  } finally { clearTimeout(timeout); }
  assert.equal(projectionReads, 1);
  assert.equal(broadcasts, 1);
  assert.deepEqual(nonceTags, ['latest', 'pending']);
});

test('admission Smart projection includes other payers from the authenticated full manifest', async () => {
  const f = fixture(), session = f.session();
  const smart = '0x1111111111111111111111111111111111111111';
  const make = async (wallet: Wallet) => {
    const execution = encodeERC7579Executions([{ target: signer.address, value: '0', data: '0x' }]);
    const operation = { sender: smart, nonce: '0', initCode: '0x', callData: paliSmartAccountInterface.encodeFunctionData('execute', [execution.mode, execution.executionCalldata]),
      accountGasLimits: '0x' + '00'.repeat(15) + '01' + '00'.repeat(15) + '01', preVerificationGas: '1',
      gasFees: '0x' + '00'.repeat(15) + '01' + '00'.repeat(15) + '03', paymasterAndData: '0x', signature: '0x1234' };
    const rawTransaction = await wallet.signTransaction({ chainId: 1, nonce: 0, to: getPaliEntryPointAddress(1), gasLimit: 500000, gasPrice: 2,
      data: paliEntryPointInterface.encodeFunctionData('handleOps', [[operation], wallet.address]) });
    return { ...await signed(0, wallet, '1'), type: 0, rawTransaction, hash: Transaction.from(rawTransaction).hash! };
  };
  const first = await make(signer), second = await make(otherSigner);
  await f.records.append(session, first);
  await f.records.append(session, second);
  const initial = await f.records.captureAutoNonceSnapshot(session, '1', signer.address);
  assert.equal(initial.retained.length, 1);
  assert.equal((await initial.readSmartAccountOperations!('1', smart)).length, 2);
  await f.records.withReplayAdmission(session, { ...first, operation: 'send', metadata: undefined }, async () => ({ result: undefined }), undefined, {
    assertCurrent() {},
    async run(_, snapshot) {
      const admitted = snapshot();
      assert.equal(admitted.retained.length, 0);
      const projected = await admitted.readSmartAccountOperations!('1', smart);
      assert.deepEqual(new Set(projected.map(row => row.payer.toLowerCase())), new Set([signer.address.toLowerCase(), otherSigner.address.toLowerCase()]));
    },
  });
  f.revoke();
  await assert.rejects(async () => initial.readSmartAccountOperations!('1', smart), /revoked/);
});
