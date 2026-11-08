import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  encodeEcdsaValidatorInitData,
  getConfiguredAuthenticatorAddress,
  getPaliSmartAccountDescriptor,
} from '../../../source/utils/smartAccount/account.ts';
import { derivePaliSmartAccountDeployment } from '../../../source/utils/smartAccount/counterfactual.ts';
import {
  getPaliModuleAddress,
  getPaliSmartAccountFactoryAddress,
  PALI_SMART_ACCOUNT_VERSION,
} from '../../../source/utils/smartAccount/contracts.ts';
import { captureGuardianRecoveryIntent } from '../../../source/utils/smartAccount/guardianRecoveryIntent.ts';
import { buildSmartAccountGuardianRecoveryOperation } from '../../../source/utils/smartAccount/recovery.ts';
import {
  NativeWalletCatalogue,
  WALLET_CATALOGUE_KEY,
  replaceRecoveredAccountRecords,
  type NativeGuardianRecoveryIntent,
  type CatalogueMutation,
} from '../src/custody/walletCatalogue.ts';
import { EvmSignedRecords } from '../../../source/wallet/evmSignedRecords.ts';
import { SqliteWalletStorage } from '../src/storage/sqlite.ts';
import { createAccountRecordTestFixture } from './accountRecordTestFixture.ts';
import {
  digest,
  INSTALLATION,
  nodeConnection,
  type SqlHook,
} from './storageHelpers.ts';

const current = () => undefined;
async function fixture(hooks: { before?: SqlHook; after?: SqlHook } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'pali-recovery-intent-'));
  const file = path.join(directory, 'wallet.sqlite');
  let connection = nodeConnection(file, hooks);
  let storage = await SqliteWalletStorage.open(
    connection.connection,
    digest,
    INSTALLATION,
    true
  );
  const sdk = await createAccountRecordTestFixture();
  await storage.keyringStorage.createManyIfAbsent(sdk.pair);
  const identity = {
    walletFingerprint: await storage.getWalletFingerprint(),
    ...sdk.identity,
  };
  await storage.keyringStorage.set(
    WALLET_CATALOGUE_KEY,
    sdk.record(identity.walletFingerprint)
  );
  let catalogue = new NativeWalletCatalogue(storage.keyringStorage);
  await catalogue.reconcile(identity, current);
  const change = (input: CatalogueMutation, guard = current) =>
    input.kind === 'remove'
      ? catalogue.mutate(
          catalogue.privateRecords.revision,
          input,
          guard,
          (key, expected, value, check) =>
            storage.keyringStorage.compareAndSetMany(
              [{ key, expected, value }],
              check
            )
        )
      : catalogue.mutate(catalogue.privateRecords.revision, input, guard);
  const guardian = await sdk.derive(1, 'Guardian');
  await change({ kind: 'create', account: guardian });
  const replacement = await sdk.imported('0x' + '07'.repeat(32), 'Replacement');
  await change({
    kind: 'import',
    account: replacement.account,
    recovery: replacement.recovery,
  });
  const chainId = 1;
  const oldOwner = '0x' + '11'.repeat(20);
  const factoryAddress = getPaliSmartAccountFactoryAddress(chainId);
  const descriptor = getPaliSmartAccountDescriptor({
    accountIndex: 0,
    accountVersion: PALI_SMART_ACCOUNT_VERSION,
    anchor: `pali:eip155:1:${oldOwner}:smart-account-v1`,
    chainId,
    factoryAddress,
  });
  const auth = {
    module: 'ecdsa' as const,
    validator: getConfiguredAuthenticatorAddress(chainId, 'ecdsa'),
    data: encodeEcdsaValidatorInitData([oldOwner], 1),
  };
  const deployment = derivePaliSmartAccountDeployment({
    ...auth,
    factoryAddress,
    deploySalt: descriptor.deploymentSalt,
  });
  const smart = {
    id: 0,
    address: deployment.address,
    xpub: deployment.address,
    xprv: '',
    label: 'Recoverable',
    balances: { syscoin: -1, ethereum: -1 },
    isSmartAccount: true,
    isImported: false,
    isLedgerWallet: false,
    isTrezorWallet: false,
    smartAccount: {
      chainId,
      contractVersion: PALI_SMART_ACCOUNT_VERSION,
      factoryAddress,
      descriptor,
      deploymentSalt: descriptor.deploymentSalt,
      deploymentAuth: { validator: auth.validator, data: auth.data },
      auth,
      isDeployed: true,
    },
  };
  await change({ kind: 'create-smart', account: smart });
  await change({ kind: 'select', id: 'smart:60:0' });
  const target = {
    auth: {
      ...auth,
      data: encodeEcdsaValidatorInitData([replacement.account.address], 1),
    },
  };
  const operation = buildSmartAccountGuardianRecoveryOperation({
    account: smart.address,
    chainId,
    policyEpoch: '1',
    salt: '0x' + '77'.repeat(32),
    target,
    replaceExistingValidator: true,
    revokeValidator: auth.validator,
    recoveryModule: getPaliModuleAddress(chainId, 'guardian-recovery'),
  });
  const captured = captureGuardianRecoveryIntent({ operation, target });
  const intent: NativeGuardianRecoveryIntent = {
    accountId: 'smart:60:0',
    ...captured,
    guardian: {
      id: 'hd:60:1',
      address: guardian.address,
      xpub: guardian.xpub.toLowerCase(),
    },
    replacement: {
      id: `imported:60:${replacement.account.id}`,
      address: replacement.account.address,
      xpub: replacement.account.xpub.toLowerCase(),
    },
  };
  return {
    sdk,
    identity,
    smart,
    target: captured.target,
    intent,
    change,
    get storage() {
      return storage;
    },
    get catalogue() {
      return catalogue;
    },
    async reopen() {
      await storage.close().catch(() => undefined);
      connection = nodeConnection(file);
      storage = await SqliteWalletStorage.open(
        connection.connection,
        digest,
        INSTALLATION,
        false
      );
      catalogue = new NativeWalletCatalogue(storage.keyringStorage);
      return catalogue.reconcile(identity, current);
    },
    async cleanup() {
      await sdk.close();
      await storage.close().catch(() => undefined);
      await rm(directory, { recursive: true, force: true });
    },
  };
}
const store = (f: Awaited<ReturnType<typeof fixture>>) =>
  f.change({
    kind: 'store-guardian-recovery',
    id: f.intent.accountId,
    intent: f.intent,
    expectedOperationHash: null,
  });

test('recovery intent is durable without the original owner and stays out of the public catalogue', async () => {
  const f = await fixture();
  try {
    const publicSnapshot = await store(f);
    assert.equal('guardianRecoveryIntents' in publicSnapshot, false);
    assert.deepEqual(f.catalogue.privateRecords.guardianRecoveryIntents, [
      f.intent,
    ]);
    await f.reopen();
    assert.deepEqual(f.catalogue.privateRecords.guardianRecoveryIntents, [
      f.intent,
    ]);
    await f.change({
      kind: 'rename',
      id: f.intent.accountId,
      label: 'Renamed recovery',
    });
    const before = f.catalogue.privateRecords;
    const recovered = replaceRecoveredAccountRecords(
      before,
      f.identity.walletFingerprint,
      before.groups
    );
    assert.deepEqual(recovered.guardianRecoveryIntents, [f.intent]);
    assert.deepEqual(recovered.groups, before.groups);
  } finally {
    await f.cleanup();
  }
});

test('intent retries preserve the exact operation and reject replacement or duplicate target scopes', async () => {
  const f = await fixture();
  try {
    await store(f);
    await f.change({
      kind: 'store-guardian-recovery',
      id: f.intent.accountId,
      intent: f.intent,
      expectedOperationHash: f.intent.operation.hash,
    });
    await assert.rejects(
      f.change({
        kind: 'store-guardian-recovery',
        id: f.intent.accountId,
        intent: {
          ...f.intent,
          operation: { ...f.intent.operation, salt: '0x' + '88'.repeat(32) },
        },
        expectedOperationHash: f.intent.operation.hash,
      })
    );
    const raw = f.catalogue.privateRecords;
    await f.storage.keyringStorage.set(WALLET_CATALOGUE_KEY, {
      ...raw,
      guardianRecoveryIntents: [
        structuredClone(f.intent),
        structuredClone(f.intent),
      ],
    });
    await assert.rejects(f.reopen());
  } finally {
    await f.cleanup();
  }
});

test('recovery intent rejects unrelated replacement keys, payloads and target accounts', async () => {
  const f = await fixture();
  try {
    const variants = [
      { ...f.intent, replacement: f.intent.guardian },
      {
        ...f.intent,
        guardian: { ...f.intent.guardian, xpub: f.intent.replacement.xpub },
      },
      { ...f.intent, accountId: 'hd:60:0' },
      {
        ...f.intent,
        operation: { ...f.intent.operation, executionCalldata: '0x' },
      },
      { ...f.intent, operation: { ...f.intent.operation, chainId: 2 } },
      { ...f.intent, secret: 'not allowed' },
    ];
    for (const intent of variants)
      await assert.rejects(
        f.change({
          kind: 'store-guardian-recovery',
          id: f.intent.accountId,
          intent,
          expectedOperationHash: null,
        })
      );
    assert.equal(f.catalogue.privateRecords.guardianRecoveryIntents, undefined);
  } finally {
    await f.cleanup();
  }
});

test('referenced guardian and replacement keys remain until intent retirement', async () => {
  const f = await fixture();
  try {
    await store(f);
    const imported = f.catalogue.privateRecords.recovery;
    for (const id of [f.intent.guardian.id, f.intent.replacement.id]) {
      await assert.rejects(
        f.change({ kind: 'remove', id }),
        /CATALOGUE_NOT_REMOVABLE/
      );
    }
    assert.deepEqual(f.catalogue.privateRecords.recovery, imported);
    await assert.rejects(
      f.change({
        kind: 'retire-guardian-recovery',
        id: f.intent.accountId,
        operationHash: '0x' + '00'.repeat(32),
      })
    );
    await f.change({
      kind: 'retire-guardian-recovery',
      id: f.intent.accountId,
      operationHash: f.intent.operation.hash,
    });
    await f.change({ kind: 'remove', id: f.intent.replacement.id });
    assert.equal(f.catalogue.privateRecords.recovery.length, 0);
  } finally {
    await f.cleanup();
  }
});

test('completed recovery adopts matching metadata and retires intent atomically', async () => {
  const f = await fixture();
  try {
    await store(f);
    const before =
      f.catalogue.privateRecords.groups[0]!.accounts.SmartAccount[0]!;
    await assert.rejects(
      f.change({
        kind: 'complete-guardian-recovery',
        id: f.intent.accountId,
        operationHash: f.intent.operation.hash,
        metadata: {
          auth: before.smartAccount!.auth,
          isDeployed: true,
          availableModules: [],
          installedModules: [],
        },
      })
    );
    assert.equal(f.catalogue.privateRecords.guardianRecoveryIntents?.length, 1);
    await f.change({
      kind: 'complete-guardian-recovery',
      id: f.intent.accountId,
      operationHash: f.intent.operation.hash,
      metadata: {
        auth: f.target.auth,
        isDeployed: true,
        availableModules: [],
        installedModules: [],
      },
    });
    const after =
      f.catalogue.privateRecords.groups[0]!.accounts.SmartAccount[0]!;
    assert.deepEqual(
      after.smartAccount?.descriptor,
      before.smartAccount?.descriptor
    );
    assert.equal(after.address, before.address);
    assert.equal(after.label, before.label);
    assert.deepEqual(after.smartAccount?.auth, f.target.auth);
    assert.deepEqual(f.catalogue.privateRecords.guardianRecoveryIntents, []);
    await f.reopen();
    assert.deepEqual(f.catalogue.privateRecords.guardianRecoveryIntents, []);
    assert.deepEqual(
      f.catalogue.privateRecords.groups[0]!.accounts.SmartAccount[0]
        ?.smartAccount?.auth,
      f.target.auth
    );
  } finally {
    await f.cleanup();
  }
});

for (const lostAck of [false, true])
  test(`recovery intent commit ${
    lostAck ? 'lost acknowledgement' : 'owner revocation'
  } preserves storage semantics`, async () => {
    let enabled = false,
      live = true;
    const hook: SqlHook = (kind, sql) => {
      if (!enabled) return;
      if (lostAck && kind === 'exec' && sql === 'COMMIT') {
        enabled = false;
        throw Error('lost acknowledgement');
      }
      if (
        !lostAck &&
        kind === 'run' &&
        sql.startsWith('UPDATE keyring_records')
      ) {
        enabled = false;
        live = false;
      }
    };
    const f = await fixture({ after: hook });
    try {
      enabled = true;
      await assert.rejects(
        f.change(
          {
            kind: 'store-guardian-recovery',
            id: f.intent.accountId,
            intent: f.intent,
            expectedOperationHash: null,
          },
          () => {
            if (!live) throw Error('owner revoked');
          }
        )
      );
      await f.reopen();
      assert.equal(
        f.catalogue.privateRecords.guardianRecoveryIntents?.length ?? 0,
        lostAck ? 1 : 0
      );
    } finally {
      await f.cleanup();
    }
  });

test('activity reset retains recovery intent while explicit wallet removal wipes it', async () => {
  const f = await fixture();
  try {
    await store(f);
    const profileId = await f.sdk.keyring.getPrivateRecordProfileId();
    await f.storage.recovery.bindIdentity(
      f.identity.walletFingerprint,
      {
        address: f.identity.address,
        publicKey: f.identity.publicKey,
        profileId,
      },
      current
    );
    const records = new EvmSignedRecords(f.storage.signedRecords);
    const session = records.captureSession({
      keyring: f.sdk.keyring,
      assertCurrent: current,
    });
    await records.clearScope(session, {
      profileId,
      chainId: '1',
      from: f.intent.operation.account,
    });
    const saved = await f.storage.keyringStorage.get(WALLET_CATALOGUE_KEY);
    assert.deepEqual(
      (saved as { guardianRecoveryIntents: unknown }).guardianRecoveryIntents,
      [f.intent]
    );
    const snapshot = await f.storage.recovery.readSnapshot();
    await f.storage.removal.commit(snapshot, current);
    await assert.rejects(f.reopen());
    assert.equal(
      await f.storage.keyringStorage.get(WALLET_CATALOGUE_KEY),
      undefined
    );
  } finally {
    await f.cleanup();
  }
});
