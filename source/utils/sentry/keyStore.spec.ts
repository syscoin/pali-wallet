import { webcrypto } from 'crypto';

import {
  createSentryKeyVault,
  sentryKeyVaultStorageKey,
} from '../../wallet/sentryKeyVault';
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
  chromeStorage: { getItems: jest.fn(), setItem: jest.fn() },
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
  (chromeStorage.getItems as jest.Mock).mockImplementation(async ([name]) => ({
    [name]: records.get(name),
  }));
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

it('shares the authenticated envelope with a host that owns an immutable snapshot', async () => {
  const portable = createSentryKeyVault({
    crypto: () => globalThis.crypto,
    async read(name) {
      const stored = records.get(name);
      return stored ? Object.freeze(structuredClone(stored)) : null;
    },
    async write(name, expected, value, current) {
      current();
      expect(records.get(name) ?? null).toEqual(expected ?? null);
      records.set(name, structuredClone(value));
    },
  });
  const vaultId = await getSentryVaultId('synthetic-xpub');
  expect(await portable.getSentryVaultId('synthetic-xpub')).toBe(vaultId);
  const input = { vaultId, network: 'testnet' as const, seed, assertCurrent };
  const summary = await saveSentryKey({
    ...input,
    label: 'Shared envelope',
    key,
  });
  await expect(
    portable.loadSentryKey({ ...input, id: summary.id })
  ).resolves.toEqual(key);
  await portable.removeSentryKey(
    vaultId,
    input.network,
    summary.id,
    assertCurrent
  );
  expect(await listSentryKeys(vaultId, input.network)).toEqual([]);
  const [other] = await portable.saveSentryKeys({
    ...input,
    entries: [{ label: 'Same format', key }],
  });
  await expect(loadSentryKey({ ...input, id: other.id })).resolves.toEqual(key);
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

it('does not overwrite a replaced Chrome bucket after its first read', async () => {
  const vaultId = await getSentryVaultId('xpub-one');
  const scope = { vaultId, network: 'mainnet' as const, seed, assertCurrent };
  await saveSentryKey({ ...scope, label: 'Existing key', key });
  const [name, saved] = [...records.entries()][0]!;
  const replacement = { ...(saved as object), keys: [] };
  (chromeStorage.getItems as jest.Mock)
    .mockResolvedValueOnce({ [name]: saved })
    .mockImplementationOnce(async () => {
      records.set(name, replacement);
      return { [name]: replacement };
    });
  await expect(
    saveSentryKey({
      ...scope,
      label: 'New key',
      key: { ...key, publicKey: '56'.repeat(48) },
    })
  ).rejects.toThrow('Sentry key storage changed');
  expect(records.get(name)).toEqual(replacement);
  expect(chromeStorage.setItem).toHaveBeenCalledTimes(1);
});

it('preserves older stored metadata while rejecting newly disallowed role and scheme pairs', async () => {
  const vaultId = await getSentryVaultId('xpub-one');
  const scope = { vaultId, network: 'mainnet' as const, seed, assertCurrent };
  await saveSentryKey({ ...scope, label: 'Stored key', key });
  const stored = [...records.values()][0] as {
    keys: Array<{ summary: { role: string } }>;
  };
  stored.keys[0]!.summary.role = 'voting';
  await expect(listSentryKeys(vaultId, 'mainnet')).resolves.toEqual([
    expect.objectContaining({ role: 'voting', scheme: 'bls-basic' }),
  ]);
  await expect(
    saveSentryKey({
      ...scope,
      label: 'Invalid new key',
      key: { ...key, role: 'voting' },
    })
  ).rejects.toThrow('invalid key metadata');
  await expect(
    saveSentryKey({
      ...scope,
      label: 'Valid new key',
      key: { ...key, publicKey: '56'.repeat(48) },
    })
  ).resolves.toMatchObject({ role: 'operator' });
  expect(await listSentryKeys(vaultId, 'mainnet')).toHaveLength(2);
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

it('fails closed when a stored Sentry bucket is a falsy malformed value', async () => {
  const vaultId = await getSentryVaultId('synthetic-xpub');
  const network = 'testnet';
  const name = sentryKeyVaultStorageKey(vaultId, network);
  records.set(name, false);
  await expect(listSentryKeys(vaultId, network)).rejects.toThrow(
    'Invalid Sentry key storage'
  );
  await expect(
    saveSentryKey({
      vaultId,
      network,
      label: 'New key',
      key,
      seed,
      assertCurrent,
    })
  ).rejects.toThrow('Invalid Sentry key storage');
  expect(records.get(name)).toBe(false);
  expect(chromeStorage.setItem).not.toHaveBeenCalled();
});

it('rejects either SHAKE secret component in a protected-store label', async () => {
  const vaultId = await getSentryVaultId('synthetic-xpub');
  const network = 'testnet';
  const secretKey =
    '13'.repeat(16) + '24'.repeat(16) + '35'.repeat(16) + '46'.repeat(16);
  const shakeKey = {
    role: 'operator' as const,
    scheme: 'slh-dsa-shake-128s' as const,
    publicKey: secretKey.slice(64),
    secretKey,
  };
  for (const label of [secretKey.slice(0, 32), secretKey.slice(32, 64)]) {
    await expect(
      saveSentryKey({
        vaultId,
        network,
        label,
        key: shakeKey,
        seed,
        assertCurrent,
      })
    ).rejects.toThrow('Key labels must not contain private keys');
  }
  expect(chromeStorage.setItem).not.toHaveBeenCalled();
});

it('refuses a falsy replacement while admitting a new bucket', async () => {
  const vaultId = await getSentryVaultId('synthetic-xpub');
  const network = 'testnet';
  const name = sentryKeyVaultStorageKey(vaultId, network);
  (chromeStorage.getItems as jest.Mock)
    .mockResolvedValueOnce({})
    .mockImplementationOnce(async () => {
      records.set(name, false);
      return { [name]: false };
    });
  await expect(
    saveSentryKey({
      vaultId,
      network,
      label: 'New key',
      key,
      seed,
      assertCurrent,
    })
  ).rejects.toThrow('Sentry key storage changed');
  expect(records.get(name)).toBe(false);
  expect(chromeStorage.setItem).not.toHaveBeenCalled();
});
