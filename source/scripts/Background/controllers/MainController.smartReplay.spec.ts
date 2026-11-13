/** @jest-environment node */
jest.mock('..', () => ({ getController: jest.fn(), notificationManager: {} }));
jest.mock('./providers/patchFetchWithPaliHeaders', () => ({
  patchFetchWithPaliHeaders: jest.fn(),
}));
jest.mock('@sidhujag/sysweb3-keyring', () => ({
  KeyringManager: jest.fn(),
  CustomJsonRpcProvider: jest.fn(),
  PsbtUtils: {},
}));
jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    getState: () => mockState,
    dispatch: jest.fn(),
    subscribe: jest.fn(() => () => undefined),
  },
}));
jest.mock('utils/navigationState', () => ({
  getWalletNavigationScope: () => ({
    account: String(mockState.vault.activeAccount.id),
    network: mockState.vault.activeNetwork.url,
  }),
}));

import { SoftwareKeyring } from '@sidhujag/sysweb3-keyring/cjs/software.js';
import { webcrypto } from 'crypto';
import { Transaction } from 'ethers/transaction';
import { Wallet } from 'ethers/wallet';

import { EvmSignedRecords } from '../../../wallet/evmSignedRecords';
import { encodeERC7579Executions } from 'utils/smartAccount/account';
import {
  getPaliEntryPointAddress,
  paliEntryPointInterface,
  paliSmartAccountInterface,
} from 'utils/smartAccount/contracts';

import MainController from './MainController';

const smart = '0x' + '11'.repeat(20),
  recipient = '0x' + '22'.repeat(20);
const payer = new Wallet('0x' + '33'.repeat(32));
const blockHash = '0x' + '44'.repeat(32);
let mockState: any;

async function fixture(nonce = 0) {
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: webcrypto,
  });
  mockState = {
    vault: {
      isBitcoinBased: false,
      activeAccount: { id: 1, type: 'SmartAccount' },
      activeNetwork: {
        kind: 'ethereum',
        chainId: 1,
        slip44: 60,
        url: 'https://rpc.invalid',
      },
      accounts: {
        SmartAccount: { 1: { address: smart, isSmartAccount: true } },
        HDAccount: { 0: { address: payer.address } },
      },
    },
    vaultGlobal: { activeSlip44: 60 },
  };
  const keyring: any = Object.create(SoftwareKeyring.prototype);
  keyring.sessionPassword = { isCleared: () => false };
  keyring.sessionMnemonic = { isCleared: () => false };
  keyring.privateRecordSessionRevision = 0;
  keyring.getDecryptedMnemonic = () =>
    'public deterministic Smart replay fixture';
  let disk: string | undefined;
  const records = new EvmSignedRecords(
    {
      async read() {
        return disk;
      },
      async compareAndSet(_id, previous, next, check) {
        check();
        if (disk !== previous) return false;
        disk = next;
        return true;
      },
    },
    () => 1000
  );
  const broadcasts: string[] = [];
  const provider = {
    _send: jest.fn(async () => [{ jsonrpc: '2.0', id: 0, result: '0x1' }]),
    send: jest.fn(async (method: string, params: unknown[]) => {
      if (method === 'eth_chainId') return '0x1';
      if (method === 'eth_getTransactionCount') return '0x0';
      if (method === 'eth_getTransactionReceipt') return null;
      if (method === 'eth_getBlockByNumber')
        return { number: '0x10', hash: blockHash, gasLimit: '0x100000' };
      if (method === 'eth_sendRawTransaction') {
        broadcasts.push(String(params[0]));
        return Transaction.from(String(params[0])).hash;
      }
      throw new Error(method);
    }),
  };
  keyring.ethereumTransaction = { web3Provider: provider };
  const wallet: any = Object.create(MainController.prototype);
  wallet.walletSessionGeneration = 1;
  wallet.networkRequestGeneration = 1;
  wallet.assertWalletReadyForSigning = () => undefined;
  wallet.assertCurrentWalletSession = (generation: number) => {
    if (generation !== wallet.walletSessionGeneration)
      throw new Error('Session changed');
  };
  wallet.getActiveKeyring = () => keyring;
  wallet.getRetainedEvmRecords = () => records;
  wallet.captureFreshEvmRead = () => {
    const generation = wallet.walletSessionGeneration,
      url = mockState.vault.activeNetwork.url;
    const check = () => {
      if (
        generation !== wallet.walletSessionGeneration ||
        url !== mockState.vault.activeNetwork.url
      )
        throw new Error('Context changed');
    };
    return {
      keyring,
      network: { ...mockState.vault.activeNetwork },
      assertCurrent: check,
      run: async (read: any) => {
        check();
        const result = await read(provider);
        check();
        return result;
      },
    };
  };
  const session = { keyring, assertCurrent: () => undefined };
  const encoded = encodeERC7579Executions([{ target: recipient, value: '9' }]);
  const operation = {
    sender: smart,
    nonce: 7,
    initCode: '0x',
    callData: paliSmartAccountInterface.encodeFunctionData('execute', [
      encoded.mode,
      encoded.executionCalldata,
    ]),
    accountGasLimits:
      '0x' + '00'.repeat(12) + '000186a0' + '00'.repeat(12) + '000186a0',
    preVerificationGas: 21000,
    gasFees: '0x' + '00'.repeat(15) + '01' + '00'.repeat(15) + '03',
    paymasterAndData: '0x',
    signature: '0x1234',
  };
  let predecessor: string | undefined;
  if (nonce > 0) {
    predecessor = await payer.signTransaction({
      chainId: 1,
      nonce: 0,
      type: 0,
      gasPrice: 2,
      gasLimit: 21000,
      to: recipient,
      value: 1,
    });
    const previous = Transaction.from(predecessor);
    await records.append(session, {
      rawTransaction: predecessor,
      hash: previous.hash!,
      from: payer.address,
      chainId: '1',
      nonce: 0,
      type: 0,
      context: {
        account: { id: 0, type: 'HDAccount', address: payer.address },
        network: mockState.vault.activeNetwork,
        operation: 'send',
      },
    });
  }
  const rawTransaction = await payer.signTransaction({
    chainId: 1,
    nonce,
    type: 0,
    gasPrice: 2,
    gasLimit: 300000,
    value: 0,
    to: getPaliEntryPointAddress(1),
    data: paliEntryPointInterface.encodeFunctionData('handleOps', [
      [operation],
      payer.address,
    ]),
  });
  const tx = Transaction.from(rawTransaction);
  await records.append(session, {
    rawTransaction,
    hash: tx.hash!,
    from: payer.address,
    chainId: '1',
    nonce,
    type: 0,
    context: {
      account: { id: 0, type: 'HDAccount', address: payer.address },
      network: mockState.vault.activeNetwork,
      operation: 'send',
    },
  });
  return {
    wallet,
    records,
    session,
    provider,
    broadcasts,
    rawTransaction,
    hash: tx.hash!,
    predecessor,
  };
}

it('finds metadata-free Smart operations and replays exact bytes through the recorded local payer', async () => {
  const f = await fixture();
  const page = await f.wallet.getSavedEvmTransactions();
  expect(page.transactions).toHaveLength(1);
  expect(page.transactions[0].smartAccount.account.toLowerCase()).toBe(smart);
  const saved = await f.wallet.getSavedEvmTransaction(f.hash);
  expect(saved.smartAccount.transfer).toMatchObject({
    recipient,
    amountUnits: '9',
  });
  const prepared = await f.wallet.prepareEvmSignedReplay(f.hash);
  expect(prepared.status).toBe('review');
  expect(prepared.review.from.toLowerCase()).toBe(payer.address.toLowerCase());
  await expect(
    f.wallet.confirmEvmSignedReplay(prepared.review.id)
  ).resolves.toMatchObject({ status: 'submitted', hash: f.hash });
  expect(f.broadcasts).toEqual([f.rawTransaction]);
});

it.each(['selected', 'payer', 'network', 'session'] as const)(
  'refuses %s drift after Smart replay review',
  async (change) => {
    const f = await fixture();
    const prepared = await f.wallet.prepareEvmSignedReplay(f.hash);
    expect(prepared.status).toBe('review');
    if (change === 'selected')
      mockState.vault.accounts.SmartAccount[1] = { address: recipient };
    if (change === 'payer')
      mockState.vault.accounts.HDAccount[0] = { address: recipient };
    if (change === 'network')
      mockState.vault.activeNetwork.url = 'https://other.invalid';
    if (change === 'session') f.wallet.walletSessionGeneration += 1;
    await expect(
      f.wallet.confirmEvmSignedReplay(prepared.review.id)
    ).rejects.toThrow();
    expect(f.broadcasts).toEqual([]);
    expect(
      (await f.records.readExact(f.session, '1', payer.address, f.hash))
        ?.rawTransaction
    ).toBe(f.rawTransaction);
  }
);

it('uses ordinary payer history when that EOA is selected', async () => {
  const f = await fixture();
  mockState.vault.activeAccount = { id: 0, type: 'HDAccount' };
  const saved = await f.wallet.getSavedEvmTransaction(f.hash);
  expect(saved.from.toLowerCase()).toBe(payer.address.toLowerCase());
  expect(saved).not.toHaveProperty('smartAccount');
});

it('opens an earlier EOA payer transaction only through its current Smart parent review', async () => {
  const f = await fixture(1);
  const predecessor = Transaction.from(f.predecessor!);
  expect(await f.wallet.getSavedEvmTransaction(predecessor.hash)).toBeNull();
  const parent = await f.wallet.prepareEvmSignedReplay(f.hash);
  expect(parent.status).toBe('review');
  const page = await f.wallet.getSmartAccountPredecessors(parent.review.id);
  expect(page.transactions.map((entry: any) => entry.hash)).toContain(
    predecessor.hash
  );
  const prior = await f.wallet.prepareSmartAccountPredecessor(
    parent.review.id,
    predecessor.hash
  );
  expect(prior.status).toBe('review');
  expect(prior.review).not.toHaveProperty('smartAccount');
  expect(prior.review.to.toLowerCase()).toBe(recipient);
  expect(prior.review.value).toBe('1');
  await expect(
    f.wallet.confirmEvmSignedReplay(prior.review.id)
  ).resolves.toMatchObject({ status: 'submitted', hash: predecessor.hash });
  expect(f.broadcasts).toEqual([f.predecessor]);
});

it('cancels Smart replay without broadcasting or changing saved bytes', async () => {
  const f = await fixture();
  const prepared = await f.wallet.prepareEvmSignedReplay(f.hash);
  f.wallet.cancelEvmSignedReplay(prepared.review.id);
  expect(() => f.wallet.confirmEvmSignedReplay(prepared.review.id)).toThrow();
  expect(f.broadcasts).toEqual([]);
});
