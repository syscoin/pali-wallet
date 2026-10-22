jest.mock('..', () => ({
  getController: jest.fn(),
  notificationManager: { cleanup: jest.fn() },
}));
jest.mock('./providers/patchFetchWithPaliHeaders', () => ({
  patchFetchWithPaliHeaders: jest.fn(),
}));
jest.mock('utils/syscoinPsbtValues', () => ({}));
jest.mock('@sidhujag/sysweb3-keyring', () => ({
  KeyringManager: jest.fn(),
  CustomJsonRpcProvider: jest.fn(),
  PsbtUtils: {},
}));

import { loadState, walletPersistenceGate } from 'state/paliStorage';
import store, { persistMainStateStrict } from 'state/store';
import { setNetworks } from 'state/vaultGlobal';
import { INetwork, INetworkType } from 'types/network';
import { networkRegistrationFingerprint } from 'utils/networkRegistration';

import MainController from './MainController';

const originalChrome = global.chrome;
const originalFetch = globalThis.fetch;
const source: INetwork = {
  chainId: 1,
  kind: INetworkType.Ethereum,
  slip44: 60,
  label: 'Active synthetic chain',
  currency: 'eth',
  url: 'https://current.synthetic.invalid',
};
const target: INetwork = {
  ...source,
  chainId: 31337,
  label: 'Custom synthetic chain',
  currency: 'tst',
  url: 'https://custom.synthetic.invalid',
};
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
let wallet: any;
let records: Record<string, any>;
let writes: number;

beforeEach(async () => {
  jest.useFakeTimers();
  jest.spyOn(console, 'log').mockImplementation();
  jest.spyOn(console, 'warn').mockImplementation();
  walletPersistenceGate.blocked = false;
  records = {};
  writes = 0;
  globalThis.fetch = jest.fn(async () => {
    throw new Error('No network access is permitted in this registry test');
  });
  global.chrome = {
    runtime: { id: 'synthetic-network-required-fields' },
    storage: {
      local: {
        get: (keys: string[], callback: (value: any) => void) =>
          callback(
            Object.fromEntries(
              keys
                .filter((key) => key in records)
                .map((key) => [key, clone(records[key])])
            )
          ),
        set: (items: Record<string, any>, callback: () => void) => {
          writes += 1;
          Object.assign(records, clone(items));
          callback();
        },
      },
    },
  } as any;
  store.dispatch(setNetworks({ ethereum: { 1: source }, syscoin: {} }));
  wallet = Object.create(MainController.prototype);
  wallet.walletStateGeneration = 0;
  wallet.walletSessionGeneration = 0;
  wallet.isRemovingNetwork = false;
  wallet.resetAutoLockTimer = jest.fn();
  wallet.evmAssetsController = {
    detectCoinGeckoIds: jest.fn().mockResolvedValue(null),
  };
  await persistMainStateStrict();
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
  global.chrome = originalChrome;
  globalThis.fetch = originalFetch;
});

type Mode = 'add' | 'edit';
const prepare = async (mode: Mode, network = target) => {
  if (mode === 'edit') {
    store.dispatch(
      setNetworks({
        ethereum:
          network.kind === INetworkType.Ethereum
            ? { 1: source, [network.chainId]: network }
            : { 1: source },
        syscoin:
          network.kind === INetworkType.Syscoin
            ? { [network.chainId]: network }
            : {},
      })
    );
    await persistMainStateStrict();
  }
  writes = 0;
  return (proposal: INetwork) =>
    mode === 'add'
      ? wallet.addCustomRpc(proposal)
      : wallet.editCustomRpc(proposal, networkRegistrationFingerprint(network));
};

describe.each(['add', 'edit'] as const)(
  '%s network required fields',
  (mode) => {
    it.each([
      ['label', '   '],
      ['label', '\u00a0\u00a0'],
      ['currency', '   '],
      ['currency', '\u00a0\u00a0'],
    ])(
      'refuses a whitespace-only %s at the durable boundary',
      async (field, value) => {
        const invoke = await prepare(mode);
        const before = clone(store.getState().vaultGlobal.networks);
        await expect(invoke({ ...target, [field]: value })).rejects.toThrow(
          'Missing required network configuration fields'
        );
        expect(store.getState().vaultGlobal.networks).toEqual(before);
        expect((await loadState()).vaultGlobal.networks).toEqual(before);
        expect(writes).toBe(0);
        expect(globalThis.fetch).not.toHaveBeenCalled();
      }
    );

    it('preserves meaningful padded label and symbol bytes', async () => {
      const invoke = await prepare(mode);
      const proposal = {
        ...target,
        label: '  Family chain  ',
        currency: ' tst ',
      };
      await invoke(proposal);
      expect(store.getState().vaultGlobal.networks.ethereum[31337]).toEqual({
        ...proposal,
        ...(mode === 'add' ? { default: false } : {}),
      });
      expect((await loadState()).vaultGlobal.networks.ethereum[31337]).toEqual(
        store.getState().vaultGlobal.networks.ethereum[31337]
      );
      expect(writes).toBe(1);
    });

    it.each([undefined, null, '', 57])(
      'refuses missing or non-string required UTXO currency %j',
      async (currency) => {
        const utxo = {
          ...target,
          kind: INetworkType.Syscoin,
          chainId: 111,
          slip44: 111,
          currency: 'sys',
        } as unknown as INetwork;
        const invoke = await prepare(mode, utxo);
        const before = clone(store.getState().vaultGlobal.networks);
        await expect(invoke({ ...utxo, currency } as INetwork)).rejects.toThrow(
          'Missing required network configuration fields'
        );
        expect(store.getState().vaultGlobal.networks).toEqual(before);
        expect((await loadState()).vaultGlobal.networks).toEqual(before);
        expect(writes).toBe(0);
        expect(globalThis.fetch).not.toHaveBeenCalled();
      }
    );

    it('preserves meaningful padded UTXO display fields', async () => {
      const utxo = {
        ...target,
        kind: INetworkType.Syscoin,
        chainId: 111,
        slip44: 111,
        label: '  Synthetic UTXO  ',
        currency: ' sys ',
      };
      const invoke = await prepare(mode, utxo);
      await invoke(utxo);
      const live = store.getState().vaultGlobal.networks.syscoin[111];
      expect(live).toEqual({
        ...utxo,
        ...(mode === 'add' ? { default: false } : {}),
      });
      expect((await loadState()).vaultGlobal.networks.syscoin[111]).toEqual(
        live
      );
      expect(writes).toBe(1);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });
  }
);
