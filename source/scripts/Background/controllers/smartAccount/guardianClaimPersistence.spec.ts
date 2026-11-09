import { guardianRecoveryFixture } from 'tests/fixtures/guardianRecoveryClaim';
import { smartAccountAddressFixture } from 'tests/fixtures/smartAccountAddress';

import { walletPersistenceGate } from 'state/paliStorage';
import store from 'state/store';
import vaultReducer, { restoreVaultSnapshot } from 'state/vault';
import vaultCache from 'state/vaultCache';
import { setActiveSlip44 } from 'state/vaultGlobal';
import { INetworkType, KeyringAccountType } from 'types/network';
import { getGuardianRecoveryOperationId } from 'utils/smartAccount/guardianStatus';
import { buildSmartAccountGuardianRecoveryOperation } from 'utils/smartAccount/recovery';
import { chromeStorage } from 'utils/storageAPI';

import SmartAccountController from './index';

jest.mock('utils/security/blacklistService', () => ({ blacklistService: {} }));
const OWNER = `0x${'22'.repeat(20)}`;
const identity = smartAccountAddressFixture(57057, OWNER),
  ACCOUNT = identity.account.address;
const fixture = guardianRecoveryFixture(ACCOUNT, OWNER);
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
let disk: Record<string, any>,
  generation: number,
  epoch: string,
  pendingHash: string | null,
  builds: number;
let writes: jest.SpyInstance, sign: jest.Mock, send: jest.Mock, controller: any;
const transaction = { web3Provider: {} };
const expectedContext = () => ({
  account: { address: OWNER, id: 0, type: KeyringAccountType.HDAccount },
  chainId: 57057,
  rpcUrl: 'https://fixture.invalid',
  slip44: 60,
  sessionGeneration: generation,
});
const metadata = () =>
  store.getState().vault.accounts.SmartAccount[1].smartAccount!;
const request = (expectedClaimHash: string | null = null) => ({
  account: ACCOUNT,
  guardian: OWNER,
  operation: null,
  expectedClaimHash,
  readyAt: 1,
  replacement: fixture.replacement,
  target: fixture.target,
});
const submit = (prepared: any) =>
  controller.submitPreparedSmartAccountGuardianStartRecovery({
    ...prepared,
    claimHash: prepared.claim.intent.operation.hash,
  });
function open() {
  controller = new SmartAccountController({
    getEthereumTransaction: () => transaction,
    getWalletSessionGeneration: () => generation,
    getWalletStateGeneration: () => 1,
    signSmartAccountRecoveryOwner: sign,
    sendAndSaveEthTransaction: send,
  } as any);
  controller.buildGuardianStartRecoveryOperation = jest.fn(async () =>
    buildSmartAccountGuardianRecoveryOperation({
      ...fixture.operation,
      policyEpoch: epoch,
      salt: `0x${(++builds).toString(16).padStart(64, '0')}`,
      target: fixture.target,
    })
  );
  controller.validateSmartAccountGuardianRecoveryOperation = jest.fn(
    async ({ operation }: any) => {
      if (operation.policyEpoch !== epoch)
        throw new Error('PALI_GUARDIAN_RECOVERY_POLICY_CHANGED');
    }
  );
  controller.proveRecoveryTargetOwnership = jest.fn(async () => undefined);
  controller.findLocalSigningAccount = jest.fn(() => ({
    id: 0,
    type: KeyringAccountType.HDAccount,
  }));
  controller.getWalletGasPayerAccount = jest.fn(async () => ({
    id: 0,
    type: KeyringAccountType.HDAccount,
    address: OWNER,
  }));
  controller.getSmartAccountGuardianRecoveryStatus = jest.fn(async () => ({
    account: ACCOUNT,
    chainId: 57057,
    moduleAddress: fixture.operation.recoveryModule,
    exists: true,
    policyEpoch: epoch,
    recoveryTransactionHash: pendingHash,
    knownOperation: { status: 'unknown' },
    pending: null,
    active: null,
  }));
  return controller;
}
beforeEach(() => {
  walletPersistenceGate.blocked = false;
  vaultCache.clearCache();
  generation = 1;
  epoch = '7';
  pendingHash = null;
  builds = 0;
  const state = structuredClone(vaultReducer(undefined, { type: 'fixture' }));
  state.activeNetwork = {
    kind: INetworkType.Ethereum,
    chainId: 57057,
    slip44: 60,
    url: 'https://fixture.invalid',
    currency: 'SYS',
    label: 'Fixture',
  } as any;
  state.isBitcoinBased = false;
  state.activeAccount = { id: 0, type: KeyringAccountType.HDAccount };
  state.accounts.HDAccount[0] = {
    ...state.accounts.HDAccount[0],
    id: 0,
    address: OWNER,
    xpub: OWNER,
    xprv: 'encrypted-fixture-key',
  };
  state.accounts.SmartAccount[1] = {
    ...state.accounts.HDAccount[0],
    ...identity.account,
    id: 1,
    isSmartAccount: true,
  };
  store.dispatch(restoreVaultSnapshot(state));
  store.dispatch(setActiveSlip44(60));
  disk = { 'state-vault-60': structuredClone(state) };
  jest
    .spyOn(chromeStorage, 'getItems')
    .mockImplementation(async (keys) =>
      Object.fromEntries(
        keys
          .filter((key) => key in disk)
          .map((key) => [key, structuredClone(disk[key])])
      )
    );
  writes = jest
    .spyOn(chromeStorage, 'setItems')
    .mockImplementation(async (items) => {
      Object.assign(disk, structuredClone(items));
    });
  sign = jest.fn(async () => '0x1234');
  send = jest.fn(async (_tx, _legacy, _payer, _metadata, options) => {
    options.assertBeforeSign();
    options.assertCurrentContext();
    return { hash: `0x${'33'.repeat(32)}`, wait: async () => undefined };
  });
  open();
});
afterEach(() => {
  jest.restoreAllMocks();
  vaultCache.clearCache();
  walletPersistenceGate.blocked = false;
});

test('two prepares serialize their claims under the real wallet persistence mutex before any capability is returned', async () => {
  const entered = deferred<void>(),
    resume = deferred<void>();
  writes.mockImplementationOnce(async (items) => {
    entered.resolve();
    await resume.promise;
    Object.assign(disk, structuredClone(items));
  });
  const first = controller.prepareSmartAccountGuardianStartRecovery(request());
  await Promise.race([
    entered.promise,
    first.then(() => {
      throw new Error('Prepare returned before claim write');
    }),
  ]);
  const second = controller.prepareSmartAccountGuardianStartRecovery(request());
  const secondResult = second.then(
    () => 'accepted',
    (error: Error) => error.message
  );
  expect(metadata().guardianRecoveryClaim).toBeUndefined();
  expect(sign).not.toHaveBeenCalled();
  resume.resolve();
  const accepted = await first;
  expect(await secondResult).toBe('Guardian recovery claim changed');
  expect(metadata().guardianRecoveryClaim).toEqual(accepted.claim);
  expect(
    disk['state-vault-60'].accounts.SmartAccount[1].smartAccount
      .guardianRecoveryClaim
  ).toEqual(accepted.claim);
  await submit(accepted);
  expect(send).toHaveBeenCalledTimes(1);
  expect(store.getState().vault.activeAccount.type).toBe(
    KeyringAccountType.HDAccount
  );
});

test('policy advancement before wire retains the old claim across reopen and permits a fresh expected-hash claim', async () => {
  const first = await controller.prepareSmartAccountGuardianStartRecovery(
    request()
  );
  epoch = '8';
  await expect(submit(first)).rejects.toThrow('POLICY_CHANGED');
  expect(send).not.toHaveBeenCalled();
  store.dispatch(restoreVaultSnapshot(structuredClone(disk['state-vault-60'])));
  open();
  const next = await controller.prepareSmartAccountGuardianStartRecovery(
    request(first.claim.intent.operation.hash)
  );
  expect(next.claim.intent.operation.policyEpoch).toBe('8');
  expect(next.claim.replacement).toEqual(first.claim.replacement);
  await expect(submit(first)).rejects.toThrow('claim changed');
  await submit(next);
  expect(send).toHaveBeenCalledTimes(1);
});

test('an advanced policy cannot replace the old claim while matching owned bytes are unresolved', async () => {
  const first = await controller.prepareSmartAccountGuardianStartRecovery(
    request()
  );
  epoch = '8';
  pendingHash = `0x${'44'.repeat(32)}`;
  await expect(
    controller.prepareSmartAccountGuardianStartRecovery(
      request(first.claim.intent.operation.hash)
    )
  ).rejects.toThrow('claim changed');
  expect(metadata().guardianRecoveryClaim).toEqual(first.claim);
});

test.each(['account', 'chain', 'session'])(
  'a %s change during a held claim cannot publish authority or sign',
  async (axis) => {
    const entered = deferred<void>(),
      resume = deferred<void>();
    writes.mockImplementationOnce(async (items) => {
      entered.resolve();
      await resume.promise;
      Object.assign(disk, structuredClone(items));
    });
    const attempt = controller.prepareSmartAccountGuardianStartRecovery(
      request()
    );
    const rejected = expect(attempt).rejects.toThrow();
    await entered.promise;
    if (axis === 'session') generation++;
    else {
      const current = structuredClone(store.getState().vault);
      if (axis === 'account')
        current.activeAccount = {
          id: 1,
          type: KeyringAccountType.SmartAccount,
        };
      else current.activeNetwork.chainId = 1;
      store.dispatch(restoreVaultSnapshot(current));
    }
    resume.resolve();
    await rejected;
    expect(metadata().guardianRecoveryClaim).toBeUndefined();
    expect(sign).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  }
);

test('a replaced claim revokes an old capability at the final transaction admission guard', async () => {
  const first = await controller.prepareSmartAccountGuardianStartRecovery(
    request()
  );
  const entered = deferred<void>(),
    resume = deferred<void>();
  send.mockImplementationOnce(
    async (_tx, _legacy, _payer, _metadata, options) => {
      entered.resolve();
      await resume.promise;
      options.assertCurrentContext();
      throw new Error('Must not reach wire');
    }
  );
  const attempt = submit(first),
    rejected = expect(attempt).rejects.toThrow('claim changed');
  await entered.promise;
  epoch = '8';
  const next = await controller.prepareSmartAccountGuardianStartRecovery(
    request(first.claim.intent.operation.hash)
  );
  resume.resolve();
  await rejected;
  expect(metadata().guardianRecoveryClaim).toEqual(next.claim);
});

test('the old hash alone cannot replace an unresolved same-epoch claim or bypass an incomplete observation', async () => {
  const first = await controller.prepareSmartAccountGuardianStartRecovery(
    request()
  );
  await expect(
    controller.prepareSmartAccountGuardianStartRecovery(
      request(first.claim.intent.operation.hash)
    )
  ).rejects.toThrow('claim changed');
  epoch = '8';
  controller.getSmartAccountGuardianRecoveryStatus.mockRejectedValueOnce(
    new Error('Retained observation incomplete')
  );
  await expect(
    controller.prepareSmartAccountGuardianStartRecovery(
      request(first.claim.intent.operation.hash)
    )
  ).rejects.toThrow('incomplete');
  expect(metadata().guardianRecoveryClaim).toEqual(first.claim);
});

test('lost finalize reply retains exact refs in durable state until explicit expected-hash retirement', async () => {
  const prepared = await controller.prepareSmartAccountGuardianStartRecovery(
    request()
  );
  send.mockImplementationOnce(
    async (_tx, _legacy, _payer, _metadata, options) => {
      options.assertCurrentContext();
      throw new Error('Finalization reply lost after acceptance');
    }
  );
  await expect(
    controller.finalizeSmartAccountGuardianRecovery({
      claim: prepared.claim,
      expectedClaimHash: prepared.claim.intent.operation.hash,
    })
  ).rejects.toThrow('reply lost');
  store.dispatch(restoreVaultSnapshot(structuredClone(disk['state-vault-60'])));
  open();
  expect(metadata().guardianRecoveryClaim).toEqual(prepared.claim);
  controller.getSmartAccountGuardianRecoveryStatus.mockResolvedValue({
    account: ACCOUNT,
    chainId: 57057,
    moduleAddress: fixture.operation.recoveryModule,
    exists: true,
    policyEpoch: '7',
    recoveryTransactionHash: null,
    knownOperation: { status: 'executed' },
  });
  await expect(
    controller.retireSmartAccountGuardianRecovery({
      expectedContext: expectedContext(),
      account: ACCOUNT,
      expectedClaimHash: `0x${'99'.repeat(32)}`,
    })
  ).rejects.toThrow('claim changed');
  await controller.retireSmartAccountGuardianRecovery({
    expectedContext: expectedContext(),
    account: ACCOUNT,
    expectedClaimHash: prepared.claim.intent.operation.hash,
  });
  expect(metadata().guardianRecoveryClaim).toBeUndefined();
  expect(metadata().guardianRecoveryReplacement).toEqual(
    prepared.claim.replacement
  );
  expect(
    disk['state-vault-60'].accounts.SmartAccount[1].smartAccount
      .guardianRecoveryReplacement
  ).toEqual(prepared.claim.replacement);
});

test('failed replacement ownership proof cannot strand a new unsent claim', async () => {
  controller.proveRecoveryTargetOwnership.mockRejectedValueOnce(
    new Error('Replacement owner is unavailable')
  );
  await expect(
    controller.prepareSmartAccountGuardianStartRecovery(request())
  ).rejects.toThrow('owner is unavailable');
  expect(metadata().guardianRecoveryClaim).toBeUndefined();
  expect(send).not.toHaveBeenCalled();
});

test.each(['replacement active', 'owner changed'])(
  'executed local reconciliation verifies fresh current identity without a second send: %s',
  async (mode) => {
    const prepared = await controller.prepareSmartAccountGuardianStartRecovery(
      request()
    );
    const claim = prepared.claim;
    controller.getSmartAccountGuardianRecoveryStatus.mockResolvedValue({
      account: ACCOUNT,
      chainId: 57057,
      moduleAddress: claim.intent.operation.recoveryModule,
      exists: true,
      policyEpoch: '7',
      recoveryTransactionHash: null,
      knownOperation: {
        operationId: getGuardianRecoveryOperationId(claim.intent.operation),
        status: 'executed',
      },
    });
    const hydrated = {
      ...metadata(),
      isDeployed: true,
      auth: {
        ...claim.intent.target.auth,
        data:
          mode === 'replacement active' ? claim.intent.target.auth.data : '0x',
      },
      installedModules: [
        {
          id: 'ecdsa',
          type: 'validator',
          address: claim.intent.target.auth.validator,
        },
      ],
    };
    controller.hydrateSmartAccount = jest.fn(async () => hydrated);
    const calls = sign.mock.calls.length;
    const reconcile = controller.reconcileSmartAccountGuardianRecovery({
      expectedContext: expectedContext(),
      account: ACCOUNT,
      expectedClaimHash: claim.intent.operation.hash,
    });
    if (mode === 'replacement active')
      await expect(reconcile).resolves.toEqual(hydrated);
    else await expect(reconcile).rejects.toThrow('replacement is not active');
    expect(controller.hydrateSmartAccount).toHaveBeenCalledWith(
      1,
      expectedContext()
    );
    expect(sign).toHaveBeenCalledTimes(calls);
    expect(send).not.toHaveBeenCalled();
    expect(metadata().guardianRecoveryClaim).toEqual(claim);
  }
);

test('one valid offchain ownership proof precedes the durable claim and returns a fresh scheduling context', async () => {
  const prepared = await controller.prepareSmartAccountGuardianStartRecovery(
    request()
  );
  expect(controller.proveRecoveryTargetOwnership).toHaveBeenCalledTimes(1);
  const proofContext = controller.proveRecoveryTargetOwnership.mock.calls[0][2];
  expect(proofContext).not.toBe(prepared.executionContextId);
  expect(() =>
    controller.assertSmartAccountExecutionContext(
      prepared.executionContextId,
      prepared.operation.hash
    )
  ).not.toThrow();
  expect(metadata().guardianRecoveryClaim).toEqual(prepared.claim);
  expect(sign).toHaveBeenCalledTimes(1);
});

test.each(['retire', 'reconcile'])(
  'a new wallet/session with identical public account and claim cannot accept a stale %s context',
  async (action) => {
    const prepared = await controller.prepareSmartAccountGuardianStartRecovery(
      request()
    );
    const originalContext = expectedContext();
    const saved = structuredClone(disk['state-vault-60']);
    generation++;
    store.dispatch(restoreVaultSnapshot(saved));
    open();
    const method =
      action === 'retire'
        ? controller.retireSmartAccountGuardianRecovery.bind(controller)
        : controller.reconcileSmartAccountGuardianRecovery.bind(controller);
    await expect(
      method({
        account: ACCOUNT,
        expectedClaimHash: prepared.claim.intent.operation.hash,
        expectedContext: originalContext,
      })
    ).rejects.toThrow('PALI_TRANSACTION_CONTEXT_CHANGED');
    expect(
      controller.getSmartAccountGuardianRecoveryStatus
    ).not.toHaveBeenCalled();
    expect(metadata().guardianRecoveryClaim).toEqual(prepared.claim);
  }
);

test.each(['retire', 'reconcile'])(
  'the new %s RPC refuses omitted and null context at runtime',
  async (action) => {
    const prepared = await controller.prepareSmartAccountGuardianStartRecovery(
      request()
    );
    const method =
      action === 'retire'
        ? controller.retireSmartAccountGuardianRecovery.bind(controller)
        : controller.reconcileSmartAccountGuardianRecovery.bind(controller);
    for (const context of [undefined, null])
      await expect(
        method({
          account: ACCOUNT,
          expectedClaimHash: prepared.claim.intent.operation.hash,
          expectedContext: context,
        })
      ).rejects.toThrow('PALI_TRANSACTION_CONTEXT_CHANGED');
    expect(metadata().guardianRecoveryClaim).toEqual(prepared.claim);
  }
);
