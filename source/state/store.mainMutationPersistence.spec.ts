import { INetwork, INetworkType } from 'types/network';

import { walletPersistenceGate } from './paliStorage';
import { setPrices } from './price';
import store, {
  persistAdvancedSetting,
  persistFiatCurrency,
  persistMainStateStrict,
  persistNetworkRegistry,
  saveMainState,
} from './store';
import {
  setAdvancedSettings,
  setHasEthProperty,
  setNetworks,
} from './vaultGlobal';

const originalChrome = global.chrome;
const network: INetwork = {
  chainId: 31337,
  kind: INetworkType.Ethereum,
  label: 'Staged synthetic network',
  currency: 'test',
  slip44: 60,
  url: 'https://staged.synthetic.invalid',
};
const scenarios: {
  commit: (current: () => boolean, sameWallet?: () => boolean) => Promise<void>;
  error: string;
  expected: unknown;
  name: string;
  read: (state: any) => any;
}[] = [
  {
    name: 'advanced setting',
    error: 'Wallet state changed before saving settings',
    commit: (current) => persistAdvancedSetting('autolock', 10, current),
    read: (state: any) => state.vaultGlobal.advancedSettings.autolock,
    expected: 10,
  },
  {
    name: 'currency',
    error: 'Wallet state changed before saving currency',
    commit: (current) => persistFiatCurrency('eur', current),
    read: (state: any) => state.price.fiat,
    expected: { asset: 'eur', price: 0 },
  },
  {
    name: 'network registry',
    error: 'Synthetic network context changed',
    commit: (current: () => boolean, sameWallet = () => true) =>
      persistNetworkRegistry(
        network,
        false,
        () => {
          if (!current()) throw new Error('Synthetic network context changed');
        },
        sameWallet
      ),
    read: (state: any) => state.vaultGlobal.networks.ethereum[31337],
    expected: network,
  },
];

let records: Record<string, any>;
let writes: number;
const clone = <T>(value: T): T => structuredClone(value);
const holdWrite = () => {
  const original = chrome.storage.local.set;
  let resolve!: (fail?: boolean) => void;
  let entered!: () => void;
  const started = new Promise<void>((done) => (entered = done));
  let captured = false;
  jest
    .spyOn(chrome.storage.local, 'set')
    .mockImplementation((items, callback) => {
      if (captured) return original(items, callback);
      captured = true;
      const snapshot = clone(items);
      resolve = (fail = false) => {
        if (fail) {
          writes += 1;
          (chrome.runtime as any).lastError = {
            message: 'Synthetic storage refusal',
          };
          callback?.();
          delete (chrome.runtime as any).lastError;
        } else original(snapshot, callback);
      };
      entered();
    });
  return { started, finish: (fail = false) => resolve(fail) };
};

beforeEach(async () => {
  records = {};
  writes = 0;
  walletPersistenceGate.blocked = false;
  global.chrome = {
    runtime: { id: 'synthetic-main-mutation' },
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
  store.dispatch(setHasEthProperty(false));
  store.dispatch(
    setAdvancedSettings({ advancedProperty: 'autolock', value: 5 })
  );
  store.dispatch(
    setAdvancedSettings({ advancedProperty: 'refresh', value: true })
  );
  store.dispatch(setPrices({ asset: 'usd', price: 42 }));
  store.dispatch(setNetworks({ ethereum: {}, syscoin: {} }));
  await persistMainStateStrict();
  writes = 0;
});

afterEach(() => {
  walletPersistenceGate.blocked = false;
  jest.restoreAllMocks();
  global.chrome = originalChrome;
});

describe.each(scenarios)('$name shared staged-main boundary', (scenario) => {
  it.each([false, true])(
    'keeps a held write unpublished and preserves queued unrelated changes, refusal=%s',
    async (refused) => {
      const before = clone(scenario.read(store.getState()));
      const held = holdWrite();
      const operation = scenario.commit(() => true);
      const completion = refused
        ? expect(operation).rejects.toMatchObject({
            message: 'Synthetic storage refusal',
          })
        : expect(operation).resolves.toBeUndefined();
      await held.started;
      expect(scenario.read(store.getState())).toEqual(before);
      expect(scenario.read(records.state)).toEqual(before);
      store.dispatch(setHasEthProperty(true));
      const background = saveMainState();
      held.finish(refused);
      await completion;
      await expect(background).resolves.toBe(true);
      expect(scenario.read(store.getState())).toEqual(
        refused ? before : scenario.expected
      );
      expect(scenario.read(records.state)).toEqual(
        refused ? before : scenario.expected
      );
      expect(records.state.vaultGlobal.hasEthProperty).toBe(true);
      expect(store.getState().vaultGlobal.hasEthProperty).toBe(true);
      expect(records.state.dapp).toEqual(store.getState().dapp);
      expect(writes).toBe(2);
    }
  );

  it('repairs a completed invalidated write before releasing a queued save', async () => {
    const before = clone(scenario.read(store.getState()));
    const held = holdWrite();
    let current = true;
    const operation = scenario.commit(() => current);
    const rejected = expect(operation).rejects.toThrow(scenario.error);
    await held.started;
    current = false;
    store.dispatch(setHasEthProperty(true));
    const background = saveMainState();
    held.finish();
    await rejected;
    await background;
    expect(scenario.read(store.getState())).toEqual(before);
    expect(scenario.read(records.state)).toEqual(before);
    expect(records.state.vaultGlobal.hasEthProperty).toBe(true);
    expect(writes).toBe(2);
  });

  it('preserves the exact stale-admission error and performs no native write', async () => {
    await expect(scenario.commit(() => false)).rejects.toThrow(scenario.error);
    expect(writes).toBe(0);
  });

  it('does not repair over a recovery-owned snapshot when the gate closes during native IO', async () => {
    const before = clone(scenario.read(store.getState()));
    const held = holdWrite();
    const operation = scenario.commit(() => true);
    const rejected = expect(operation).rejects.toThrow(
      'Wallet recovery must finish before saving state'
    );
    await held.started;
    walletPersistenceGate.blocked = true;
    held.finish();
    await rejected;
    expect(scenario.read(store.getState())).toEqual(before);
    expect(writes).toBe(1);
  });
});

it('serializes all three wrappers without losing earlier committed values', async () => {
  const held = holdWrite();
  const setting = scenarios[0].commit(() => true);
  await held.started;
  const currency = scenarios[1].commit(() => true);
  const registry = scenarios[2].commit(() => true);
  held.finish();
  await Promise.all([setting, currency, registry]);
  for (const scenario of scenarios) {
    expect(scenario.read(store.getState())).toEqual(scenario.expected);
    expect(scenario.read(records.state)).toEqual(scenario.expected);
  }
  expect(writes).toBe(3);
});

it('keeps a replaced-wallet network write unpublished without the default preference repair', async () => {
  const held = holdWrite();
  let current = true;
  const operation = scenarios[2].commit(
    () => current,
    () => current
  );
  const rejected = expect(operation).rejects.toThrow(scenarios[2].error);
  await held.started;
  current = false;
  store.dispatch(setHasEthProperty(true));
  const replacementSave = saveMainState();
  held.finish();
  await rejected;
  await replacementSave;
  expect(scenarios[2].read(store.getState())).toBeUndefined();
  expect(scenarios[2].read(records.state)).toBeUndefined();
  expect(records.state.vaultGlobal.hasEthProperty).toBe(true);
  expect(writes).toBe(2);
});

it.each([
  ['refresh', false],
  ['ledger', true],
  ['autolock', 0],
  ['autolock', 10],
] as const)(
  'preserves exact advanced setting type/value for %s=%s',
  async (property, value) => {
    await persistAdvancedSetting(property, value, () => true);
    expect(store.getState().vaultGlobal.advancedSettings[property]).toBe(value);
    expect(records.state.vaultGlobal.advancedSettings[property]).toBe(value);
    expect(writes).toBe(1);
  }
);
