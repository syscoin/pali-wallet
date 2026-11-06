import { getSLHDSAStateStorageKey } from '../utils/slhDsa/constants';

import {
  createSlhDsaStateStore,
  createSLHDSAProvisionedState,
  type SlhDsaStateStorage,
} from './slhDsaState';

const keyId = 'public-slh-state-fixture';
const rowKey = getSLHDSAStateStorageKey(keyId);
const state = () =>
  createSLHDSAProvisionedState({
    accountIndex: 0,
    derivationLabel: 'public fixture',
    keyId,
    pkSeed: `0x${'11'.repeat(16)}${'00'.repeat(16)}`,
    pkRoot: `0x${'22'.repeat(16)}${'00'.repeat(16)}`,
    secretKeyHex: `0x${'33'.repeat(64)}`,
  });
const crypto = {
  encrypt: jest.fn(async (plain: string) => plain),
  decrypt: jest.fn(async (cipher: string) => cipher),
};
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

function fixture() {
  const rows = new Map<string, unknown>();
  let active = true;
  const assertOwner = () => {
    if (!active) throw new Error('retired key session');
  };
  const read: SlhDsaStateStorage['read'] = async (key) =>
    rows.has(key)
      ? { present: true, value: rows.get(key) }
      : { present: false };
  const write = jest.fn(async (key: string, value: unknown) => {
    rows.set(key, value);
  });
  const store = createSlhDsaStateStore({
    read,
    mutate: async (guard, run) => {
      guard();
      const result = await run({
        read,
        write,
        remove: async (key) => {
          rows.delete(key);
        },
      });
      guard();
      return result;
    },
  });
  return {
    store,
    rows,
    write,
    assertOwner,
    retire: () => {
      active = false;
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

it('retains the existing envelope and round trips the complete signer state', async () => {
  const f = fixture(),
    value = state();
  await f.store.save(value, crypto, f.assertOwner);
  expect(f.rows.get(rowKey)).toEqual({
    version: 1,
    keyId,
    updatedAt: expect.any(Number),
    cipherText: JSON.stringify(value),
  });
  expect(
    await f.store.load({ keyId, crypto, assertOwner: f.assertOwner })
  ).toEqual(value);
  await f.store.remove(keyId, f.assertOwner);
  expect(
    await f.store.load({ keyId, crypto, assertOwner: f.assertOwner })
  ).toBeNull();
});

it('distinguishes missing data from a present invalid envelope without overwriting', async () => {
  const f = fixture();
  f.rows.set(rowKey, undefined);
  await expect(
    f.store.load({ keyId, crypto, assertOwner: f.assertOwner })
  ).rejects.toThrow('usage history');
  expect(f.rows.has(rowKey)).toBe(true);
  expect(f.write).not.toHaveBeenCalled();
});

it('rejects envelope accessors without invoking them', async () => {
  const f = fixture(),
    getter = jest.fn();
  f.rows.set(rowKey, {
    version: 1,
    keyId,
    updatedAt: 1,
    get cipherText() {
      return getter();
    },
  });
  await expect(
    f.store.load({ keyId, crypto, assertOwner: f.assertOwner })
  ).rejects.toThrow('usage history');
  expect(getter).not.toHaveBeenCalled();
});

it('does not write after key-session retirement during encryption', async () => {
  const f = fixture(),
    entered = deferred<void>(),
    result = deferred<string>();
  const pending = f.store.save(
    state(),
    {
      encrypt: async (plain) => {
        entered.resolve();
        await result.promise;
        return plain;
      },
    },
    f.assertOwner
  );
  await entered.promise;
  f.retire();
  result.resolve('released');
  await expect(pending).rejects.toThrow('retired key session');
  expect(f.write).not.toHaveBeenCalled();
});

it('uses the bound key-session owner independently of retired UI consent', async () => {
  const f = fixture();
  let consentCurrent = true;
  await f.store.save(
    state(),
    {
      encrypt: async (plain) => {
        consentCurrent = false;
        return plain;
      },
    },
    f.assertOwner
  );
  expect(consentCurrent).toBe(false);
  expect(
    (await f.store.load({ keyId, crypto, assertOwner: f.assertOwner }))
      ?.signatureCount
  ).toBe(0);
});

it('requires a synchronous owner before reading or encrypting', async () => {
  const f = fixture();
  const owner = (() => Promise.resolve()) as unknown as () => void;
  await expect(
    f.store.load({ keyId, crypto, assertOwner: owner })
  ).rejects.toThrow('synchronous');
  await expect(f.store.save(state(), crypto, owner)).rejects.toThrow(
    'synchronous'
  );
  expect(crypto.encrypt).not.toHaveBeenCalled();
});
