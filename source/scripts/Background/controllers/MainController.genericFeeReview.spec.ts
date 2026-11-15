jest.mock('..', () => ({ getController: jest.fn(), notificationManager: {} }));
jest.mock('./providers/patchFetchWithPaliHeaders', () => ({
  patchFetchWithPaliHeaders: jest.fn(),
}));
jest.mock('@sidhujag/sysweb3-keyring', () => ({
  KeyringManager: jest.fn(),
  CustomJsonRpcProvider: jest.fn(),
  PsbtUtils: {},
}));
jest.mock('utils/evmCallBlacklist', () => ({
  getBlacklistTargetsForEvmCallWithContractType: jest.fn(async () => []),
}));
jest.mock('utils/navigationState', () => ({
  getWalletNavigationScope: () => ({ account: 'owner', network: 'network' }),
  clearNavigationState: jest.fn(async () => undefined),
  clearTransactionNavigationState: jest.fn(async () => undefined),
}));

import { snapshotPreparedEvmTransaction } from '@sidhujag/sysweb3-keyring/cjs/transactions/evm-envelope.js';
import { Transaction } from 'ethers/transaction';

import { getController } from '..';
import store from 'state/store';
import { KeyringAccountType } from 'types/network';
import { clearTransactionNavigationState } from 'utils/navigationState';

import MainController from './MainController';
import {
  issueGenericEvmFeeReview,
  bindGenericEvmFeeDispatch,
  consumeGenericEvmFeeReview,
} from './nativeEvmFeeReviews';
import type { IEvmTransactionResponse } from './transactions/types';
import type { EvmDappReview } from '../../../shared/evmDappReview';

const address = `0x${'11'.repeat(20)}`;
const transaction = snapshotPreparedEvmTransaction({
  from: address,
  to: `0x${'22'.repeat(20)}`,
  chainId: '57',
  nonce: '0',
  value: '0',
  data: '0x1234',
  gasLimit: '60000',
  type: 2,
  accessList: [],
  maxFeePerGas: '3',
  maxPriorityFeePerGas: '1',
});
const context = {
  account: { id: 0, type: KeyringAccountType.HDAccount, address },
  chainId: 57,
  rpcUrl: 'https://rpc.invalid',
  slip44: 60,
  sessionGeneration: 1,
};
const nonce = { nonce: 0, source: 'automatic' as const };

function fixture(failure: Error) {
  const send = jest.fn(async () => {
    throw failure;
  });
  const sdk = { web3Provider: {}, sendFormattedTransaction: send };
  jest.spyOn(store, 'getState').mockReturnValue({
    vault: {
      isBitcoinBased: false,
      activeAccount: { id: 0, type: KeyringAccountType.HDAccount },
      accounts: { HDAccount: { 0: { address } } },
      activeNetwork: {
        chainId: 57,
        kind: 'ethereum',
        url: context.rpcUrl,
        slip44: 60,
      },
    },
    vaultGlobal: { activeSlip44: 60 },
  } as any);
  jest
    .mocked(getController)
    .mockReturnValue({ wallet: { ethereumTransaction: sdk } } as any);
  const wallet: any = Object.create(MainController.prototype);
  wallet.walletSessionGeneration = 1;
  wallet.networkRequestGeneration = 1;
  const keyring = { ethereumTransaction: sdk };
  wallet.getActiveKeyring = () => keyring;
  wallet.getWalletSetupStatus = () => undefined;
  wallet.assertWalletReadyForSigning = () => undefined;
  wallet.captureFreshEvmRead = () => ({});
  wallet.inspectOrdinaryEvmNonce = async () => ({ nonce: 0 });
  wallet.assertCurrentWalletSession = jest.fn();
  const dispatch = jest.fn(async () => undefined);
  const request = {},
    authorizeDapp = () => undefined;
  let id = '';
  const bind = () => {
    consumeGenericEvmFeeReview(
      wallet,
      id,
      context,
      authorizeDapp,
      Math.floor(performance.now()),
      { kind: 'dapp', request }
    );
    bindGenericEvmFeeDispatch(wallet, id, context, dispatch, null);
  };
  const review: EvmDappReview<IEvmTransactionResponse> = Object.freeze({
    feeComparison: { recommendationOnly: true },
    transaction,
    maximumFeeUnits: '180000',
    maximumTotalUnits: '180000',
    coveredFeeUnits: '0',
    expiresAtMonotonicMilliseconds: Math.floor(performance.now()) + 90_000,
    async submit() {
      bindGenericEvmFeeDispatch(wallet, id, context, dispatch, null);
      return wallet.sendAndSaveEthTransaction(
        transaction,
        false,
        undefined,
        undefined,
        {
          authorizeDapp,
          dappApprovalOwner: request,
          expectedContext: context,
          genericDispatchId: id,
          clearNavigation: false,
          dappNonceApproval: nonce,
        }
      );
    },
  });
  id = issueGenericEvmFeeReview(
    wallet,
    review,
    context,
    nonce,
    authorizeDapp,
    Math.floor(performance.now()),
    { kind: 'dapp', request },
    () => 'review-one'
  ).id;
  return {
    wallet,
    keyring,
    dispatch,
    bind,
    send,
    submitHardware: () =>
      wallet.sendAndSaveEthTransaction(
        transaction,
        false,
        undefined,
        undefined,
        {
          hardwareScope: {
            account: 'hardware-owner',
            network: 'hardware-network',
          },
        }
      ),
    submit: (input = transaction, token: string | null = id) =>
      wallet.sendAndSaveEthTransaction(input, false, undefined, undefined, {
        authorizeDapp,
        dappApprovalOwner: request,
        expectedContext: context,
        ...(token === null
          ? {}
          : {
              genericReviewId: token,
              submission: { kind: 'transaction' as const },
            }),
      }),
  };
}

afterEach(() => jest.restoreAllMocks());

it('a raw error after entering SDK stays unknown through the outer consumed-review route', async () => {
  const f = fixture(new Error('response timed out'));
  await expect(f.submit()).rejects.toMatchObject({
    transactionNotBroadcast: false,
  });
  expect(f.send).toHaveBeenCalledTimes(1);
  expect(clearTransactionNavigationState).not.toHaveBeenCalled();
});

it('uses one generic admission for nonce and affordability after signing', async () => {
  const f = fixture(new Error('stop after binding'));
  f.bind();
  const records = {
    captureSession: (session: unknown) => session,
    autoNonceAcceptance: { track: () => () => undefined },
    withReplayAdmission: jest.fn(
      async (_session, _identity, admit, _preceding, preflight) => {
        await preflight.run('owned', () => ({ owner: 'owned' }));
        return admit();
      }
    ),
  };
  f.wallet.getRetainedEvmRecords = () => records;
  f.wallet.captureFreshEvmRead = () => ({
    keyring: f.keyring,
    network: { url: context.rpcUrl },
  });
  const duplicatePlan = jest
    .spyOn(f.wallet, 'inspectOrdinaryEvmNonce')
    .mockRejectedValue(new Error('Duplicate nonce plan'));
  const unsigned = Transaction.from({
    type: 2,
    chainId: 57,
    nonce: 0,
    to: transaction.to,
    value: 0,
    gasLimit: 60000,
    maxFeePerGas: 3,
    maxPriorityFeePerGas: 1,
    data: transaction.data,
  });
  const lifecycle = f.wallet.captureEvmSignedSubmission(f.keyring, {
    account: context.account,
    network: { kind: 'ethereum', chainId: 57, slip44: 60, url: context.rpcUrl },
    operation: 'send',
    walletNonce: nonce,
    review: { id: 'review-one', unsignedHash: unsigned.unsignedHash },
  });
  await lifecycle.dispatchSigned(
    {
      hash: '0x' + '11'.repeat(32),
      rawTransaction: unsigned.unsignedSerialized,
      chainId: '57',
      from: address,
      nonce: 0,
      context: {
        operation: 'send',
        network: {
          kind: 'ethereum',
          chainId: 57,
          url: context.rpcUrl,
          slip44: 60,
        },
      },
    },
    async () => undefined,
    async () => undefined
  );
  expect(f.dispatch).toHaveBeenCalledTimes(1);
  expect(duplicatePlan).not.toHaveBeenCalled();
});

it.each([KeyringAccountType.Ledger, KeyringAccountType.Trezor])(
  'lets the generic review select the initial %s nonce once',
  async (type) => {
    const f = fixture(new Error('not submitted'));
    const state = store.getState();
    jest.spyOn(store, 'getState').mockReturnValue({
      ...state,
      vault: {
        ...state.vault,
        activeAccount: { id: 0, type },
        accounts: { [type]: { 0: { address } } },
      },
    } as any);
    const assertCurrent = jest.fn();
    f.wallet.captureFreshEvmRead = () => ({
      network: state.vault.activeNetwork,
      assertCurrent,
    });
    const duplicate = jest
      .spyOn(f.wallet, 'inspectOrdinaryEvmNonce')
      .mockRejectedValue(new Error('Duplicate nonce selection'));
    const prepare = jest
      .spyOn(f.wallet, 'prepareGenericEvmFeeReview')
      .mockResolvedValue({ token: { id: 'hardware-fee' } });
    const input = {
      from: address,
      to: transaction.to,
      value: '0x0',
      data: '0x',
    };
    await expect(
      f.wallet.reviewWalletEvmFee(input, {
        account: 'owner',
        network: 'network',
      })
    ).resolves.toEqual({ id: 'hardware-fee' });
    expect(duplicate).not.toHaveBeenCalled();
    expect(prepare.mock.calls[0][2]).toBeUndefined();
    expect(prepare.mock.calls[0][0]).not.toHaveProperty('nonce');
  }
);

it('an explicit SDK preflight refusal remains definitely unsent', async () => {
  const f = fixture(
    Object.assign(new Error('fee changed'), { transactionNotBroadcast: true })
  );
  await expect(f.submit()).rejects.toMatchObject({
    transactionNotBroadcast: true,
  });
  expect(f.send).toHaveBeenCalledTimes(1);
  expect(clearTransactionNavigationState).not.toHaveBeenCalled();
});

it('a changed envelope before invoking SDK is definitely unsent', async () => {
  const f = fixture(new Error('must not run'));
  await expect(f.submit({ ...transaction, value: '1' })).rejects.toMatchObject({
    transactionNotBroadcast: true,
  });
  expect(f.send).not.toHaveBeenCalled();
});

it('omitting the fee review cannot enter a dapp specialized send', async () => {
  const f = fixture(new Error('must not run'));
  await expect(f.submit(transaction, null)).rejects.toMatchObject({
    transactionNotBroadcast: true,
  });
  expect(f.send).not.toHaveBeenCalled();
});

it('an empty provided fee review ID cannot fall through to specialized signing', async () => {
  const f = fixture(new Error('must not run'));
  await expect(f.submit(transaction, '')).rejects.toMatchObject({
    transactionNotBroadcast: true,
  });
  expect(f.send).not.toHaveBeenCalled();
});

it('omitting the fee review cannot enter a hardware specialized send', async () => {
  const f = fixture(new Error('must not run'));
  await expect(f.submitHardware()).rejects.toMatchObject({
    transactionNotBroadcast: true,
  });
  expect(f.send).not.toHaveBeenCalled();
});
