/** @jest-environment node */
jest.unmock('crypto');
jest.mock('..', () => ({
  getController: jest.fn(),
  notificationManager: { cleanup: jest.fn() },
}));
jest.mock('./providers/patchFetchWithPaliHeaders', () => ({
  patchFetchWithPaliHeaders: jest.fn(),
}));
jest.mock('@sidhujag/sysweb3-keyring', () => ({
  KeyringManager: jest.fn(),
  CustomJsonRpcProvider: jest.fn(),
  PsbtUtils: {},
}));
jest.mock('state/store', () => ({
  persistSmartAccountMetadata: jest.fn(async (id, prepare, check) => {
    check();
    mockState.vault.accounts.SmartAccount[id].smartAccount = prepare();
    check();
  }),
  __esModule: true,
  default: { getState: () => mockState, dispatch: jest.fn() },
}));
jest.mock('utils/security/blacklistService', () => ({ blacklistService: {} }));
jest.mock('utils/smartAccount/guardianStatus', () => ({
  ...jest.requireActual('utils/smartAccount/guardianStatus'),
  readGuardianRecoveryObservation: jest.fn(async ({ assertCurrent }) => {
    assertCurrent();
    return mockChain;
  }),
}));

import {
  decryptPrivateRecordBytes,
  encryptPrivateRecordBytes,
  privateRecordProfileId,
} from '@sidhujag/sysweb3-keyring/cjs/private-records.js';
import { webcrypto } from 'crypto';
import { Transaction } from 'ethers/transaction';
import { Wallet } from 'ethers/wallet';

import { EvmSignedRecords } from '../../../wallet/evmSignedRecords';
import { encodeEcdsaValidatorInitData } from 'utils/smartAccount/account';
import { getPaliModuleAddress } from 'utils/smartAccount/contracts';
import { captureGuardianRecoveryClaim } from 'utils/smartAccount/guardianRecoveryClaim';
import { buildGuardianRecoveryScheduleTransaction } from 'utils/smartAccount/guardianRecoveryCommands';
import { captureGuardianRecoveryIntent } from 'utils/smartAccount/guardianRecoveryIntent';
import {
  matchesGuardianRecoveryTransaction,
  pendingGuardianRecoveryTransaction,
} from 'utils/smartAccount/guardianRecoveryLifecycle';
import { getGuardianRecoveryOperationId } from 'utils/smartAccount/guardianStatus';
import { buildSmartAccountGuardianRecoveryOperation } from 'utils/smartAccount/recovery';

import MainController from './MainController';
import SmartAccountController from './smartAccount';

const ACCOUNT = `0x${'11'.repeat(20)}`;
const OTHER = `0x${'22'.repeat(20)}`;
const BLOCK = `0x${'ab'.repeat(32)}`;
const signer = new Wallet(`0x${'33'.repeat(32)}`);
let mockState: any;
let mockChain: any;

function fixture() {
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: webcrypto,
  });
  const key = new Uint8Array(32).fill(42);
  const keyring = {
    isUnlocked: () => true,
    getPrivateRecordProfileId: () =>
      privateRecordProfileId(key, () => undefined),
    encryptPrivateRecord: (input: any) =>
      encryptPrivateRecordBytes(key, input, () => undefined),
    decryptPrivateRecord: (input: any) =>
      decryptPrivateRecordBytes(key, input, () => undefined),
    ethereumTransaction: { web3Provider: { send: jest.fn() } },
  };
  let disk: string | undefined;
  const storage = {
    read: async () => disk,
    async compareAndSet(
      _profile: string,
      before: string | undefined,
      next: string,
      check: () => void
    ) {
      check();
      if (disk !== before) return false;
      disk = next;
      return true;
    },
  };
  let records = new EvmSignedRecords(storage);
  const target = {
    auth: {
      module: 'ecdsa' as const,
      validator: getPaliModuleAddress(1, 'ecdsa'),
      data: encodeEcdsaValidatorInitData([signer.address], 1),
    },
  };
  const intent = captureGuardianRecoveryIntent({
    target,
    operation: buildSmartAccountGuardianRecoveryOperation({
      account: ACCOUNT,
      chainId: 1,
      policyEpoch: '7',
      recoveryModule: getPaliModuleAddress(1, 'guardian-recovery'),
      salt: `0x${'44'.repeat(32)}`,
      target,
    }),
  });
  const claim = captureGuardianRecoveryClaim({
    intent,
    guardian: { kind: 'ecdsa', guardian: signer.address },
    replacement: {
      kind: 'ecdsa',
      authenticator: {
        id: 'ecdsa',
        config: { owners: [signer.address], threshold: 1 },
      },
    },
    readyAt: 1,
  });
  const proof = jest.fn(async () => undefined),
    signature = jest.fn(async () => '0x1234'),
    dispatch = jest.fn(async () => ({ hash: `0x${'ee'.repeat(32)}` }));
  const id = getGuardianRecoveryOperationId(intent.operation);
  mockState = {
    vault: {
      activeAccount: { id: 1, type: 'SmartAccount' },
      activeNetwork: {
        kind: 'ethereum',
        chainId: 1,
        url: 'https://fixture.invalid',
      },
      accounts: {
        SmartAccount: {
          1: {
            id: 1,
            address: ACCOUNT,
            isSmartAccount: true,
            smartAccount: { chainId: 1, guardianRecoveryClaim: claim },
          },
        },
        HDAccount: { 8: { address: signer.address } },
      },
      isBitcoinBased: false,
    },
    vaultGlobal: { activeSlip44: 60 },
  };
  mockChain = {
    account: ACCOUNT,
    chainId: 1,
    moduleAddress: intent.operation.recoveryModule,
    exists: true,
    policyEpoch: '7',
    pending: null,
    active: null,
    knownOperation: { operationId: id, status: 'unknown' },
  };
  let wallet: any;
  let controller: SmartAccountController;
  const reopen = () => {
    records = new EvmSignedRecords(storage);
    wallet = Object.create(MainController.prototype);
    wallet.walletSessionGeneration = 0;
    wallet.walletStateGeneration = 0;
    wallet.assertWalletReadyForSigning = () => undefined;
    wallet.getActiveKeyring = () => keyring;
    wallet.retainedEvmRecords = records;
    controller = new SmartAccountController({
      captureGuardianRecoveryTransactions: (chainId, check) =>
        wallet.captureGuardianRecoveryTransactions(chainId, check),
      getEthereumTransaction: () => keyring.ethereumTransaction,
      getWalletSessionGeneration: () => wallet.walletSessionGeneration,
      getWalletStateGeneration: () => wallet.walletStateGeneration,
      signSmartAccountActionDigestInternal: signature,
      sendAndSaveEthTransaction: dispatch,
    } as any);
    Object.assign(controller, {
      proveRecoveryTargetOwnership: proof,
      validateSmartAccountGuardianRecoveryOperation: jest.fn(
        async () => undefined
      ),
      findLocalSigningAccount: () => ({ id: 8, type: 'HDAccount' }),
      getWalletGasPayerAccount: async () => ({
        id: 8,
        type: 'HDAccount',
        address: signer.address,
      }),
    });
  };
  const mined = new Set<string>();
  let wrongBlock = false;
  const send = keyring.ethereumTransaction.web3Provider.send;
  send.mockImplementation(async (method, params) => {
    if (method === 'eth_chainId') return '0x1';
    if (method === 'eth_getTransactionCount') return '0x0';
    if (method === 'eth_getTransactionReceipt')
      return mined.has(params[0])
        ? {
            transactionHash: params[0],
            from: signer.address,
            to: intent.operation.recoveryModule,
            status: '0x1',
            blockNumber: '0x2',
            blockHash: BLOCK,
          }
        : null;
    if (method === 'eth_getBlockByNumber')
      return {
        number: '0x2',
        hash: wrongBlock ? `0x${'cd'.repeat(32)}` : BLOCK,
        gasLimit: '0xffffff',
      };
    throw new Error(`Unexpected RPC ${method}`);
  });
  reopen();
  const append = async (
    account = ACCOUNT,
    chainId = 1,
    nonce = 0,
    approvalSignature?: string
  ) => {
    const operation =
      account === ACCOUNT
        ? intent.operation
        : buildSmartAccountGuardianRecoveryOperation({
            ...intent.operation,
            account,
            target,
          });
    const transaction = buildGuardianRecoveryScheduleTransaction({
      account,
      operation,
      guardian: signer.address,
      approval: {
        guardian: signer.address,
        signature:
          approvalSignature ??
          signer.signingKey.sign(operation.hash).serialized,
      },
    });
    const rawTransaction = await signer.signTransaction({
      ...transaction,
      chainId,
      nonce,
      type: 2,
      gasLimit: 500000,
      maxFeePerGas: 3,
      maxPriorityFeePerGas: 1,
    });
    const tx = Transaction.from(rawTransaction);
    await records.append(
      {
        keyring,
        assertCurrent() {
          /* The fixture remains current. */
        },
      },
      {
        rawTransaction,
        hash: tx.hash!,
        from: signer.address,
        chainId: String(chainId),
        nonce,
        type: 2,
        context: {
          account: { id: 8, type: 'HDAccount', address: signer.address },
          network: {
            kind: 'ethereum',
            chainId,
            slip44: 60,
            url: 'https://fixture.invalid',
          },
          operation: 'send',
        },
      }
    );
    return records.readExact(
      {
        keyring,
        assertCurrent() {
          /* The fixture remains current. */
        },
      },
      String(chainId),
      signer.address,
      tx.hash!
    );
  };
  return {
    intent,
    id,
    proof,
    signature,
    dispatch,
    prepare: () =>
      controller.prepareSmartAccountGuardianStartRecovery({
        account: ACCOUNT,
        guardian: signer.address,
        operation: claim.intent.operation,
        expectedClaimHash: claim.intent.operation.hash,
        target: claim.intent.target,
        replacement: claim.replacement,
        readyAt: claim.readyAt,
      }),
    submit: () =>
      controller.submitPreparedSmartAccountGuardianStartRecovery({
        account: ACCOUNT,
        guardian: signer.address,
        operation: claim.intent.operation,
        claimHash: claim.intent.operation.hash,
        approval: {
          guardian: signer.address,
          signature: signer.signingKey.sign(claim.intent.operation.hash)
            .serialized,
        },
      }),
    append,
    reopen,
    send,
    mined,
    wrongBlock: () => {
      wrongBlock = true;
    },
    retire: () => {
      wallet.walletSessionGeneration++;
    },
    inspect: () =>
      controller.getSmartAccountGuardianRecoveryStatus({
        account: ACCOUNT,
        intent,
        guardian: signer.address,
        guardianApproval: 'ecdsa',
      }),
    inspectContract: () =>
      controller.getSmartAccountGuardianRecoveryStatus({
        account: ACCOUNT,
        intent,
        guardian: signer.address,
        guardianApproval: 'contract',
      }),
    get records() {
      return records;
    },
    keyring,
  };
}

test('the extension host recovers signed scheduling bytes after lost reply and cold reopen, then reconciles its canonical receipt', async () => {
  const f = fixture();
  const attempt = (await f.append())!;
  f.reopen();
  expect((await f.inspect()).recoveryTransactionHash).toBe(attempt.hash);
  expect(
    f.send.mock.calls.filter(
      ([method]) => method === 'eth_getTransactionReceipt'
    )
  ).toEqual([['eth_getTransactionReceipt', [attempt.hash]]]);
  f.mined.add(attempt.hash);
  mockChain.pending = mockChain.knownOperation = {
    operationId: f.id,
    status: 'ready',
  };
  expect(await f.inspect()).toMatchObject({
    recoveryTransactionHash: null,
    pending: { operationId: f.id, status: 'ready' },
  });
  expect(
    (await f.records.readExact(
      {
        keyring: f.keyring,
        assertCurrent() {
          /* The fixture remains current. */
        },
      },
      '1',
      signer.address,
      attempt.hash
    ))!.phase
  ).toBe('confirmed');
});

test('retained records for other accounts and chains never enter the receipt observer', async () => {
  const f = fixture();
  const other = (await f.append(OTHER, 1, 1))!;
  const chain = (await f.append(ACCOUNT, 2, 0))!;
  expect(
    matchesGuardianRecoveryTransaction(other, f.intent.operation, {
      kind: 'ecdsa',
      guardian: signer.address,
    })
  ).toBe(false);
  expect(
    matchesGuardianRecoveryTransaction(chain, f.intent.operation, {
      kind: 'ecdsa',
      guardian: signer.address,
    })
  ).toBe(false);
  expect((await f.inspect()).recoveryTransactionHash).toBeNull();
  expect(f.send).not.toHaveBeenCalled();
});

test('a failed canonical block check never grants retry permission', async () => {
  const f = fixture();
  const attempt = (await f.append())!;
  f.mined.add(attempt.hash);
  f.wrongBlock();
  await expect(f.inspect()).rejects.toThrow();
});

test('a session change during a retained-attempt read retires its reply', async () => {
  const f = fixture();
  await f.append();
  const original = f.send.getMockImplementation()!;
  let release!: () => void;
  f.send.mockImplementation(async (method, params) => {
    if (method === 'eth_getTransactionReceipt')
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    return original(method, params);
  });
  const pending = f.inspect();
  while (!release) await new Promise((resolve) => setTimeout(resolve, 0));
  f.retire();
  release();
  await expect(pending).rejects.toThrow();
});

test('approval verification is mandatory, and opaque contract approvals can only retain an unknown attempt', async () => {
  const f = fixture();
  const attempt = (await f.append(ACCOUNT, 1, 0, '0x1234'))!;
  expect(
    matchesGuardianRecoveryTransaction(attempt, f.intent.operation, {
      kind: 'ecdsa',
      guardian: signer.address,
    })
  ).toBe(false);
  expect((await f.inspect()).recoveryTransactionHash).toBeNull();
  expect((await f.inspectContract()).recoveryTransactionHash).toBe(
    attempt.hash
  );
  const read = jest.fn();
  await expect(
    pendingGuardianRecoveryTransaction(
      f.intent.operation,
      undefined as any,
      { read, observe: jest.fn() },
      () => undefined
    )
  ).rejects.toThrow('verification is required');
  expect(read).not.toHaveBeenCalled();
});

test('an exact retained same-intent scheduling attempt blocks direct prepare and submit before another signature or wire', async () => {
  const f = fixture();
  await f.append();
  const results = await Promise.allSettled([f.prepare(), f.submit()]);
  expect(results.map((result) => result.status)).toEqual([
    'rejected',
    'rejected',
  ]);
  expect(f.proof).not.toHaveBeenCalled();
  expect(f.signature).not.toHaveBeenCalled();
  expect(f.dispatch).not.toHaveBeenCalled();
});

test('a lost first send leaves retained bytes blocking a queued same-claim attempt', async () => {
  const f = fixture();
  f.dispatch.mockImplementationOnce(async () => {
    await f.append();
    throw new Error('Reply lost after transport');
  });
  const result = await Promise.allSettled([f.submit(), f.submit()]);
  expect(result.every((item) => item.status === 'rejected')).toBe(true);
  expect(f.dispatch).toHaveBeenCalledTimes(1);
  expect(f.signature).not.toHaveBeenCalled();
});

test('a complete empty retained observation still allows the same canonical proof and submit', async () => {
  const f = fixture();
  await f.prepare();
  await f.submit();
  expect(f.proof).toHaveBeenCalledTimes(1);
  expect(f.signature).toHaveBeenCalledTimes(1);
  expect(f.dispatch).toHaveBeenCalledTimes(1);
});

test('canceling the first admission drains old queued owners and releases the recovery mutex for a fresh owner', async () => {
  const f = fixture();
  let release!: () => void, entered!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  f.dispatch.mockImplementationOnce(
    async (_tx, _legacy, _payer, _metadata, options) => {
      entered();
      await held;
      options.assertCurrentContext();
      return { hash: `0x${'ff'.repeat(32)}` };
    }
  );
  const first = f.submit();
  await started;
  const second = f.submit();
  f.retire();
  release();
  expect(
    (await Promise.allSettled([first, second])).every(
      (result) => result.status === 'rejected'
    )
  ).toBe(true);
  expect(f.dispatch).toHaveBeenCalledTimes(1);
  await f.submit();
  expect(f.dispatch).toHaveBeenCalledTimes(2);
});
