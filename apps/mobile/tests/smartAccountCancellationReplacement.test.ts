import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import test from 'node:test';
import { Transaction, Wallet } from 'ethers';
import { SoftwareKeyring } from '@sidhujag/sysweb3-keyring/cjs/software.js';
import {
  captureEvmSubmission,
  submitSignedEvmTransaction,
} from '@sidhujag/sysweb3-keyring/cjs/transactions/evm-submission.js';
import {
  EvmSignedRecords,
  createEvmSignedRecordLifecycle,
  isEvmVerifiedSmartAccountReplacement,
  assertEvmVerifiedSmartAccountReplacement,
  type EvmSignedRecordSession,
  type EvmSignedRecordStorage,
} from '../../../source/wallet/evmSignedRecords.ts';
import {
  buildSmartAccountUserOperation,
  encodeERC7579Executions,
  encodeSmartAccountValidatorNonceKey,
  type SmartAccountPackedUserOperation,
} from '../../../source/utils/smartAccount/account.ts';
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
const owner = new Wallet(`0x${'11'.repeat(32)}`),
  account = `0x${'22'.repeat(20)}`,
  recipient = `0x${'33'.repeat(20)}`;
const blockHash = `0x${'44'.repeat(32)}`,
  entryPoint = getPaliEntryPointAddress(1);
const context = {
  account: { type: 'HDAccount', id: 0, address: owner.address },
  network: {
    kind: 'ethereum',
    chainId: 1,
    slip44: 60,
    url: 'https://offline.invalid',
  },
  operation: 'send' as const,
};
function operation(revoke = false) {
  const call = encodeERC7579Executions([
    {
      target: revoke ? account : recipient,
      value: revoke ? '0x0' : '0x1',
      data: '0x',
    },
  ]);
  const op = buildSmartAccountUserOperation({
    sender: account,
    nonce: (
      (BigInt(encodeSmartAccountValidatorNonceKey(recipient)) << BigInt(64)) +
      BigInt(7)
    ).toString(),
    callData: paliSmartAccountInterface.encodeFunctionData('execute', [
      call.mode,
      call.executionCalldata,
    ]),
  });
  op.signature = owner.signingKey.sign(
    getSmartAccountUserOpHash(op, 1)
  ).serialized;
  return op;
}
async function envelope(
  op: SmartAccountPackedUserOperation,
  legacy = false,
  overrides: Record<string, any> = {}
) {
  const rawTransaction = await owner.signTransaction({
    type: legacy ? 0 : 2,
    chainId: 1,
    nonce: 5,
    to: entryPoint,
    value: 0,
    data: paliEntryPointInterface.encodeFunctionData('handleOps', [
      [op],
      owner.address,
    ]),
    gasLimit: 600000,
    ...(legacy
      ? { gasPrice: 120 }
      : { maxFeePerGas: 120, maxPriorityFeePerGas: 12 }),
    ...overrides,
  });
  const tx = Transaction.from(rawTransaction);
  return {
    rawTransaction,
    hash: tx.hash!,
    type: tx.type!,
    chainId: '1',
    from: owner.address,
    nonce: tx.nonce,
    context,
  };
}
async function fixture(
  legacy = false,
  metadata?: Readonly<Record<string, unknown>>
) {
  const keyring: any = Object.create(SoftwareKeyring.prototype);
  Object.assign(keyring, {
    sessionPassword: { isCleared: () => false },
    sessionMnemonic: { isCleared: () => false },
    privateRecordSessionRevision: 0,
    getDecryptedMnemonic: () => 'synthetic shared signed-record root',
  });
  let stored: string | undefined,
    revision = 0,
    writes = 0;
  const port: EvmSignedRecordStorage = {
    async read() {
      return stored;
    },
    async compareAndSet(_id, before, next, guard) {
      guard();
      if (stored !== before) return false;
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
        if (captured !== revision) throw Error('revoked');
      },
    };
  };
  const store = new EvmSignedRecords(port, () => 1000),
    originalOperation = operation(),
    revocation = operation(true);
  const original = await envelope(
    originalOperation,
    legacy,
    legacy ? { gasPrice: 100 } : { maxFeePerGas: 100, maxPriorityFeePerGas: 10 }
  );
  await store.append(session(), original, metadata);
  const retain = (op = revocation) =>
    store.retainSmartAccountAuthorization(session(), {
      chainId: 1,
      userOperation: op,
      payer: owner.address,
      observedAt: { number: '100', hash: blockHash },
      replacesOperationHash: getSmartAccountUserOpHash(originalOperation, 1),
    });
  const capture = (op = revocation) =>
    store.captureSmartAccountCancellationReplacement(session(), {
      chainId: 1,
      originalHash: original.hash,
      newUserOperation: op,
      payer: owner.address,
    });
  return {
    store,
    port,
    keyring,
    session,
    original,
    originalOperation,
    revocation,
    retain,
    capture,
    value: () => stored,
    writes: () => writes,
    revoke() {
      revision++;
    },
  };
}

test('authorization outer lookup decodes only matching authenticated hints and survives restart', async () => {
  const operationHash = getSmartAccountUserOpHash(operation(), 1);
  const f = await fixture(false, {
    smartAccountExecution: true,
    smartAccountExecutionFrom: account,
    smartAccountOperationHash: operationHash,
  });
  const reopened = new EvmSignedRecords(f.port);
  const found = await reopened.findSmartAccountAuthorizationOuter(
    f.session(), '1', account, operationHash
  );
  assert.equal(found?.entry.hash, f.original.hash);
  assert.equal(found?.operations[0]?.operationHash, operationHash);
  assert.equal(await reopened.findSmartAccountAuthorizationOuter(
    f.session(), '2', account, operationHash
  ), null);
  assert.equal(await reopened.findSmartAccountAuthorizationOuter(
    f.session(), '1', owner.address, operationHash
  ), null);
  assert.equal(await reopened.findSmartAccountAuthorizationOuter(
    f.session(), '1', account, `0x${'ff'.repeat(32)}`
  ), null);
});

for (const legacy of [false, true])
  test(`real SDK send lifecycle retains and dispatches exact Smart revocation at same outer nonce (${
    legacy ? 'legacy' : '1559'
  })`, async () => {
    const f = await fixture(legacy),
      receipt = await f.retain(),
      binding = await f.capture();
    assert.equal(isEvmVerifiedSmartAccountReplacement(binding), true);
    assert.equal(isEvmVerifiedSmartAccountReplacement({ ...binding }), false);
    assert.doesNotThrow(() =>
      assertEvmVerifiedSmartAccountReplacement(binding)
    );
    assert.equal(binding.nonce, 5);
    const replacement = await envelope(f.revocation, legacy),
      session = f.session();
    let wires = 0,
      preflight = 0;
    // Capture before admission obtains the storage queue, matching the real host.
    const pending = (
      await f.store.captureSmartAccountPendingRecords(f.session(), '1', account)
    ).forAuthorization!(receipt);
    const heldLifecycle = createEvmSignedRecordLifecycle(f.store, session, {
      retirementReadForChain: null,
      replacement: binding,
      async preflight(_record, guard, snapshot) {
        guard();
        preflight++;
        const authorizations = await snapshot.readSmartAccountAuthorizations!(
          '1',
          account
        );
        assert.deepEqual(
          pending.filterPendingAuthorizations!(authorizations).map(
            (row) => row.operationHash
          ),
          [getSmartAccountUserOpHash(f.originalOperation, 1)]
        );
      },
    });
    const boundary = captureEvmSubmission(
      context,
      session.assertCurrent,
      () => heldLifecycle
    );
    assert.equal(
      await submitSignedEvmTransaction(
        replacement.rawTransaction,
        ({ admit }) =>
          admit(async () => {
            wires++;
            const stored = JSON.parse(f.value()!);
            assert.equal(stored.entries.at(-1).originalHash, f.original.hash);
            assert.equal(stored.entries.at(-1).operation, 'send');
            return replacement.hash;
          }),
        boundary,
        undefined,
        Transaction.from(replacement.rawTransaction).unsignedSerialized
      ),
      replacement.hash
    );
    assert.equal(wires, 1);
    assert.equal(preflight, 1);
    const saved = await f.store.readExact(
      f.session(),
      '1',
      owner.address,
      replacement.hash
    );
    assert.equal(saved?.originalHash, f.original.hash);
    assert.deepEqual(saved?.metadata?.smartAccountOperationCancellation, {
      account,
      chainId: '1',
      originalHash: f.original.hash,
      originalKind: 'transaction',
      originalOperationHash: getSmartAccountUserOpHash(f.originalOperation, 1),
      operationHash: getSmartAccountUserOpHash(f.revocation, 1),
      operationNonce: f.revocation.nonce,
    });
    await f.store.updatePhase(
      f.session(),
      '1',
      owner.address,
      replacement.hash,
      'confirmed'
    );
    assert.equal(
      (
        await f.store.readExact(
          f.session(),
          '1',
          owner.address,
          f.original.hash
        )
      )?.phase,
      'signed',
      'an outer receipt alone never invents success or cancellation of either inner operation'
    );
  });

test('a cloned, wrong-profile, retired or reset replacement permission cannot bypass ordinary nonce ownership', async () => {
  for (const kind of ['clone', 'profile', 'retired', 'reset'] as const) {
    const f = await fixture(),
      binding = await f.capture(),
      signed = await envelope(f.revocation);
    if (kind === 'retired') f.revoke();
    if (kind === 'reset')
      await f.store.clearScope(f.session(), {
        chainId: '1',
        from: owner.address,
        profileId: await f.keyring.getPrivateRecordProfileId(),
      });
    if (kind === 'profile')
      f.keyring.getDecryptedMnemonic = () => 'different synthetic profile';
    const before = f.value(),
      writes = f.writes();
    await assert.rejects(async () =>
      f.store.append(
        f.session(),
        signed,
        undefined,
        kind === 'clone' ? { ...binding } : binding
      )
    );
    assert.equal(f.value(), before);
    assert.equal(f.writes(), writes);
  }
});

for (const change of [
  'sender',
  'nonce',
  'paymaster',
  'not-noop',
  'unsigned',
] as const)
  test(`refuses cancellation capability for altered inner ${change}`, async () => {
    const f = await fixture(),
      op = { ...f.revocation };
    if (change === 'sender') op.sender = recipient;
    if (change === 'nonce')
      op.nonce = (BigInt(op.nonce) + BigInt(1)).toString();
    if (change === 'paymaster') op.paymasterAndData = '0x1234';
    if (change === 'not-noop') op.callData = f.originalOperation.callData;
    if (change === 'unsigned') op.signature = '0x';
    await assert.rejects(async () => f.capture(op));
    assert.equal(f.writes(), 1);
  });

for (const change of [
  'nonce',
  'to',
  'value',
  'calldata',
  'beneficiary',
  'fee',
  'priority',
  'type',
  'signature',
] as const)
  test(`same-outer permission rejects altered signed ${change}`, async () => {
    const f = await fixture(),
      binding = await f.capture();
    const overrides: Record<string, any> = {};
    if (change === 'nonce') overrides.nonce = 6;
    if (change === 'to') overrides.to = owner.address;
    if (change === 'value') overrides.value = 1;
    if (change === 'calldata') overrides.data = '0x';
    if (change === 'beneficiary')
      overrides.data = paliEntryPointInterface.encodeFunctionData('handleOps', [
        [f.revocation],
        recipient,
      ]);
    if (change === 'fee') overrides.maxFeePerGas = 119;
    if (change === 'priority') overrides.maxPriorityFeePerGas = 11;
    if (change === 'type') {
      overrides.type = 0;
      overrides.gasPrice = 120;
      overrides.maxFeePerGas = null;
      overrides.maxPriorityFeePerGas = null;
    }
    const op =
      change === 'signature'
        ? { ...f.revocation, signature: '0x00' }
        : f.revocation;
    const replacement = await envelope(op, false, overrides),
      before = f.value();
    await assert.rejects(
      f.store.append(f.session(), replacement, undefined, binding)
    );
    assert.equal(f.value(), before);
    assert.equal(f.writes(), 1);
  });

test('concurrent journal tip and terminal-state changes retire the issued replacement permission', async () => {
  for (const change of ['tip', 'terminal'] as const) {
    const f = await fixture(),
      binding = await f.capture(),
      replacement = await envelope(f.revocation);
    if (change === 'terminal')
      await f.store.updatePhase(
        f.session(),
        '1',
        owner.address,
        f.original.hash,
        'confirmed'
      );
    else {
      const ordinary = await f.store.captureVerifiedReplacement(f.session(), {
        chainId: '1',
        from: owner.address,
        nonce: 5,
        originalHash: f.original.hash,
        operation: 'speed-up',
      });
      const speed = await envelope(f.originalOperation, false, {
        maxFeePerGas: 130,
        maxPriorityFeePerGas: 13,
      });
      await f.store.append(
        f.session(),
        {
          ...speed,
          context: {
            ...context,
            operation: 'speed-up',
            originalHash: f.original.hash,
          },
        },
        undefined,
        ordinary
      );
    }
    const before = f.value();
    await assert.rejects(
      f.store.append(f.session(), replacement, undefined, binding),
      /ORIGINAL_CHANGED/
    );
    assert.equal(f.value(), before);
  }
});

test('retained revocation suppresses old raw replay globally without releasing its balance reservation', async () => {
  const f = await fixture();
  await f.retain();
  const snapshot = await f.store.captureAutoNonceSnapshot(
    f.session(),
    '1',
    owner.address
  );
  assert.equal(snapshot.retained.length, 1);
  assert((await snapshot.readMaximumCost(f.original.hash)) > BigInt(0));
  await assert.rejects(
    snapshot.readSignedTransaction!(f.original.hash),
    /CANCELLATION_FENCE/
  );
  let wires = 0;
  assert.equal(
    await f.store.withReplayAdmission(
      f.session(),
      {
        ...f.original,
        operation: 'send',
        originalHash: undefined,
        metadata: undefined,
      },
      async () => {
        wires++;
        return { result: 'wrong' };
      }
    ),
    null
  );
  assert.equal(wires, 0);
  assert.equal(
    (await f.store.readExact(f.session(), '1', owner.address, f.original.hash))
      ?.rawTransaction,
    f.original.rawTransaction
  );
});

test('a second canonical same-nonce revocation can replace the same original, while unrelated signed intent remains blocked', async () => {
  const f = await fixture();
  await f.retain();
  const next = {
    ...f.revocation,
    preVerificationGas: (
      BigInt(f.revocation.preVerificationGas) + BigInt(1)
    ).toString(),
  };
  next.signature = owner.signingKey.sign(
    getSmartAccountUserOpHash(next, 1)
  ).serialized;
  await f.retain(next);
  assert.equal(
    (
      await f.store.listSmartAccountAuthorizations(f.session(), '1', account, {
        maximum: 10,
      })
    ).entries.length,
    2
  );
  const bad = { ...next, callData: f.originalOperation.callData };
  bad.signature = owner.signingKey.sign(
    getSmartAccountUserOpHash(bad, 1)
  ).serialized;
  await assert.rejects(async () => f.retain(bad));
});

test('storage refusal preserves both original authorization and outer bytes with zero wire entry', async () => {
  const f = await fixture(),
    binding = await f.capture(),
    replacement = await envelope(f.revocation),
    before = f.value();
  f.port.compareAndSet = async () => {
    throw Error('Storage unavailable');
  };
  const session = f.session(),
    boundary = captureEvmSubmission(context, session.assertCurrent, () =>
      createEvmSignedRecordLifecycle(f.store, session, {
        retirementReadForChain: null,
        replacement: binding,
      })
    );
  let wires = 0;
  await assert.rejects(
    submitSignedEvmTransaction(
      replacement.rawTransaction,
      ({ admit }) =>
        admit(async () => {
          wires++;
          return replacement.hash;
        }),
      boundary,
      undefined,
      Transaction.from(replacement.rawTransaction).unsignedSerialized
    )
  );
  assert.equal(wires, 0);
  assert.equal(f.value(), before);
});

test('issuer retirement during encryption still prevents a fresh caller from committing an old replacement capability', async () => {
  const f = await fixture();
  let current = true;
  const issuer = {
    keyring: f.keyring,
    assertCurrent() {
      if (!current) throw Error('issuer retired');
    },
  };
  const binding = await f.store.captureSmartAccountCancellationReplacement(
    issuer,
    {
      chainId: 1,
      originalHash: f.original.hash,
      newUserOperation: f.revocation,
      payer: owner.address,
    }
  );
  const replacement = await envelope(f.revocation),
    before = f.value();
  const encrypt = f.keyring.encryptPrivateRecord.bind(f.keyring);
  f.keyring.encryptPrivateRecord = async (input: any) => {
    const value = await encrypt(input);
    if (input.recordId === 'manifest') current = false;
    return value;
  };
  await assert.rejects(
    f.store.append(f.session(), replacement, undefined, binding),
    /issuer retired/
  );
  assert.equal(f.value(), before);
  assert.equal(f.writes(), 1);
});

test('a fresh-outer revocation remains replayable while its old instruction stays suppressed after restart', async () => {
  const f = await fixture();
  await f.retain();
  await f.store.updatePhase(
    f.session(),
    '1',
    owner.address,
    f.original.hash,
    'confirmed'
  );
  const replacement = await envelope(f.revocation, false, { nonce: 6 });
  const metadata = {
    smartAccountOperationCancellation: {
      account,
      chainId: '1',
      originalKind: 'transaction',
      originalHash: f.original.hash,
      originalOperationHash: getSmartAccountUserOpHash(f.originalOperation, 1),
      operationHash: getSmartAccountUserOpHash(f.revocation, 1),
      operationNonce: f.revocation.nonce,
    },
  };
  await f.store.append(f.session(), replacement, metadata);
  const restarted = new EvmSignedRecords(f.port);
  const page = await restarted.readPage(f.session(), '1', owner.address, {
    maximum: 10,
    nonce: 6,
  });
  assert.deepEqual(
    page.entries.map((row) => row.hash),
    [replacement.hash]
  );
  let wires = 0;
  const admitted = await restarted.withReplayAdmission(
    f.session(),
    { ...replacement, operation: 'send', metadata },
    async () => {
      wires++;
      return { result: replacement.hash };
    }
  );
  assert.equal(admitted?.result, replacement.hash);
  assert.equal(wires, 1);
});
