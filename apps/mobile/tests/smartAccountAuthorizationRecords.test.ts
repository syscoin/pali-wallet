import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import test from 'node:test';
import { Transaction, Wallet, keccak256, sha256 } from 'ethers';
import { SoftwareKeyring } from '@sidhujag/sysweb3-keyring/cjs/software.js';
import {
  EvmSignedRecords,
  assertSmartAccountAuthorizationReceipt,
  resolveSmartAccountAuthorization,
  inspectEvmSignedBundle,
  type EvmSignedRecordSession,
  type EvmSignedRecordStorage,
  type SmartAccountAuthorizationReceipt,
} from '../../../source/wallet/evmSignedRecords.ts';
import {
  buildSmartAccountUserOperation,
  encodeERC7579Executions,
  encodeSmartAccountValidatorNonceKey,
} from '../../../source/utils/smartAccount/account.ts';
import { captureSignedSmartAccountOperation } from '../../../source/wallet/smartAccountAuthorization.ts';
import {
  getPaliEntryPointAddress,
  paliEntryPointInterface,
  paliSmartAccountInterface,
} from '../../../source/utils/smartAccount/contracts.ts';
import { getSmartAccountUserOpHash } from '../../../source/utils/smartAccount/userOperationHash.ts';

Object.defineProperty(globalThis, 'crypto', {
  value: webcrypto,
  configurable: true,
});
const owner = new Wallet(`0x${'11'.repeat(32)}`);
const account = `0x${'22'.repeat(20)}`;
const validator = `0x${'33'.repeat(20)}`;
const blockHash = `0x${'44'.repeat(32)}`;
const rootDomain = 'org.syscoin.pali.evm.signed.root.v1';

// Same real SDK private-record encryption fixture as sharedSignedRecords.test.ts.
// Only the unlocked mnemonic/session boundary and the atomic storage port are local.
function fixture() {
  const keyring: any = Object.create(SoftwareKeyring.prototype);
  keyring.sessionPassword = { isCleared: () => false };
  keyring.sessionMnemonic = { isCleared: () => false };
  keyring.privateRecordSessionRevision = 0;
  keyring.getDecryptedMnemonic = () => 'synthetic shared signed-record root';
  let stored: string | undefined;
  let revision = 0;
  let writes = 0;
  const port: EvmSignedRecordStorage = {
    async read() {
      return stored;
    },
    async compareAndSet(_profile, expected, next, check) {
      check();
      if (stored !== expected) return false;
      stored = next;
      writes++;
      return true;
    },
  };
  const session = (): EvmSignedRecordSession => {
    const captured = revision;
    return {
      keyring,
      assertCurrent() {
        if (captured !== revision) throw new Error('revoked');
      },
    };
  };
  return {
    store: new EvmSignedRecords(port, () => 1000),
    port,
    session,
    keyring,
    value: () => stored,
    writes: () => writes,
    replace(value: string | undefined) {
      stored = value;
    },
    revoke() {
      revision++;
    },
  };
}

function authorization(sequence = 0, chainId = 1, sender = account) {
  const userOperation = buildSmartAccountUserOperation({
    sender,
    nonce: (
      (BigInt(encodeSmartAccountValidatorNonceKey(validator)) << 64n) +
      BigInt(sequence)
    ).toString(),
    callData: '0x1234',
  });
  userOperation.signature = owner.signingKey.sign(
    getSmartAccountUserOpHash(userOperation, chainId)
  ).serialized;
  return {
    chainId,
    payer: owner.address,
    observedAt: { number: '100', hash: blockHash },
    userOperation,
  };
}

function cancellation(original: ReturnType<typeof authorization>) {
  const userOperation = { ...original.userOperation };
  const noop = encodeERC7579Executions([
    { target: account, value: '0x0', data: '0x' },
  ]);
  userOperation.callData = paliSmartAccountInterface.encodeFunctionData(
    'execute',
    [noop.mode, noop.executionCalldata]
  );
  userOperation.signature = owner.signingKey.sign(
    getSmartAccountUserOpHash(userOperation, original.chainId)
  ).serialized;
  return {
    ...original,
    userOperation,
    replacesOperationHash: getSmartAccountUserOpHash(
      original.userOperation,
      original.chainId
    ),
  };
}

test('randomized same-nonce no-op retry resolves only the first retained signature', async () => {
  const f = fixture(),
    original = authorization(),
    session = f.session();
  await f.store.retainSmartAccountAuthorization(session, original);
  const revoke = cancellation(original),
    receipt = await f.store.retainSmartAccountAuthorization(session, revoke);
  const retried = {
    ...revoke,
    userOperation: {
      ...revoke.userOperation,
      signature: new Wallet(`0x${'55'.repeat(32)}`).signingKey.sign(
        getSmartAccountUserOpHash(revoke.userOperation, revoke.chainId)
      ).serialized,
    },
  };
  const reopened = new EvmSignedRecords(f.port);
  const resolved = await reopened.retainSmartAccountAuthorization(session, retried);
  assert.equal(resolved.operationHash, receipt.operationHash);
  assert.equal(f.writes(), 2, 'retry does not rewrite the first usable proof');
  assert.deepEqual(
    resolveSmartAccountAuthorization(resolved, retried, session.assertCurrent),
    revoke.userOperation
  );
  assert.throws(() =>
    resolveSmartAccountAuthorization({ ...resolved }, retried, session.assertCurrent)
  , /AUTHORIZATION_REQUIRED/);
  assert.throws(() =>
    resolveSmartAccountAuthorization(resolved, { ...retried, payer: account }, session.assertCurrent)
  , /AUTHORIZATION_CHANGED/);
  f.revoke();
  assert.throws(() =>
    resolveSmartAccountAuthorization(resolved, retried, () => undefined)
  , /revoked/);
});

async function outer(
  nonce = 0,
  transaction: {
    data?: string;
    gasLimit?: number;
    to?: string;
    value?: number;
  } = {},
  chainId = 1
) {
  const rawTransaction = await owner.signTransaction({
    type: 2,
    chainId,
    nonce,
    to: owner.address,
    value: 1,
    gasLimit: 21000,
    maxFeePerGas: 3,
    maxPriorityFeePerGas: 1,
    ...transaction,
  });
  return {
    rawTransaction,
    hash: Transaction.from(rawTransaction).hash!,
    chainId: String(chainId),
    from: owner.address,
    nonce,
    type: 2,
    context: {
      account: { type: 'HDAccount', id: 0, address: owner.address },
      network: {
        kind: 'ethereum',
        chainId,
        slip44: 60,
        url: 'https://offline.invalid',
      },
      operation: 'send' as const,
    },
  };
}

async function rewriteRoot(
  f: ReturnType<typeof fixture>,
  change: (root: Record<string, any>, bundle: any) => void
) {
  const bundle = JSON.parse(f.value()!);
  const plaintext = await f.keyring.decryptPrivateRecord({
    domain: rootDomain,
    recordId: 'manifest',
    envelope: bundle.root,
  });
  try {
    const root = JSON.parse(new TextDecoder().decode(plaintext));
    change(root, bundle);
    bundle.root = await f.keyring.encryptPrivateRecord({
      domain: rootDomain,
      recordId: 'manifest',
      plaintext: new TextEncoder().encode(JSON.stringify(root)),
    });
    f.replace(JSON.stringify(bundle));
  } finally {
    plaintext.fill(0);
  }
}

test('authorization is durably encrypted, idempotent and independently recoverable after restart', async () => {
  const f = fixture(),
    input = authorization(),
    session = f.session();
  const receipt = await f.store.retainSmartAccountAuthorization(session, input);
  assert.equal(
    receipt.operationHash,
    getSmartAccountUserOpHash(input.userOperation, input.chainId)
  );
  assert.deepEqual(Object.keys(receipt), ['operationHash']);
  assert.equal(Object.isFrozen(receipt), true);
  assert.doesNotThrow(() =>
    assertSmartAccountAuthorizationReceipt(
      receipt,
      input,
      session.assertCurrent
    )
  );
  const stored = f.value()!;
  assert(
    !stored.includes(input.userOperation.signature),
    'signature never appears as unencrypted storage metadata'
  );
  const profile = await f.keyring.getPrivateRecordProfileId();
  assert.equal(inspectEvmSignedBundle(stored, profile).transactions, 1);
  const reopened = new EvmSignedRecords(f.port, () => 2000);
  const duplicate = await reopened.retainSmartAccountAuthorization(
    f.session(),
    { ...input, observedAt: { number: '101', hash: blockHash } }
  );
  assert.equal(duplicate.operationHash, receipt.operationHash);
  assert.equal(
    f.writes(),
    1,
    'an identical instruction does not rewrite or reset its first observation'
  );
  const exact = await reopened.readSmartAccountAuthorizationExact(
    f.session(),
    '1',
    account,
    receipt.operationHash
  );
  assert.deepEqual(exact?.userOperation, { ...input.userOperation, signature: '0x' });
  assert.ok(exact?.signatureDigest);
  assert.equal(exact?.createdAt, 1000);
  assert.equal(exact?.observedAt.number, '100');
  assert.equal(
    await reopened.readExact(f.session(), '1', account, receipt.operationHash),
    null,
    'an inner authorization is not an outer transaction'
  );
  assert.equal(
    await reopened.readSmartAccountAuthorizationExact(
      f.session(),
      '2',
      account,
      receipt.operationHash
    ),
    null
  );
  assert.equal(
    await reopened.readSmartAccountAuthorizationExact(
      f.session(),
      '1',
      owner.address,
      receipt.operationHash
    ),
    null
  );
});

test('authenticated legacy proof is validated read-only and converted once without changing its nonce or receipt binding', async () => {
  const f = fixture(), input = authorization(), session = f.session();
  const native = await outer();
  await f.store.append(session, native);
  const { operationHash } = await f.store.retainSmartAccountAuthorization(session, input);
  const encoder = new TextEncoder();
  const legacy = captureSignedSmartAccountOperation(input.userOperation);
  const part = await f.keyring.encryptPrivateRecord({
    domain: 'org.syscoin.pali.evm.signed.chunk.v1',
    recordId: `authorization/${operationHash}/0`,
    plaintext: encoder.encode(JSON.stringify(legacy)),
  });
  await rewriteRoot(f, (root, bundle) => {
    bundle.authorizations[0].chunks = [part];
    root.authorizationsHash = sha256(encoder.encode(JSON.stringify(bundle.authorizations)));
  });
  const reopened = new EvmSignedRecords(f.port);
  const before = f.value();
  assert.equal(await reopened.validate(session), 2);
  assert.equal(f.value(), before);
  assert.equal(await reopened.migrateUnsignedNative(session, { nativeEoa: false }), 1);
  assert.equal(await reopened.migrateUnsignedNative(session, { nativeEoa: false }), 0);
  assert.equal(await reopened.validate(session), 2);
  assert.equal((await reopened.readExact(session, native.chainId, native.from, native.hash))?.rawTransaction, native.rawTransaction);
  const record = await reopened.readSmartAccountAuthorizationExact(session, '1', account, operationHash);
  assert.equal(record?.userOperation.signature, '0x');
  assert.equal(record?.signatureDigest, keccak256(input.userOperation.signature));
  assert.equal(record?.operationNonce, input.userOperation.nonce);
  assertSmartAccountAuthorizationReceipt(await reopened.retainSmartAccountAuthorization(session, input), input, session.assertCurrent);
  await assert.rejects(reopened.retainSmartAccountAuthorization(session, {
    ...input, userOperation: { ...input.userOperation, signature: '0x1234' },
  }), /AUTHORIZATION_CONFLICT/);
});

test('summary pagination is bounded, scoped and excludes signature bytes and outer identities', async () => {
  const f = fixture(),
    hashes: string[] = [];
  for (let i = 0; i < 3; i++)
    hashes.push(
      (
        await f.store.retainSmartAccountAuthorization(
          f.session(),
          authorization(i)
        )
      ).operationHash
    );
  await f.store.retainSmartAccountAuthorization(
    f.session(),
    authorization(0, 2)
  );
  const latest = await f.store.listSmartAccountAuthorizations(
    f.session(),
    '1',
    account,
    { maximum: 2 }
  );
  assert.deepEqual(
    latest.entries.map((row) => row.operationHash),
    [hashes[2], hashes[1]]
  );
  assert.equal(latest.nextCursor, hashes[1]);
  for (const row of latest.entries) {
    assert.deepEqual(
      Object.keys(row).sort(),
      [
        'account',
        'chainId',
        'createdAt',
        'observedAt',
        'operationHash',
        'operationNonce',
        'payer',
      ].sort()
    );
  }
  const previous = await f.store.listSmartAccountAuthorizations(
    f.session(),
    '1',
    account,
    { maximum: 2, beforeHash: latest.nextCursor! }
  );
  assert.deepEqual(
    previous.entries.map((row) => row.operationHash),
    [hashes[0]]
  );
  assert.equal(previous.nextCursor, null);
  for (const maximum of [0, 101, 1.5])
    await assert.rejects(async () =>
      f.store.listSmartAccountAuthorizations(f.session(), '1', account, {
        maximum,
      })
    );
  await assert.rejects(
    f.store.listSmartAccountAuthorizations(f.session(), '1', account, {
      maximum: 1,
      beforeHash: `0x${'55'.repeat(32)}`,
    })
  );
});

test('all four existing bundle writers preserve unrelated retained authorizations', async () => {
  const f = fixture(),
    input = authorization();
  const { operationHash } = await f.store.retainSmartAccountAuthorization(
    f.session(),
    input
  );
  const preserved = async () =>
    assert.deepEqual(
      (
        await f.store.readSmartAccountAuthorizationExact(
          f.session(),
          '1',
          account,
          operationHash
        )
      )?.userOperation,
      { ...input.userOperation, signature: '0x' }
    );
  const tx = await outer();
  await f.store.append(f.session(), tx);
  await preserved();
  await f.store.updatePhase(
    f.session(),
    '1',
    owner.address,
    tx.hash,
    'confirmed'
  );
  await preserved();
  const block = {
    number: '0x64',
    hash: blockHash,
    gasLimit: '0x100000',
    transactions: [tx.hash],
  };
  const read = async (method: string) => {
    if (method === 'eth_chainId') return '0x1';
    if (method === 'eth_getTransactionReceipt')
      return {
        transactionHash: tx.hash,
        from: owner.address,
        to: owner.address,
        status: '0x1',
        blockNumber: block.number,
        blockHash,
        transactionIndex: '0x0',
      };
    if (method === 'eth_getBlockByNumber') return block;
    if (method === 'eth_getTransactionCount') return '0x1';
    throw new Error(`Unexpected method ${method}`);
  };
  assert.equal(
    await f.store.retireFinalized(
      f.session(),
      { chainId: '1', from: owner.address },
      read,
      { removed: 0 }
    ),
    1
  );
  await preserved();
  assert.equal(
    await f.store.readExact(f.session(), '1', owner.address, tx.hash),
    null
  );
  await f.store.clearScope(f.session(), {
    chainId: '1',
    from: owner.address,
    profileId: await f.keyring.getPrivateRecordProfileId(),
  });
  await preserved();
});

test('explicit account reset removes only its own authorization and retires old receipt capabilities', async () => {
  const f = fixture(),
    input = authorization(),
    other = authorization(0, 2),
    session = f.session();
  const receipt = await f.store.retainSmartAccountAuthorization(session, input);
  const otherReceipt = await f.store.retainSmartAccountAuthorization(
    f.session(),
    other
  );
  const pending = await f.store.captureSmartAccountPendingRecords(
    f.session(),
    '1',
    account
  );
  const allowed = pending.forAuthorization!(receipt);
  assert.deepEqual(await allowed.readAuthorizations!(true), []);
  await f.store.clearScope(f.session(), {
    chainId: '1',
    from: account,
    profileId: await f.keyring.getPrivateRecordProfileId(),
  });
  assert.throws(
    () =>
      assertSmartAccountAuthorizationReceipt(receipt, input, () => undefined),
    /CONTEXT_CHANGED/
  );
  await assert.rejects(allowed.readAuthorizations!(true), /CONTEXT_CHANGED/);
  assert.equal(
    await f.store.readSmartAccountAuthorizationExact(
      f.session(),
      '1',
      account,
      receipt.operationHash
    ),
    null
  );
  assert.deepEqual(
    (
      await f.store.readSmartAccountAuthorizationExact(
        f.session(),
        '2',
        account,
        otherReceipt.operationHash
      )
    )?.userOperation,
    { ...other.userOperation, signature: '0x' }
  );
});

test('Smart reset releases scoped payer nonces and preserves unrelated signed records and floors', async () => {
  const f = fixture();
  const otherAccount = `0x${'55'.repeat(20)}`;
  const selected = authorization();
  const other = authorization(0, 1, otherAccount);
  const otherChain = authorization(0, 2);
  const handleOps = (
    nonce: number,
    ...inputs: ReturnType<typeof authorization>[]
  ) => {
    const chainId = inputs[0]!.chainId;
    return outer(
      nonce,
      {
        data: paliEntryPointInterface.encodeFunctionData('handleOps', [
          inputs.map((input) => input.userOperation),
          owner.address,
        ]),
        gasLimit: 100_000,
        to: getPaliEntryPointAddress(chainId),
        value: 0,
      },
      chainId
    );
  };
  const ownOuter = await handleOps(7, selected);
  const ownPrefund = await outer(8, { to: account });
  const otherOuter = await handleOps(9, other);
  const mixedOuter = await handleOps(10, authorization(1), other);
  const ordinaryPayment = await outer(11, { to: account });
  const mismatchedPrefund = await outer(12);
  const sameAccountOtherChain = await handleOps(7, otherChain);
  const marker = {
    smartAccountAddress: account,
    smartAccountDeploymentPrefund: true,
  };
  for (const tx of [
    ownOuter,
    otherOuter,
    mixedOuter,
    ordinaryPayment,
    sameAccountOtherChain,
  ])
    await f.store.append(f.session(), tx);
  for (const tx of [ownPrefund, mismatchedPrefund])
    await f.store.append(f.session(), tx, marker);
  const ownReceipt = await f.store.retainSmartAccountAuthorization(
    f.session(),
    selected
  );
  const otherReceipt = await f.store.retainSmartAccountAuthorization(
    f.session(),
    other
  );
  await f.store.updatePhase(
    f.session(),
    '1',
    owner.address,
    ownOuter.hash,
    'confirmed'
  );
  await rewriteRoot(f, (root) => {
    root.nonceFloors = [
      { chainId: '1', from: owner.address.toLowerCase(), nonce: 7 },
    ];
  });
  for (const tx of [ownOuter, ownPrefund])
    await assert.rejects(
      f.store.assertSpendingNonce(f.session(), tx.chainId, tx.from, tx.nonce),
      /EVM_SIGNED_RECORD_NONCE_CONFLICT/
    );
  assert.equal(
    await f.store.clearScope(f.session(), {
      chainId: '1',
      from: account,
      profileId: await f.keyring.getPrivateRecordProfileId(),
      smartAccount: true,
    }),
    3
  );
  const reopened = new EvmSignedRecords(f.port);
  for (const tx of [ownOuter, ownPrefund]) {
    assert.equal(
      await reopened.readExact(f.session(), tx.chainId, tx.from, tx.hash),
      null
    );
    await reopened.assertSpendingNonce(
      f.session(),
      tx.chainId,
      tx.from,
      tx.nonce
    );
  }
  assert.equal(
    await reopened.readSmartAccountAuthorizationExact(
      f.session(),
      '1',
      account,
      ownReceipt.operationHash
    ),
    null
  );
  for (const tx of [
    otherOuter,
    mixedOuter,
    ordinaryPayment,
    mismatchedPrefund,
    sameAccountOtherChain,
  ]) {
    const retained = await reopened.readExact(
      f.session(),
      tx.chainId,
      tx.from,
      tx.hash
    );
    assert.equal(retained?.rawTransaction, tx.rawTransaction);
  }
  const otherAuthorization = await reopened.readSmartAccountAuthorizationExact(
    f.session(),
    '1',
    otherAccount,
    otherReceipt.operationHash
  );
  assert.equal(otherAuthorization?.account, otherAccount);
  const payerNonces = await reopened.captureAutoNonceSnapshot(
    f.session(),
    '1',
    owner.address
  );
  assert.equal(payerNonces.minimumNonce, 7);
});

test('a CAS retry preserves a concurrent outer append and acknowledges only committed authorization', async () => {
  const f = fixture(),
    other = new EvmSignedRecords({ ...f.port }),
    tx = await outer(),
    commit = f.port.compareAndSet;
  let calls = 0;
  f.port.compareAndSet = async (...args) => {
    calls++;
    if (calls === 1) {
      await other.append(f.session(), tx);
      return false;
    }
    return commit(...args);
  };
  const input = authorization(),
    receipt = await f.store.retainSmartAccountAuthorization(f.session(), input);
  assert.equal(calls, 2);
  assert.equal(f.writes(), 2);
  assert.deepEqual(
    (
      await f.store.readSmartAccountAuthorizationExact(
        f.session(),
        '1',
        account,
        receipt.operationHash
      )
    )?.userOperation,
    { ...input.userOperation, signature: '0x' }
  );
  assert.equal(
    (await f.store.readExact(f.session(), '1', owner.address, tx.hash))
      ?.rawTransaction,
    tx.rawTransaction
  );
});

test('a CAS loser rechecks a concurrently retained instruction at the same inner nonce', async () => {
  const f = fixture(),
    other = new EvmSignedRecords({ ...f.port });
  const winner = authorization(),
    loser = {
      ...winner,
      userOperation: { ...winner.userOperation, callData: '0x5678' },
    };
  loser.userOperation.signature = owner.signingKey.sign(
    getSmartAccountUserOpHash(loser.userOperation, 1)
  ).serialized;
  const commit = f.port.compareAndSet;
  f.port.compareAndSet = async (...args) => {
    f.port.compareAndSet = commit;
    await other.retainSmartAccountAuthorization(f.session(), winner);
    return commit(...args);
  };
  await assert.rejects(
    f.store.retainSmartAccountAuthorization(f.session(), loser),
    /AUTHORIZATION_CONFLICT/
  );
  assert.equal(f.writes(), 1);
  assert.deepEqual(
    (
      await f.store.listSmartAccountAuthorizations(f.session(), '1', account, {
        maximum: 10,
      })
    ).entries.map((row) => row.operationHash),
    [getSmartAccountUserOpHash(winner.userOperation, 1)]
  );
  assert.equal(
    await f.store.readSmartAccountAuthorizationExact(
      f.session(),
      '1',
      account,
      getSmartAccountUserOpHash(loser.userOperation, 1)
    ),
    null
  );
});

for (const failure of ['cas', 'write', 'read', 'revoked'] as const) {
  test(`${failure} failure issues no usable receipt or subsequent external disclosure`, async () => {
    const f = fixture(),
      input = authorization();
    await f.store.retainSmartAccountAuthorization(
      f.session(),
      authorization(1)
    );
    const saved = f.value(),
      session = f.session();
    let attempts = 0,
      external = 0;
    if (failure === 'read')
      f.port.read = async () => {
        throw new Error('Storage unavailable');
      };
    else
      f.port.compareAndSet = async (_id, _before, _next, check) => {
        attempts++;
        if (failure === 'revoked') {
          f.revoke();
          check();
        }
        if (failure === 'write') throw new Error('Storage unavailable');
        return false;
      };
    await assert.rejects(
      (async () => {
        const receipt = await f.store.retainSmartAccountAuthorization(
          session,
          input
        );
        assertSmartAccountAuthorizationReceipt(
          receipt,
          input,
          session.assertCurrent
        );
        external++;
      })()
    );
    assert.equal(external, 0);
    assert.equal(f.value(), saved);
    assert.equal(f.writes(), 1);
    if (failure === 'cas')
      assert.equal(attempts, 3, 'CAS conflict has a finite retry budget');
  });
}

test('receipt requires exact signed bytes, payer, chain and both live owner capabilities', async () => {
  const f = fixture(),
    input = authorization(),
    session = f.session();
  const receipt = await f.store.retainSmartAccountAuthorization(session, input);
  for (const changed of [
    { ...input, chainId: 2 },
    { ...input, payer: account },
    { ...input, userOperation: { ...input.userOperation, signature: '0x00' } },
    { ...input, userOperation: authorization(1).userOperation },
  ])
    assert.throws(
      () =>
        assertSmartAccountAuthorizationReceipt(
          receipt,
          changed,
          session.assertCurrent
        ),
      /AUTHORIZATION_CHANGED/
    );
  assert.throws(
    () =>
      assertSmartAccountAuthorizationReceipt(
        { ...receipt },
        input,
        session.assertCurrent
      ),
    /AUTHORIZATION_REQUIRED/
  );
  assert.throws(
    () =>
      assertSmartAccountAuthorizationReceipt(receipt, input, () => {
        throw new Error('caller retired');
      }),
    /caller retired/
  );
  f.revoke();
  assert.throws(
    () =>
      assertSmartAccountAuthorizationReceipt(receipt, input, () => undefined),
    /revoked/
  );
});

test('pending-view exceptions are opaque, same-storage/profile scoped and limited to current exact instructions', async () => {
  const f = fixture(),
    inputs = [authorization(0), authorization(1), authorization(2)];
  const receipts: SmartAccountAuthorizationReceipt[] = [];
  for (const input of inputs)
    receipts.push(
      await f.store.retainSmartAccountAuthorization(f.session(), input)
    );
  const view = await f.store.captureSmartAccountPendingRecords(
    f.session(),
    '1',
    account
  );
  assert.equal((await view.readAuthorizations!(true)).length, 3);
  const first = view.forAuthorization!(receipts[0]!);
  assert.deepEqual(
    (await first.readAuthorizations!(true)).map((row) => row.operationHash),
    receipts.slice(1).map((row) => row.operationHash)
  );
  const second = first.forAuthorization!(receipts[1]!);
  assert.deepEqual(
    (await second.readAuthorizations!(true)).map((row) => row.operationHash),
    [receipts[2]!.operationHash]
  );
  assert.throws(
    () => second.forAuthorization!(receipts[2]!),
    /AUTHORIZATION_CHANGED/
  );
  assert.throws(
    () => view.forAuthorization!({ ...receipts[0]! }),
    /AUTHORIZATION_CHANGED/
  );
  const otherStorage = new EvmSignedRecords({ ...f.port });
  const foreignStorageView =
    await otherStorage.captureSmartAccountPendingRecords(
      f.session(),
      '1',
      account
    );
  assert.throws(
    () => foreignStorageView.forAuthorization!(receipts[0]!),
    /AUTHORIZATION_CHANGED/
  );
  const foreignProfile = fixture();
  foreignProfile.keyring.getDecryptedMnemonic = () =>
    'a different synthetic profile';
  const foreignView =
    await foreignProfile.store.captureSmartAccountPendingRecords(
      foreignProfile.session(),
      '1',
      account
    );
  assert.throws(
    () => foreignView.forAuthorization!(receipts[0]!),
    /AUTHORIZATION_CHANGED/
  );
  const foreignAccount = await f.store.captureSmartAccountPendingRecords(
    f.session(),
    '1',
    owner.address
  );
  assert.throws(
    () => foreignAccount.forAuthorization!(receipts[0]!),
    /AUTHORIZATION_CHANGED/
  );
  const foreignChain = await f.store.captureSmartAccountPendingRecords(
    f.session(),
    '2',
    account
  );
  assert.throws(
    () => foreignChain.forAuthorization!(receipts[0]!),
    /AUTHORIZATION_CHANGED/
  );
});

test('same nonce refuses a different authorization except the one canonical retained cancellation', async () => {
  const f = fixture(),
    original = authorization();
  const receipt = await f.store.retainSmartAccountAuthorization(
    f.session(),
    original
  );
  const changed = {
    ...original,
    userOperation: { ...original.userOperation, callData: '0x5678' },
  };
  changed.userOperation.signature = owner.signingKey.sign(
    getSmartAccountUserOpHash(changed.userOperation, 1)
  ).serialized;
  await assert.rejects(
    f.store.retainSmartAccountAuthorization(f.session(), changed),
    /AUTHORIZATION_CONFLICT/
  );
  await assert.rejects(
    f.store.retainSmartAccountAuthorization(f.session(), {
      ...original,
      payer: account,
    }),
    /AUTHORIZATION_CONFLICT/
  );
  await assert.rejects(
    f.store.retainSmartAccountAuthorization(f.session(), {
      ...original,
      userOperation: { ...original.userOperation, signature: '0x00' },
    }),
    /AUTHORIZATION_CONFLICT/
  );
  const revoke = cancellation(original);
  const replacement = await f.store.retainSmartAccountAuthorization(
    f.session(),
    revoke
  );
  assert.equal(
    (
      await f.store.readSmartAccountAuthorizationExact(
        f.session(),
        '1',
        account,
        replacement.operationHash
      )
    )?.replacesOperationHash,
    receipt.operationHash
  );
  assert.deepEqual(
    (
      await f.store.readSmartAccountAuthorizationExact(
        f.session(),
        '1',
        account,
        receipt.operationHash
      )
    )?.userOperation,
    { ...original.userOperation, signature: '0x' }
  );
  const other = fixture();
  await assert.rejects(
    other.store.retainSmartAccountAuthorization(other.session(), revoke),
    /AUTHORIZATION_CONFLICT/
  );
  assert.equal(
    other.writes(),
    0,
    'an unretained original cannot be nominated by the caller'
  );
});

for (const attack of [
  'missing-count',
  'missing-digest',
  'missing-pair',
  'wrong-count',
  'wrong-digest',
  'missing-array',
  'changed-summary',
  'changed-ciphertext',
] as const) {
  test(`authenticated authorization manifest rejects ${attack} without rewriting or clearing records`, async () => {
    const f = fixture(),
      input = authorization();
    await f.store.retainSmartAccountAuthorization(f.session(), input);
    await rewriteRoot(f, (root, bundle) => {
      if (attack === 'missing-count' || attack === 'missing-pair')
        delete root.authorizations;
      if (attack === 'missing-digest' || attack === 'missing-pair')
        delete root.authorizationsHash;
      if (attack === 'wrong-count') root.authorizations++;
      if (attack === 'wrong-digest')
        root.authorizationsHash = `0x${'00'.repeat(32)}`;
      if (attack === 'missing-array') delete bundle.authorizations;
      if (attack === 'changed-summary')
        bundle.authorizations[0].operationNonce = '0';
      if (attack === 'changed-ciphertext') {
        const chunk = bundle.authorizations[0].chunks[0];
        const bytes = Buffer.from(chunk.ciphertext, 'base64');
        bytes[0] = bytes[0]! ^ 1;
        chunk.ciphertext = bytes.toString('base64');
      }
    });
    const corrupt = f.value();
    await assert.rejects(f.store.validate(f.session()));
    await assert.rejects(
      f.store.retainSmartAccountAuthorization(f.session(), authorization(1))
    );
    assert.equal(f.value(), corrupt);
    assert.equal(f.writes(), 1);
  });
}

test('a different unlocked profile cannot read or overwrite the retained authorization bundle', async () => {
  const original = fixture(),
    input = authorization();
  await original.store.retainSmartAccountAuthorization(
    original.session(),
    input
  );
  const different = fixture();
  different.keyring.getDecryptedMnemonic = () =>
    'a different synthetic profile';
  different.replace(original.value());
  const before = different.value();
  await assert.rejects(
    different.store.readSmartAccountAuthorizationExact(
      different.session(),
      '1',
      account,
      getSmartAccountUserOpHash(input.userOperation, 1)
    )
  );
  await assert.rejects(
    different.store.retainSmartAccountAuthorization(different.session(), input)
  );
  assert.equal(different.value(), before);
  assert.equal(different.writes(), 0);
});
