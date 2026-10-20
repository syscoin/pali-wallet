jest.unmock('syscoinjs-lib');
jest.unmock('tiny-secp256k1');
jest.mock('@trezor/connect-webextension', () => ({
  __esModule: true,
  default: { on: jest.fn(), dispose: jest.fn().mockResolvedValue(undefined) },
  DEVICE_EVENT: 'device-event',
}));
jest.mock('..', () => ({
  getController: jest.fn(),
  notificationManager: { cleanup: jest.fn() },
}));
jest.mock('./providers/patchFetchWithPaliHeaders', () => ({
  patchFetchWithPaliHeaders: jest.fn(),
}));

import { KeyringManager } from '@sidhujag/sysweb3-keyring';
import { AbiCoder, getCreate2Address, keccak256 } from 'ethers';
import http from 'http';
import https from 'https';

import { loadSlip44State, walletPersistenceGate } from 'state/paliStorage';
import store, { persistCommittedWalletState } from 'state/store';
import {
  createAccount,
  restoreVaultSnapshot,
  setActiveAccount,
  setNetworkChange,
} from 'state/vault';
import vaultCache from 'state/vaultCache';
import { setActiveSlip44 } from 'state/vaultGlobal';
import { INetworkType, KeyringAccountType } from 'types/network';
import { paliSmartAccountFactoryInterface } from 'utils/smartAccount';

import MainController from './MainController';
import SmartAccountController from './smartAccount';

const FAILURE = 'Synthetic smart account storage refusal';
const originalChrome = global.chrome;
let wallet: any;
let manager: KeyringManager;
let records: Record<string, any>;
let refuseNextCommit: boolean;
let factorySalts: string[];
let commits: number;
const projection = (vault: any) => ({
  active: vault.activeAccount,
  accounts: Object.values(vault.accounts.SmartAccount).map((account: any) => ({
    id: account.id,
    address: account.address,
    label: account.label,
    accountIndex: account.smartAccount.descriptor.accountIndex,
  })),
});

beforeEach(async () => {
  jest.useFakeTimers();
  const deny = () => {
    throw new Error('Smart creation must remain offline');
  };
  jest.spyOn(http, 'request').mockImplementation(deny);
  jest.spyOn(http, 'get').mockImplementation(deny);
  jest.spyOn(https, 'request').mockImplementation(deny);
  jest.spyOn(https, 'get').mockImplementation(deny);
  jest.spyOn(globalThis, 'fetch').mockImplementation(deny);
  jest.spyOn(console, 'log').mockImplementation();
  jest.spyOn(console, 'error').mockImplementation();
  walletPersistenceGate.blocked = false;
  vaultCache.clearCache();
  const groups = () =>
    Object.fromEntries(
      Object.values(KeyringAccountType).map((type) => [type, {}])
    );
  const accounts = groups();
  accounts.HDAccount[0] = {
    id: 0,
    address: '0x0000000000000000000000000000000000000001',
    xpub: 'public-anchor',
    label: 'Anchor',
  };
  store.dispatch(
    restoreVaultSnapshot({
      ...store.getState().vault,
      activeNetwork: {
        kind: INetworkType.Ethereum,
        slip44: 60,
        chainId: 1,
        url: 'https://smart-create.synthetic.invalid',
        currency: 'eth',
        label: 'Synthetic EVM',
      },
      activeAccount: { id: 0, type: KeyringAccountType.HDAccount },
      isBitcoinBased: false,
      accounts,
      accountAssets: groups(),
      accountTransactions: groups(),
    } as any)
  );
  store.dispatch(setActiveSlip44(60));
  records = {};
  refuseNextCommit = false;
  factorySalts = [];
  commits = 0;
  global.chrome = {
    runtime: { id: 'synthetic-smart-create' },
    storage: {
      local: {
        get: (keys: string[], callback: (result: any) => void) =>
          callback(
            Object.fromEntries(
              keys
                .filter((key) => key in records)
                .map((key) => [key, structuredClone(records[key])])
            )
          ),
        set: (items: Record<string, any>, callback: () => void) => {
          if (items['state-vault-60']) commits += 1;
          if (items['state-vault-60'] && refuseNextCommit) {
            refuseNextCommit = false;
            (chrome.runtime as any).lastError = { message: FAILURE };
            callback();
            delete (chrome.runtime as any).lastError;
            return;
          }
          Object.assign(records, structuredClone(items));
          callback();
        },
      },
    },
  } as any;
  await persistCommittedWalletState(true);
  commits = 0;
  manager = new KeyringManager();
  manager.setVaultStateGetter(() => store.getState().vault as any);
  wallet = Object.create(MainController.prototype);
  wallet.walletSessionGeneration = 0;
  wallet.walletStateGeneration = 0;
  wallet.getActiveKeyring = () => manager;
  wallet.resetAutoLockTimer = jest.fn();
  wallet.refreshActiveAccountLightweight = jest.fn();
  const abi = AbiCoder.defaultAbiCoder();
  // Only public read IO is synthetic. The real factory adapter encodes these
  // calls, the real controller derives each descriptor and the installed SDK
  // allocates the account ID. No signing or broadcasting is exposed.
  const provider = {
    sendBatch: async (_method: string, params: unknown[]) =>
      params.map(() => `0x${'11'.repeat(256)}`),
    call: async (transaction: { data: string; to: string }) => {
      const call = paliSmartAccountFactoryInterface.parseTransaction({
        data: transaction.data,
      });
      if (call.name === 'getInitData') {
        return paliSmartAccountFactoryInterface.encodeFunctionResult(
          call.fragment,
          [abi.encode(['address', 'bytes'], [call.args[0], call.args[1]])]
        );
      }
      if (call.name === 'getAddress') {
        factorySalts.push(call.args[0]);
        return paliSmartAccountFactoryInterface.encodeFunctionResult(
          call.fragment,
          [
            getCreate2Address(
              transaction.to,
              call.args[0],
              keccak256(call.args[1])
            ),
          ]
        );
      }
      throw new Error('Unexpected synthetic factory read');
    },
  };
  wallet.smartAccount = new SmartAccountController({
    getEthereumTransaction: () => ({ web3Provider: provider }),
    getWalletSessionGeneration: () => wallet.walletSessionGeneration,
  } as any);
});

afterEach(async () => {
  await manager.destroy();
  jest.clearAllTimers();
  jest.useRealTimers();
  vaultCache.clearCache();
  jest.restoreAllMocks();
  global.chrome = originalChrome;
});

const holdCommit = () => {
  const original = chrome.storage.local.set;
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => (entered = resolve));
  let captured = false;
  jest
    .spyOn(chrome.storage.local, 'set')
    .mockImplementation((items, callback) => {
      if (items['state-vault-60'] && !captured) {
        captured = true;
        const snapshot = structuredClone(items);
        release = () => original(snapshot, callback);
        entered();
      } else original(items, callback);
    });
  return { started, release: () => release() };
};

it('persists the ordinary derived smart account with the SDK-allocated ID and descriptor', async () => {
  const account = await wallet.createSmartAccount({ label: 'Smart savings' });
  expect(account.id).toBe(0);
  expect(account.smartAccount.descriptor.accountIndex).toBe(0);
  expect(factorySalts).toEqual([account.smartAccount.deploymentSalt]);
  expect(projection(await loadSlip44State(60))).toEqual(
    projection(store.getState().vault)
  );
  expect(
    (await loadSlip44State(60)).accounts.SmartAccount[0].smartAccount
  ).toEqual(account.smartAccount);
});

it('keeps a refused ordinary smart creation unpublished so same-form retry preserves index zero', async () => {
  const before = projection(store.getState().vault);
  refuseNextCommit = true;
  await expect(
    wallet.createSmartAccount({ label: 'Smart savings' })
  ).rejects.toMatchObject({ message: FAILURE });
  const afterRefusal = {
    live: projection(store.getState().vault),
    cold: projection(await loadSlip44State(60)),
  };
  // Both CreateAccount and PrepareSmartAccount retry this same public method
  // after a rejected reply; neither records a returned account on failure.
  const retry = await wallet.createSmartAccount({ label: 'Smart savings' });
  expect({
    afterRefusal,
    retry: {
      id: retry.id,
      accountIndex: retry.smartAccount.descriptor.accountIndex,
    },
    sameSalt: factorySalts[0] === factorySalts[1],
  }).toEqual({
    afterRefusal: { live: before, cold: before },
    retry: { id: 0, accountIndex: 0 },
    sameSalt: true,
  });
  expect(projection(await loadSlip44State(60))).toEqual(
    projection(store.getState().vault)
  );
  expect(projection(store.getState().vault).accounts).toHaveLength(1);
});

it('keeps a refused explicit-address smart record retryable through the same installed SDK path', async () => {
  const derived = await wallet.smartAccount.deriveSmartAccountRecord(0);
  const params = { ...derived, label: 'Explicit smart record' };
  const before = projection(store.getState().vault);
  refuseNextCommit = true;
  await expect(wallet.createSmartAccount(params)).rejects.toMatchObject({
    message: FAILURE,
  });
  const afterRefusal = projection(store.getState().vault);
  const retry = await wallet.createSmartAccount(params).then(
    (account: any) => ({ id: account.id }),
    (error: Error) => ({ error: error.message })
  );
  expect({ afterRefusal, retry }).toEqual({
    afterRefusal: before,
    retry: { id: 0 },
  });
  expect(projection(await loadSlip44State(60))).toEqual(
    projection(store.getState().vault)
  );
});

it('does not expose a smart record, cache entry or selection until its native write completes', async () => {
  const before = projection(store.getState().vault);
  const write = holdCommit();
  const creating = wallet.createSmartAccount({ label: 'Held smart account' });
  await write.started;
  expect(projection(store.getState().vault)).toEqual(before);
  expect(projection(await vaultCache.getSlip44Vault(60))).toEqual(before);
  expect(projection(await loadSlip44State(60))).toEqual(before);
  write.release();
  const account = await creating;
  expect(store.getState().vault.activeAccount).toEqual({
    id: account.id,
    type: KeyringAccountType.SmartAccount,
  });
  expect(
    (await loadSlip44State(60)).accounts.SmartAccount[account.id].smartAccount
  ).toEqual(account.smartAccount);
});

it.each(['account', 'chain', 'lock', 'keyring'] as const)(
  'repairs an unpublished smart record after the held-write %s scope is invalidated',
  async (change) => {
    const write = holdCommit();
    const creating = wallet.createSmartAccount({ label: 'Held smart account' });
    const rejected = expect(creating).rejects.toThrow('Wallet session changed');
    await write.started;
    if (change === 'keyring') {
      const replacement = new KeyringManager();
      replacement.setVaultStateGetter(() => store.getState().vault as any);
      wallet.getActiveKeyring = () => replacement;
    } else {
      // These are the session invalidations performed by setAccount,
      // switchActiveKeyring and lock; no unrelated async services are replaced.
      wallet.walletSessionGeneration += 1;
      if (change === 'account') {
        store.dispatch(
          createAccount({
            accountType: KeyringAccountType.HDAccount,
            account: {
              id: 1,
              address: '0x0000000000000000000000000000000000000002',
              xpub: 'other-public-anchor',
              label: 'Other anchor',
            } as any,
          })
        );
        store.dispatch(
          setActiveAccount({ id: 1, type: KeyringAccountType.HDAccount })
        );
      } else if (change === 'chain') {
        store.dispatch(
          setNetworkChange({
            activeNetwork: {
              ...store.getState().vault.activeNetwork,
              chainId: 5700,
              url: 'https://other-smart.synthetic.invalid',
            },
          })
        );
      } else vaultCache.clearCache();
    }
    const current = projection(store.getState().vault);
    write.release();
    await rejected;
    expect(projection(store.getState().vault)).toEqual(current);
    expect(projection(await loadSlip44State(60))).toEqual(current);
    expect(store.getState().vault.accounts.SmartAccount[0]).toBeUndefined();
    expect(commits).toBe(2);
    if (change === 'chain')
      expect((await loadSlip44State(60)).activeNetwork.chainId).toBe(5700);
    if (change === 'keyring') await wallet.getActiveKeyring().destroy();
  }
);

it('does not repair an old smart record over replacement-wallet ownership', async () => {
  const write = holdCommit();
  const creating = wallet.createSmartAccount({
    label: 'Old wallet smart account',
  });
  const rejected = expect(creating).rejects.toThrow('Wallet session changed');
  await write.started;
  wallet.walletSessionGeneration += 1;
  wallet.walletStateGeneration += 1;
  vaultCache.clearCache();
  write.release();
  await rejected;
  expect(commits).toBe(1);
  expect(store.getState().vault.accounts.SmartAccount[0]).toBeUndefined();
  // The reset owner, not the old operation, commits the replacement snapshot.
  await persistCommittedWalletState(true);
  expect((await loadSlip44State(60)).accounts.SmartAccount).toEqual({});
});

it('rejects an occupied SDK slot from a concurrent creation and permits a fresh retry', async () => {
  const write = holdCommit();
  const first = wallet.createSmartAccount({ label: 'First smart account' });
  await write.started;
  const second = wallet.createSmartAccount({
    label: 'Concurrent smart account',
  });
  const rejected = expect(second).rejects.toThrow(
    'Account creation conflicted with another request'
  );
  write.release();
  const winner = await first;
  await rejected;
  expect(projection(store.getState().vault).accounts).toEqual([
    {
      id: 0,
      accountIndex: 0,
      address: winner.address,
      label: 'First smart account',
    },
  ]);
  const retry = await wallet.createSmartAccount({
    label: 'Retried smart account',
  });
  expect(retry.id).toBe(1);
  expect(retry.address).not.toBe(winner.address);
  expect(projection(await loadSlip44State(60))).toEqual(
    projection(store.getState().vault)
  );
});

it('restores a refused attempt from cold storage before deriving the same first account', async () => {
  refuseNextCommit = true;
  await expect(
    wallet.createSmartAccount({ label: 'Cold retry' })
  ).rejects.toMatchObject({ message: FAILURE });
  const salt = factorySalts[0];
  vaultCache.clearCache();
  const cold = await loadSlip44State(60);
  store.dispatch(restoreVaultSnapshot(cold));
  const retry = await wallet.createSmartAccount({ label: 'Cold retry' });
  expect(retry.id).toBe(0);
  expect(retry.smartAccount.deploymentSalt).toBe(salt);
  expect(projection(await loadSlip44State(60))).toEqual(
    projection(store.getState().vault)
  );
});
