import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import test from 'node:test';
import { Wallet, Transaction } from 'ethers';
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
  type EvmSignedRetirementRead,
  type EvmSignedRecordStorage,
} from '../../../source/wallet/evmSignedRecords.ts';
import { signedRecordTestSession } from './signedRecordTestSession.ts';

Object.defineProperty(globalThis, 'crypto', {
  value: webcrypto,
  configurable: true,
});
const signer = new Wallet(`0x${'31'.repeat(32)}`);
const otherSigner = new Wallet(`0x${'32'.repeat(32)}`);
const chainId = '7654321';
const finalHash = `0x${'ab'.repeat(32)}`;
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
async function signed(nonce: number, wallet = signer, network = chainId) {
  const rawTransaction = await wallet.signTransaction({
    type: 2,
    chainId: network,
    nonce,
    to: wallet.address,
    value: 1,
    gasLimit: 21_000,
    maxFeePerGas: 3,
    maxPriorityFeePerGas: 1,
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
function finality(nonce: number): {
  read: EvmSignedRetirementRead;
  calls: [string, readonly unknown[]][];
} {
  const calls: [string, readonly unknown[]][] = [];
  return {
    calls,
    async read(method, params) {
      calls.push([method, params]);
      if (method === 'eth_chainId') return `0x${BigInt(chainId).toString(16)}`;
      if (method === 'eth_getBlockByNumber')
        return { number: '0x20', hash: finalHash };
      return `0x${nonce.toString(16)}`;
    },
  };
}
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

test('finalized hash-bound nonce retires only its sender and chain below the floor', async () => {
  const f = fixture();
  const entries = await Promise.all([
    signed(0),
    signed(1),
    signed(2),
    signed(0, otherSigner),
    signed(0, signer, '57'),
  ]);
  for (const entry of entries) await f.records.append(f.session(), entry);
  const rpc = finality(2);
  assert.equal(
    await f.records.retireFinalized(f.session(), scope, rpc.read),
    2
  );
  assert.deepEqual(rpc.calls, [
    ['eth_chainId', []],
    ['eth_getBlockByNumber', ['finalized', false]],
    [
      'eth_getTransactionCount',
      [
        signer.address.toLowerCase(),
        { blockHash: finalHash, requireCanonical: true },
      ],
    ],
    ['eth_chainId', []],
  ]);
  const reopened = new EvmSignedRecords(f.port);
  assert.deepEqual(
    (await reopened.listSender(f.session(), chainId, signer.address)).map(
      (e) => e.nonce
    ),
    [2]
  );
  for (const entry of entries.slice(3))
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
  assert.deepEqual((await rootPayload(f)).nonceFloors, [
    { chainId, from: signer.address.toLowerCase(), nonce: 2 },
  ]);
  assert.equal(JSON.parse(f.value()!).nonceFloors, undefined);
  assert.equal(
    (
      await reopened.captureAutoNonceSnapshot(
        f.session(),
        chainId,
        signer.address
      )
    ).minimumNonce,
    2
  );
});

test('floor-only restart blocks ordinary admission, prior replacement capability and stale replay', async () => {
  const f = fixture(),
    first = await signed(0);
  await f.records.append(f.session(), first);
  const oldBinding = await f.records.captureVerifiedReplacement(f.session(), {
    chainId,
    from: signer.address,
    nonce: 0,
    operation: 'speed-up',
    originalHash: first.hash,
  });
  assert.equal(
    await f.records.retireFinalized(f.session(), scope, finality(1).read),
    1
  );
  const reopened = new EvmSignedRecords(f.port);
  assert.equal(await reopened.validate(f.session()), 0);
  assert.equal(
    (
      await reopened.captureAutoNonceSnapshot(
        f.session(),
        chainId,
        signer.address
      )
    ).minimumNonce,
    1
  );
  const belowFloor = /EVM_SIGNED_RECORD_NONCE_FINALIZED/;
  await assert.rejects(reopened.append(f.session(), first), belowFloor);
  await assert.rejects(
    reopened.assertSpendingNonce(f.session(), chainId, signer.address, 0),
    belowFloor
  );
  await assert.rejects(
    reopened.captureVerifiedReplacement(f.session(), {
      chainId,
      from: signer.address,
      nonce: 0,
      operation: 'cancel',
      originalHash: first.hash,
    }),
    belowFloor
  );
  await assert.rejects(
    reopened.append(
      f.session(),
      {
        ...first,
        context: {
          ...first.context,
          operation: 'speed-up',
          originalHash: first.hash,
        },
      },
      undefined,
      oldBinding
    ),
    belowFloor
  );
  let posts = 0;
  await assert.rejects(
    reopened.withReplayAdmission(
      f.session(),
      {
        chainId,
        from: signer.address,
        nonce: 0,
        hash: first.hash,
        operation: 'send',
      },
      () => {
        posts++;
      }
    ),
    belowFloor
  );
  assert.equal(posts, 0);
  const next = await signed(1);
  await reopened.append(f.session(), next);
  await reopened.updatePhase(
    f.session(),
    chainId,
    signer.address,
    next.hash,
    'submitted'
  );
  assert.equal(
    (
      await reopened.captureAutoNonceSnapshot(
        f.session(),
        chainId,
        signer.address
      )
    ).minimumNonce,
    1
  );
});

test('earlier authenticated root without floors remains readable and is preserved on retirement', async () => {
  const f = fixture();
  await f.records.append(f.session(), await signed(0));
  const payload = await rootPayload(f);
  delete payload.nonceFloors;
  await replaceRoot(f, payload);
  const reopened = new EvmSignedRecords(f.port);
  assert.equal(await reopened.validate(f.session()), 1);
  assert.equal(
    await reopened.retireFinalized(f.session(), scope, finality(1).read),
    1
  );
  assert.equal(await reopened.validate(f.session()), 0);
  assert.equal((await rootPayload(f)).nonceFloors[0].nonce, 1);
});

test('unsupported finality, malformed quantities and switched endpoints preserve records', async () => {
  const f = fixture();
  await f.records.append(f.session(), await signed(0));
  const before = f.value();
  const chain = `0x${BigInt(chainId).toString(16)}`;
  const cases: EvmSignedRetirementRead[] = [
    async () => {
      throw new Error('unsupported');
    },
    async () => '0x1',
    async (method) => (method === 'eth_chainId' ? chain : null),
    async (method) =>
      method === 'eth_chainId' ? chain : { number: '0x00', hash: finalHash },
    async (method) =>
      method === 'eth_chainId'
        ? chain
        : method === 'eth_getBlockByNumber'
        ? { number: '0x20', hash: finalHash }
        : '0x20000000000000',
  ];
  let chainReads = 0;
  const rpc = finality(1);
  cases.push(async (method, params) =>
    method === 'eth_chainId' && ++chainReads === 2
      ? '0x1'
      : rpc.read(method, params)
  );
  for (const read of cases) {
    assert.equal(await f.records.retireFinalized(f.session(), scope, read), 0);
    assert.equal(f.value(), before);
  }
});

test('revocation during an RPC or atomic storage write prevents retirement', async () => {
  for (const stage of ['read', 'commit']) {
    const f = fixture();
    await f.records.append(f.session(), await signed(0));
    const before = f.value(),
      rpc = finality(1),
      commit = f.port.compareAndSet;
    const read: EvmSignedRetirementRead = async (method, params) => {
      if (stage === 'read' && method === 'eth_getTransactionCount') f.revoke();
      return rpc.read(method, params);
    };
    if (stage === 'commit')
      f.port.compareAndSet = async (...args) => {
        f.revoke();
        return commit(...args);
      };
    await assert.rejects(
      f.records.retireFinalized(f.session(), scope, read),
      /revoked/
    );
    assert.equal(f.value(), before);
  }
});

test('CAS reload preserves a competing append while retiring finalized bytes', async () => {
  const f = fixture(),
    zero = await signed(0),
    next = await signed(1);
  await f.records.append(f.session(), zero);
  const original = f.port.compareAndSet,
    other = new EvmSignedRecords({ ...f.port });
  f.port.compareAndSet = async (...args) => {
    f.port.compareAndSet = original;
    await other.append(f.session(), next);
    return original(...args);
  };
  assert.equal(
    await f.records.retireFinalized(f.session(), scope, finality(1).read),
    1
  );
  assert.equal(
    (await f.records.readExact(f.session(), chainId, signer.address, next.hash))
      ?.rawTransaction,
    next.rawTransaction
  );
  assert.equal(
    await f.records.readExact(f.session(), chainId, signer.address, zero.hash),
    null
  );
});

test('nonce floor stays monotonic without storage growth for empty or unconsumed scopes', async () => {
  const f = fixture();
  assert.equal(
    await f.records.retireFinalized(f.session(), scope, finality(5).read),
    0
  );
  assert.equal(f.writes(), 0);
  await f.records.append(f.session(), await signed(1));
  assert.equal(
    await f.records.retireFinalized(f.session(), scope, finality(1).read),
    0
  );
  assert.equal(f.writes(), 1);
  assert.equal(
    await f.records.retireFinalized(f.session(), scope, finality(2).read),
    1
  );
  const before = f.value();
  assert.equal(
    await f.records.retireFinalized(f.session(), scope, finality(1).read),
    0
  );
  assert.equal(f.value(), before);
});

test('an authenticated root cannot retain entries below its nonce floor', async () => {
  const f = fixture();
  await f.records.append(f.session(), await signed(0));
  const payload = await rootPayload(f);
  payload.nonceFloors = [
    { chainId, from: signer.address.toLowerCase(), nonce: 1 },
  ];
  await replaceRoot(f, payload);
  await assert.rejects(f.records.validate(f.session()), /CORRUPT/);
});

async function fillToCapacity(f: ReturnType<typeof fixture>) {
  const first = await signed(0),
    second = await signed(1);
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

test('capacity retires finalized bytes and retries the exact signed envelope before one POST', async () => {
  const f = fixture();
  await fillToCapacity(f);
  const next = await signed(2),
    rpc = finality(1),
    session = f.session();
  const boundary = captureEvmSubmission(
    next.context,
    session.assertCurrent,
    () =>
      createEvmSignedRecordLifecycle(f.records, session, {
        retirementRead: rpc.read,
      })
  );
  let posts = 0;
  const result = await submitSignedEvmTransaction(
    next.rawTransaction,
    ({ admit }) =>
      admit(async () => {
        posts++;
        assert.equal(
          (
            await f.records.readExact(
              session,
              chainId,
              signer.address,
              next.hash
            )
          )?.rawTransaction,
          next.rawTransaction
        );
        return next.hash;
      }),
    boundary,
    undefined,
    Transaction.from(next.rawTransaction).unsignedSerialized
  );
  assert.equal(result, next.hash);
  assert.equal(posts, 1);
  assert.equal(rpc.calls.length, 4);
  assert.equal(
    await f.records.readExact(
      session,
      chainId,
      signer.address,
      (
        await signed(0)
      ).hash
    ),
    null
  );
  assert.equal(
    (await f.records.captureAutoNonceSnapshot(session, chainId, signer.address))
      .minimumNonce,
    1
  );
});

test('unavailable finality retains genuine capacity refusal and normal sends have no finality reads', async () => {
  const f = fixture();
  await fillToCapacity(f);
  const next = await signed(2),
    session = f.session();
  let reads = 0,
    posts = 0;
  const read: EvmSignedRetirementRead = async () => {
    reads++;
    throw new Error('unsupported');
  };
  const boundary = captureEvmSubmission(
    next.context,
    session.assertCurrent,
    () =>
      createEvmSignedRecordLifecycle(f.records, session, {
        retirementRead: read,
      })
  );
  const before = f.value();
  let failure: unknown;
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
  } catch (error) {
    failure = error;
  }
  assert(failure instanceof Error);
  assert.equal(failure.message, 'EVM_SIGNED_RECORD_CAPACITY');
  assert.equal(
    consumeSignedEvmCapacityRefusal(failure, evmSubmissionFailure),
    true
  );
  assert.equal(posts, 0);
  assert.equal(reads, 1);
  assert.equal(f.value(), before);
  const healthy = fixture();
  await createEvmSignedRecordLifecycle(healthy.records, healthy.session(), {
    retirementRead: read,
  }).persistSigned(next);
  assert.equal(reads, 1);
});

test('deadline expiry during encryption or the final CAS guard preserves the original bundle', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(performance, 'now');
  const realNow = performance.now.bind(performance);
  try {
    for (const stage of ['encrypt', 'commit']) {
      let clock = 0;
      Object.defineProperty(performance, 'now', {
        configurable: true,
        value: () => clock,
      });
      const f = fixture();
      await f.records.append(f.session(), await signed(0));
      const before = f.value();
      const session = f.session();
      if (stage === 'encrypt') {
        const original = session.keyring.encryptPrivateRecord.bind(
          session.keyring
        );
        session.keyring.encryptPrivateRecord = async (input) => {
          const result = await original(input);
          clock = 12_001;
          return result;
        };
      } else {
        const original = f.port.compareAndSet;
        f.port.compareAndSet = async (...args) => {
          clock = 12_001;
          return original(...args);
        };
      }
      assert.equal(
        await f.records.retireFinalized(session, scope, finality(1).read),
        0
      );
      assert.equal(f.value(), before);
    }
  } finally {
    if (descriptor) Object.defineProperty(performance, 'now', descriptor);
    else {
      delete (performance as unknown as Record<string, unknown>).now;
      assert.equal(typeof realNow(), 'number');
    }
  }
});

test('floor manifest expansion beyond the SDK plaintext limit retains every signed record', async () => {
  const f = fixture();
  await f.records.append(f.session(), await signed(0));
  const payload = await rootPayload(f);
  const floors: { chainId: string; from: string; nonce: number }[] = [];
  payload.nonceFloors = floors;
  for (let address = 1; ; address++) {
    floors.push({
      chainId: '57',
      from: `0x${address.toString(16).padStart(40, '0')}`,
      nonce: 0,
    });
    if (Buffer.byteLength(JSON.stringify(payload)) > 64 * 1024) {
      floors.pop();
      break;
    }
  }
  await replaceRoot(f, payload);
  const before = f.value();
  assert.equal(await f.records.validate(f.session()), 1);
  assert.equal(
    await f.records.retireFinalized(f.session(), scope, finality(1).read),
    0
  );
  assert.equal(f.value(), before);
  assert.equal(
    (
      await f.records.readExact(
        f.session(),
        chainId,
        signer.address,
        (
          await signed(0)
        ).hash
      )
    )?.nonce,
    0
  );
});

test('all replacement variants at a finalized nonce retire together', async () => {
  const f = fixture(),
    original = await signed(0);
  await f.records.append(f.session(), original);
  const binding = await f.records.captureVerifiedReplacement(f.session(), {
    chainId,
    from: signer.address,
    nonce: 0,
    originalHash: original.hash,
    operation: 'speed-up',
  });
  const rawTransaction = await signer.signTransaction({
    type: 2,
    chainId,
    nonce: 0,
    to: signer.address,
    value: 1,
    gasLimit: 21_000,
    maxFeePerGas: 6,
    maxPriorityFeePerGas: 2,
  });
  const replacement = {
    ...original,
    rawTransaction,
    hash: Transaction.from(rawTransaction).hash!,
    context: {
      ...original.context,
      operation: 'speed-up' as const,
      originalHash: original.hash,
    },
  };
  await f.records.append(f.session(), replacement, undefined, binding);
  assert.equal(
    await f.records.retireFinalized(f.session(), scope, finality(1).read),
    2
  );
  assert.equal(await f.records.validate(f.session()), 0);
});
