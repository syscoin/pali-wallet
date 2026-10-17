import { webcrypto } from 'crypto';

import { chromeStorage } from 'utils/storageAPI';

import {
  getSentryVaultId,
  listSentryKeys,
  loadSentryKey,
  removeSentryKey,
  saveSentryKey,
  saveSentryKeys,
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

it('encrypts the complete batch and commits it with exactly one storage write', async () => {
  const vaultId = await getSentryVaultId('batch-vault');
  const second = {
    ...key,
    publicKey: '56'.repeat(48),
    secretKey: '78'.repeat(32),
  };
  const summaries = await saveSentryKeys({
    vaultId,
    network: 'testnet',
    seed,
    assertCurrent,
    entries: [
      { label: 'First', key },
      { label: 'Second', key: second },
    ],
  });
  expect(chromeStorage.setItem).toHaveBeenCalledTimes(1);
  expect(await listSentryKeys(vaultId, 'testnet')).toEqual(summaries);
  for (const [index, expected] of [key, second].entries()) {
    expect(
      await loadSentryKey({
        vaultId,
        network: 'testnet',
        seed,
        assertCurrent,
        id: summaries[index].id,
      })
    ).toEqual(expected);
  }
  const serialized = JSON.stringify([...records.values()]);
  expect(serialized).not.toContain(key.secretKey);
  expect(serialized).not.toContain(second.secretKey);
  expect(serialized).not.toContain(seed);
});

it('rejects duplicates, invalid labels and oversized batches before writing anything', async () => {
  const vaultId = await getSentryVaultId('batch-vault');
  for (const entries of [
    [
      { label: 'First', key },
      { label: 'Duplicate', key },
    ],
    [
      { label: 'First', key },
      { label: '', key: { ...key, publicKey: '56'.repeat(48) } },
    ],
    Array.from({ length: 21 }, () => ({ label: 'Key', key })),
  ]) {
    await expect(
      saveSentryKeys({
        vaultId,
        network: 'testnet',
        seed,
        assertCurrent,
        entries,
      })
    ).rejects.toThrow();
  }
  expect(chromeStorage.setItem).not.toHaveBeenCalled();
  expect(await listSentryKeys(vaultId, 'testnet')).toEqual([]);
});

it.each(['same', 'other'])(
  'never persists the %s entry private key in a public label',
  async (mode) => {
    const vaultId = await getSentryVaultId('batch-vault');
    const first = { ...key, secretKey: 'ab'.repeat(32) };
    const second = {
      ...key,
      publicKey: '56'.repeat(48),
      secretKey: 'cd'.repeat(32),
    };
    await expect(
      saveSentryKeys({
        vaultId,
        network: 'testnet',
        seed,
        assertCurrent,
        entries: [
          {
            label:
              'Key 0x' +
              (mode === 'same' ? first : second).secretKey.toUpperCase(),
            key: first,
          },
          { label: 'Second', key: second },
        ],
      })
    ).rejects.toThrow('Key labels must not contain private keys');
    expect(chromeStorage.setItem).not.toHaveBeenCalled();
    expect(await listSentryKeys(vaultId, 'testnet')).toEqual([]);
  }
);

it('does not partially persist a batch invalidated after all encryption completed', async () => {
  const vaultId = await getSentryVaultId('batch-vault');
  let checks = 0;
  await expect(
    saveSentryKeys({
      vaultId,
      network: 'testnet',
      seed,
      entries: [
        { label: 'First', key },
        { label: 'Second', key: { ...key, publicKey: '56'.repeat(48) } },
      ],
      assertCurrent: () => {
        if (++checks === 5) throw new Error('session changed');
      },
    })
  ).rejects.toThrow('session changed');
  expect(chromeStorage.setItem).not.toHaveBeenCalled();
  expect(await listSentryKeys(vaultId, 'testnet')).toEqual([]);
});

it('preserves existing encrypted records when any batch entry is a duplicate', async () => {
  const vaultId = await getSentryVaultId('batch-vault');
  await saveSentryKey({
    vaultId,
    network: 'testnet',
    seed,
    assertCurrent,
    label: 'Existing',
    key,
  });
  const before = JSON.stringify([...records.entries()]);
  jest.mocked(chromeStorage.setItem).mockClear();
  await expect(
    saveSentryKeys({
      vaultId,
      network: 'testnet',
      seed,
      assertCurrent,
      entries: [
        { label: 'New', key: { ...key, publicKey: '56'.repeat(48) } },
        { label: 'Existing', key },
      ],
    })
  ).rejects.toThrow('already imported');
  expect(chromeStorage.setItem).not.toHaveBeenCalled();
  expect(JSON.stringify([...records.entries()])).toEqual(before);
});

it('keeps the existing store unchanged when the atomic batch write fails', async () => {
  const vaultId = await getSentryVaultId('batch-vault');
  await saveSentryKey({
    vaultId,
    network: 'testnet',
    seed,
    assertCurrent,
    label: 'Existing',
    key,
  });
  const before = JSON.stringify([...records.entries()]);
  (chromeStorage.setItem as jest.Mock).mockRejectedValueOnce(
    new Error('storage unavailable')
  );
  await expect(
    saveSentryKeys({
      vaultId,
      network: 'testnet',
      seed,
      assertCurrent,
      entries: [{ label: 'New', key: { ...key, publicKey: '56'.repeat(48) } }],
    })
  ).rejects.toThrow('storage unavailable');
  expect(JSON.stringify([...records.entries()])).toEqual(before);
});

it('allows exactly 100 keys but never writes a self-invalidating 101-key store', async () => {
  const vaultId = await getSentryVaultId('batch-vault');
  for (let batch = 0; batch < 5; batch++) {
    await saveSentryKeys({
      vaultId,
      network: 'testnet',
      seed,
      assertCurrent,
      entries: Array.from({ length: 20 }, (_, i) => ({
        label: `Key ${batch * 20 + i + 1}`,
        key: {
          ...key,
          publicKey: (batch * 20 + i + 1)
            .toString(16)
            .padStart(2, '0')
            .repeat(48),
        },
      })),
    });
  }
  expect(await listSentryKeys(vaultId, 'testnet')).toHaveLength(100);
  const before = JSON.stringify([...records.entries()]);
  await expect(
    saveSentryKeys({
      vaultId,
      network: 'testnet',
      seed,
      assertCurrent,
      entries: [
        { label: 'Too many', key: { ...key, publicKey: 'ef'.repeat(48) } },
      ],
    })
  ).rejects.toThrow('limit');
  expect(JSON.stringify([...records.entries()])).toEqual(before);
});
