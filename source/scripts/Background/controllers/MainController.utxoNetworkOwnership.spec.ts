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
jest.mock('utils/storageAPI', () => ({
  chromeStorage: {
    getItem: jest.fn(),
    getItems: jest.fn().mockResolvedValue({}),
    setItems: jest.fn().mockResolvedValue(undefined),
    removeItem: jest.fn(),
    setItem: jest.fn(),
  },
}));

import store from 'state/store';
import vaultCache from 'state/vaultCache';
import vaultGlobalReducer from 'state/vaultGlobal';
import { INetworkType } from 'types/network';
import { chromeStorage } from 'utils/storageAPI';

import MainController from './MainController';

const network = {
  chainId: 999,
  currency: 'TEST',
  kind: INetworkType.Syscoin,
  label: 'Test network A',
  slip44: 1,
  url: 'https://one.invalid',
};
const other = {
  ...network,
  chainId: 998,
  label: 'Test network B',
  url: 'https://two.invalid',
};
let state: any;
let wallet: any;

beforeEach(() => {
  state = {
    vault: { activeNetwork: { ...network, chainId: 57, slip44: 57 } },
    vaultGlobal: {
      activeSlip44: 57,
      networkStatus: 'idle',
      networks: { syscoin: {}, ethereum: {} },
    },
  };
  jest.spyOn(store, 'getState').mockImplementation(() => state);
  jest.spyOn(store, 'dispatch').mockImplementation((action: any) => {
    state = {
      ...state,
      vaultGlobal: vaultGlobalReducer(state.vaultGlobal, action),
    };
    return action;
  });
  jest.spyOn(vaultCache, 'clearSlip44FromCache').mockImplementation();
  jest.spyOn(console, 'log').mockImplementation();
  wallet = Object.create(MainController.prototype);
  wallet.isRemovingNetwork = false;
  wallet.resetAutoLockTimer = jest.fn();
  wallet.saveWalletState = jest.fn().mockResolvedValue(undefined);
  jest.mocked(chromeStorage.setItem).mockReset().mockResolvedValue(undefined);
  jest.mocked(chromeStorage.setItems).mockReset().mockResolvedValue(undefined);
  wallet.walletSessionGeneration = 0;
  wallet.walletStateGeneration = 0;
  wallet.keyrings = new Map([[1, { test: 'synthetic keyring' }]]);
  wallet.evmAssetsController = {
    detectCoinGeckoIds: jest.fn().mockResolvedValue(null),
  };
  jest
    .mocked(chromeStorage.removeItem)
    .mockReset()
    .mockResolvedValue(undefined);
});
afterEach(() => jest.restoreAllMocks());

it('allows distinct UTXO vaults and edits to the same registration', async () => {
  await wallet.addCustomRpc(network);
  await wallet.addCustomRpc({ ...other, slip44: 2 });
  const edited = { ...network, url: 'https://edited.invalid' };
  await expect(wallet.editCustomRpc(edited)).resolves.toEqual(edited);
  expect(state.vaultGlobal.networks.syscoin[999].url).toBe(edited.url);
  expect(Object.keys(state.vaultGlobal.networks.syscoin)).toHaveLength(2);
});

it('rejects a concurrent distinct-chain registration that would share a UTXO vault', async () => {
  let finish!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => (entered = resolve));
  jest.mocked(chromeStorage.setItem).mockImplementationOnce(async () => {
    entered();
    await new Promise<void>((resolve) => (finish = resolve));
  });
  const first = wallet.addCustomRpc(network);
  await started;
  const second = wallet.addCustomRpc(other);
  const rejected = expect(second).rejects.toThrow('UTXO network');
  expect(state.vaultGlobal.networks.syscoin[999]).toBeUndefined();
  finish();
  await expect(first).resolves.toMatchObject(network);
  await rejected;
  expect(state.vaultGlobal.networks.syscoin[998]).toBeUndefined();
  expect(chromeStorage.setItem).toHaveBeenCalledTimes(1);
});

it('rejects editing another registration into an already owned UTXO vault', async () => {
  await wallet.addCustomRpc(network);
  await wallet.addCustomRpc({ ...other, slip44: 2 });
  const before = JSON.stringify(state);
  const saves = jest.mocked(chromeStorage.setItem).mock.calls.length;
  await expect(wallet.editCustomRpc(other)).rejects.toThrow('UTXO network');
  expect(JSON.stringify(state)).toBe(before);
  expect(chromeStorage.setItem).toHaveBeenCalledTimes(saves);
});

it('keeps EVM chains independent of a shared BIP44 coin type', async () => {
  await wallet.addCustomRpc({
    ...network,
    kind: INetworkType.Ethereum,
    slip44: 60,
  });
  await wallet.addCustomRpc({
    ...other,
    kind: INetworkType.Ethereum,
    slip44: 60,
  });
  expect(Object.keys(state.vaultGlobal.networks.ethereum)).toHaveLength(2);
});

it('preserves a legacy shared vault for the surviving network and cleans it only after the last owner is removed', async () => {
  // Older releases could persist both registrations. Do not repair that by
  // erasing the shared wallet when the user removes one of them.
  state.vaultGlobal.networks.syscoin = { 999: network, 998: other };
  const sharedKeyring = wallet.keyrings.get(1);
  await wallet.removeKeyringNetwork(
    network.kind,
    network.chainId,
    network.url,
    network.label
  );
  expect(state.vaultGlobal.networks.syscoin[999]).toBeUndefined();
  expect(state.vaultGlobal.networks.syscoin[998]).toEqual(other);
  expect(chromeStorage.removeItem).not.toHaveBeenCalled();
  expect(vaultCache.clearSlip44FromCache).not.toHaveBeenCalled();
  expect(wallet.keyrings.get(1)).toBe(sharedKeyring);

  await wallet.removeKeyringNetwork(
    other.kind,
    other.chainId,
    other.url,
    other.label
  );
  expect(state.vaultGlobal.networks.syscoin[998]).toBeUndefined();
  expect(chromeStorage.setItems).toHaveBeenLastCalledWith(
    expect.objectContaining({
      'state-vault-1': null,
      'state-vault-1-passkey-profile': null,
    })
  );
  expect(vaultCache.clearSlip44FromCache).toHaveBeenCalledWith(1);
  expect(wallet.keyrings.has(1)).toBe(false);
});

it('removes an inactive legacy co-owner while preserving its active shared vault', async () => {
  state.vaultGlobal.networks.syscoin = { 999: network, 998: other };
  state.vault.activeNetwork = network;
  state.vaultGlobal.activeSlip44 = network.slip44;
  const sharedKeyring = wallet.keyrings.get(1);

  await wallet.removeKeyringNetwork(
    other.kind,
    other.chainId,
    other.url,
    other.label
  );

  expect(state.vaultGlobal.networks.syscoin[998]).toBeUndefined();
  expect(state.vaultGlobal.networks.syscoin[999]).toEqual(network);
  expect(state.vault.activeNetwork).toBe(network);
  expect(state.vaultGlobal.activeSlip44).toBe(network.slip44);
  expect(chromeStorage.removeItem).not.toHaveBeenCalled();
  expect(vaultCache.clearSlip44FromCache).not.toHaveBeenCalled();
  expect(wallet.keyrings.get(1)).toBe(sharedKeyring);
  expect(chromeStorage.setItems).toHaveBeenCalledTimes(1);
});

it('rejects the exact active network even when a legacy co-owner survives', async () => {
  state.vaultGlobal.networks.syscoin = { 999: network, 998: other };
  state.vault.activeNetwork = network;
  state.vaultGlobal.activeSlip44 = network.slip44;

  await expect(
    wallet.removeKeyringNetwork(
      network.kind,
      network.chainId,
      network.url,
      network.label
    )
  ).rejects.toThrow('currently active network');

  expect(state.vaultGlobal.networks.syscoin[999]).toEqual(network);
  expect(chromeStorage.removeItem).not.toHaveBeenCalled();
  expect(store.dispatch).not.toHaveBeenCalled();
  expect(wallet.saveWalletState).not.toHaveBeenCalled();
});

it('rejects the last owner of the active vault even if the displayed chain differs', async () => {
  state.vaultGlobal.networks.syscoin = { 999: network };
  state.vault.activeNetwork = other;
  state.vaultGlobal.activeSlip44 = network.slip44;

  await expect(
    wallet.removeKeyringNetwork(
      network.kind,
      network.chainId,
      network.url,
      network.label
    )
  ).rejects.toThrow('currently active network');

  expect(state.vaultGlobal.networks.syscoin[999]).toEqual(network);
  expect(chromeStorage.removeItem).not.toHaveBeenCalled();
  expect(vaultCache.clearSlip44FromCache).not.toHaveBeenCalled();
  expect(wallet.keyrings.has(1)).toBe(true);
  expect(store.dispatch).not.toHaveBeenCalled();
});
