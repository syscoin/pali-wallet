import { webcrypto } from 'crypto';

import { chromeStorage } from 'utils/storageAPI';

import {
  getSentryVaultId,
  listSentryKeys,
  loadSentryKey,
  removeSentryKey,
  saveSentryKey,
} from './keyStore';

jest.mock('utils/storageAPI', () => ({
  chromeStorage: { getItem: jest.fn(), setItem: jest.fn() },
}));

const records = new Map<string, unknown>();
const key = {
  role: 'operator' as const,
  scheme: 'bls-basic' as const,
  publicKey: '12'.repeat(48),
  secretKey: '34'.repeat(32),
};
const seed = 'synthetic seed for isolated Sentry storage tests';
const assertCurrent = jest.fn();

beforeEach(() => {
  Object.defineProperty(global, 'crypto', {
    value: webcrypto,
    configurable: true,
  });
  records.clear();
  jest.clearAllMocks();
  (chromeStorage.getItem as jest.Mock).mockImplementation(async (name) =>
    records.get(name)
  );
  (chromeStorage.setItem as jest.Mock).mockImplementation(async (name, value) =>
    records.set(name, JSON.parse(JSON.stringify(value)))
  );
});

it('stores authenticated ciphertext, never operator secrets or wallet seed', async () => {
  const vaultId = await getSentryVaultId('synthetic-xpub');
  const summary = await saveSentryKey({
    vaultId,
    network: 'testnet',
    label: 'Node one',
    key,
    seed,
    assertCurrent,
  });
  const serialized = JSON.stringify([...records.values()]);
  expect(serialized).not.toContain(key.secretKey);
  expect(serialized).not.toContain(seed);
  expect(await listSentryKeys(vaultId, 'testnet')).toEqual([summary]);
  expect(
    await loadSentryKey({
      vaultId,
      network: 'testnet',
      id: summary.id,
      seed,
      assertCurrent,
    })
  ).toEqual(key);
});

it('decrypts after Chrome storage reorders the authenticated summary properties', async () => {
  const vaultId = await getSentryVaultId('xpub-one');
  const summary = await saveSentryKey({
    vaultId,
    network: 'testnet',
    label: 'Reordered',
    key,
    seed,
    assertCurrent,
  });
  const stored = [...records.values()][0] as any;
  stored.keys[0].summary = Object.fromEntries(
    Object.entries(stored.keys[0].summary).sort(([a], [b]) =>
      a.localeCompare(b)
    )
  );
  expect(Object.keys(stored.keys[0].summary)).not.toEqual(Object.keys(summary));
  await expect(
    loadSentryKey({
      vaultId,
      network: 'testnet',
      id: summary.id,
      seed,
      assertCurrent,
    })
  ).resolves.toEqual(key);
});

it('isolates identical operator keys across networks and wallet vaults', async () => {
  const vaultId = await getSentryVaultId('xpub-one');
  await saveSentryKey({
    vaultId,
    network: 'mainnet',
    label: 'Main',
    key,
    seed,
    assertCurrent,
  });
  expect(await listSentryKeys(vaultId, 'testnet')).toEqual([]);
  expect(
    await listSentryKeys(await getSentryVaultId('xpub-two'), 'mainnet')
  ).toEqual([]);
});

it('rejects duplicates and metadata/ciphertext substitution', async () => {
  const vaultId = await getSentryVaultId('xpub-one');
  const summary = await saveSentryKey({
    vaultId,
    network: 'testnet',
    label: 'Node',
    key,
    seed,
    assertCurrent,
  });
  await expect(
    saveSentryKey({
      vaultId,
      network: 'testnet',
      label: 'Duplicate',
      key,
      seed,
      assertCurrent,
    })
  ).rejects.toThrow('already imported');
  const record: any = [...records.values()][0];
  record.keys[0].summary.label = 'Tampered label';
  await expect(
    loadSentryKey({
      vaultId,
      network: 'testnet',
      id: summary.id,
      seed,
      assertCurrent,
    })
  ).rejects.toThrow();
});

it('rejects the wrong seed and interrupted-session writes', async () => {
  const vaultId = await getSentryVaultId('xpub-one');
  const summary = await saveSentryKey({
    vaultId,
    network: 'testnet',
    label: 'Node',
    key,
    seed,
    assertCurrent,
  });
  await expect(
    loadSentryKey({
      vaultId,
      network: 'testnet',
      id: summary.id,
      seed: 'other-seed',
      assertCurrent,
    })
  ).rejects.toThrow();
  await expect(
    saveSentryKey({
      vaultId,
      network: 'mainnet',
      label: 'Node',
      key,
      seed,
      assertCurrent: () => {
        throw new Error('session changed');
      },
    })
  ).rejects.toThrow('session changed');
  expect(await listSentryKeys(vaultId, 'mainnet')).toEqual([]);
});

it('removes only the chosen local key, not another network or collateral', async () => {
  const vaultId = await getSentryVaultId('xpub-one');
  const summary = await saveSentryKey({
    vaultId,
    network: 'testnet',
    label: 'Test',
    key,
    seed,
    assertCurrent,
  });
  await saveSentryKey({
    vaultId,
    network: 'mainnet',
    label: 'Main',
    key,
    seed,
    assertCurrent,
  });
  records.set('sentry-collateral-v1:marker', ['retained']);
  await removeSentryKey(vaultId, 'testnet', summary.id, assertCurrent);
  expect(await listSentryKeys(vaultId, 'testnet')).toEqual([]);
  expect(await listSentryKeys(vaultId, 'mainnet')).toHaveLength(1);
  expect(records.get('sentry-collateral-v1:marker')).toEqual(['retained']);
});
