import type { SentryKeySummary, SentryNetwork } from '../utils/sentry/types';
import type { SentryAuthorityKey } from '@sidhujag/sysweb3-sentry';

const DOMAIN = 'Pali/Sentry/operator-vault/v1';
const utf8 = new TextEncoder();
const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
const unhex = (value: string) => {
  if (!/^(?:[0-9a-f]{2})+$/.test(value))
    throw new Error('Invalid encrypted Sentry key');
  return Uint8Array.from(value.match(/../g)!, (byte) => parseInt(byte, 16));
};

export const sentryKeyVaultStorageKey = (
  vaultId: string,
  network: SentryNetwork
) => `sentry-operator-v1:${vaultId}:${network}`;

interface ISentryKeyEnvelope {
  ciphertext: string;
  iv: string;
  summary: SentryKeySummary;
}
interface ISentryKeyStore {
  keys: ISentryKeyEnvelope[];
  network: SentryNetwork;
  vaultId: string;
  version: 1;
}

const hasSentryStoreHeader = (
  value: ISentryKeyStore,
  vaultId: string,
  network: SentryNetwork
) =>
  value.version === 1 &&
  value.vaultId === vaultId &&
  value.network === network &&
  Array.isArray(value.keys);

/** Only the known empty record can be removed along with its wallet group. */
export function isEmptySentryKeyStore(
  value: unknown,
  vaultId: string,
  network: SentryNetwork
): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const store = value as ISentryKeyStore;
  return (
    hasSentryStoreHeader(store, vaultId, network) &&
    Object.keys(store).sort().join(',') === 'keys,network,vaultId,version' &&
    store.keys.length === 0 &&
    Object.keys(store.keys).length === 0
  );
}

const deriveWrappingKey = async (
  seed: string,
  vaultId: string,
  crypto: SentryKeyCrypto
) => {
  const seedBytes = utf8.encode(seed.normalize('NFKD'));
  try {
    const material = await crypto.subtle.importKey(
      'raw',
      seedBytes,
      'HKDF',
      false,
      ['deriveKey']
    );
    return await crypto.subtle.deriveKey(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: utf8.encode(vaultId),
        info: utf8.encode(DOMAIN),
      },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  } finally {
    seedBytes.fill(0);
  }
};
const aad = (vaultId: string, summary: SentryKeySummary) =>
  // Chrome storage dictionaries may return keys in a different insertion order.
  // Bind explicit fields in the same canonical order used when encrypting.
  utf8.encode(
    JSON.stringify({
      domain: DOMAIN,
      vaultId,
      id: summary.id,
      label: summary.label,
      network: summary.network,
      role: summary.role,
      scheme: summary.scheme,
      publicKey: summary.publicKey,
    })
  );

type SentryKeyCrypto = Pick<
  Crypto,
  'subtle' | 'randomUUID' | 'getRandomValues'
>;

interface ISentryKeyVaultHost {
  crypto(): SentryKeyCrypto;
  read(key: string): Promise<unknown>;
  // Callers serialize the full read/modify/write, or the host write must compare the exact prior store.
  write(
    key: string,
    value: ISentryKeyStore,
    assertCurrent: () => void
  ): Promise<void>;
}

/** Shared Sentry envelope operations; wallet authorization belongs to the caller. */
export function createSentryKeyVault(host: ISentryKeyVaultHost) {
  const getSentryVaultId = async (rootPublicIdentity: string) => {
    if (!rootPublicIdentity)
      throw new Error('Wallet public identity is unavailable');
    return hex(
      new Uint8Array(
        await host
          .crypto()
          .subtle.digest('SHA-256', utf8.encode(rootPublicIdentity))
      )
    );
  };

  const getStore = async (
    vaultId: string,
    network: SentryNetwork
  ): Promise<ISentryKeyStore> => {
    const value = (await host.read(
      sentryKeyVaultStorageKey(vaultId, network)
    )) as ISentryKeyStore | null;
    if (!value) return { version: 1, vaultId, network, keys: [] };
    if (
      !hasSentryStoreHeader(value, vaultId, network) ||
      value.keys.length > 100 ||
      value.keys.some(
        (entry: ISentryKeyEnvelope) =>
          !entry?.summary ||
          entry.summary.network !== network ||
          !['operator', 'owner', 'voting', 'collateral'].includes(
            entry.summary.role
          ) ||
          !['bls-basic', 'slh-dsa-shake-128s', 'secp256k1'].includes(
            entry.summary.scheme
          ) ||
          !/^[a-f0-9-]{36}$/.test(entry.summary.id) ||
          typeof entry.summary.label !== 'string' ||
          entry.summary.label.length > 80 ||
          !new RegExp(
            `^[0-9a-f]{${
              entry.summary.scheme === 'bls-basic'
                ? 96
                : entry.summary.scheme === 'secp256k1'
                ? 66
                : 64
            }}$`
          ).test(entry.summary.publicKey) ||
          typeof entry.iv !== 'string' ||
          typeof entry.ciphertext !== 'string'
      )
    )
      throw new Error('Invalid Sentry key storage');
    return value;
  };

  const listSentryKeys = async (vaultId: string, network: SentryNetwork) =>
    (await getStore(vaultId, network)).keys.map(({ summary }) => ({
      ...summary,
    }));

  /** All entries are validated and encrypted before the one atomic storage write. */
  const saveSentryKeys = async (args: {
    assertCurrent: () => void;
    entries: Array<{ key: SentryAuthorityKey; label: string }>;
    network: SentryNetwork;
    seed: string;
    vaultId: string;
  }): Promise<SentryKeySummary[]> => {
    const { vaultId, network, seed, assertCurrent } = args;
    if (
      !Array.isArray(args.entries) ||
      !args.entries.length ||
      args.entries.length > 20
    )
      throw new Error('Import between 1 and 20 Sentry keys at a time');
    const entries = args.entries.map(({ label, key }, index) => {
      if (
        typeof label !== 'string' ||
        !label.trim() ||
        label.trim().length > 80
      )
        throw new Error(
          `Key ${index + 1}: enter a label of 1 to 80 characters`
        );
      if (
        !key ||
        !['owner', 'operator', 'voting', 'collateral'].includes(key.role) ||
        !['bls-basic', 'slh-dsa-shake-128s', 'secp256k1'].includes(
          key.scheme
        ) ||
        (key.role === 'operator' && key.scheme === 'secp256k1') ||
        (key.role !== 'operator' && key.scheme === 'bls-basic') ||
        (key.role === 'collateral' && key.scheme !== 'secp256k1') ||
        !new RegExp(
          `^[0-9a-f]{${
            key.scheme === 'bls-basic'
              ? 96
              : key.scheme === 'secp256k1'
              ? 66
              : 64
          }}$`
        ).test(key.publicKey) ||
        !new RegExp(
          `^[0-9a-f]{${key.scheme === 'slh-dsa-shake-128s' ? 128 : 64}}$`
        ).test(key.secretKey)
      )
        throw new Error(`Key ${index + 1}: invalid key metadata`);
      return { label: label.trim(), key };
    });
    if (
      entries.some(({ label }) =>
        entries.some(({ key }) => label.toLowerCase().includes(key.secretKey))
      )
    )
      throw new Error('Key labels must not contain private keys');
    assertCurrent();
    const store = await getStore(vaultId, network);
    assertCurrent();
    if (store.keys.length + entries.length > 100)
      throw new Error('Sentry key limit reached');
    const identities = new Set(
      store.keys.map(
        ({ summary }) =>
          `${summary.role}:${summary.scheme}:${summary.publicKey}`
      )
    );
    for (const [index, { key }] of entries.entries()) {
      const identity = `${key.role}:${key.scheme}:${key.publicKey}`;
      if (identities.has(identity))
        throw new Error(
          `Key ${
            index + 1
          }: this key is already imported on this network or repeated in this batch`
        );
      identities.add(identity);
    }
    const crypto = host.crypto();
    const wrappingKey = await deriveWrappingKey(seed, vaultId, crypto);
    assertCurrent();
    const encrypted: ISentryKeyEnvelope[] = [];
    for (const { label, key } of entries) {
      const summary: SentryKeySummary = {
        id: crypto.randomUUID(),
        label,
        network,
        role: key.role,
        scheme: key.scheme,
        publicKey: key.publicKey,
      };
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const plaintext = utf8.encode(JSON.stringify(key));
      try {
        const ciphertext = await crypto.subtle.encrypt(
          { name: 'AES-GCM', iv, additionalData: aad(vaultId, summary) },
          wrappingKey,
          plaintext
        );
        assertCurrent();
        encrypted.push({
          summary,
          iv: hex(iv),
          ciphertext: hex(new Uint8Array(ciphertext)),
        });
      } finally {
        plaintext.fill(0);
      }
    }
    assertCurrent();
    await host.write(
      sentryKeyVaultStorageKey(vaultId, network),
      {
        ...store,
        keys: [...store.keys, ...encrypted],
      },
      assertCurrent
    );
    assertCurrent();
    return encrypted.map(({ summary }) => ({ ...summary }));
  };

  const loadSentryKey = async (args: {
    assertCurrent: () => void;
    id: string;
    network: SentryNetwork;
    seed: string;
    vaultId: string;
  }): Promise<SentryAuthorityKey> => {
    const { vaultId, network, id, seed, assertCurrent } = args;
    assertCurrent();
    const envelope = (await getStore(vaultId, network)).keys.find(
      ({ summary }) => summary.id === id
    );
    if (!envelope) throw new Error('Sentry operator key not found');
    assertCurrent();
    const crypto = host.crypto();
    const wrappingKey = await deriveWrappingKey(seed, vaultId, crypto);
    const plaintext = new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: unhex(envelope.iv),
          additionalData: aad(vaultId, envelope.summary),
        },
        wrappingKey,
        unhex(envelope.ciphertext)
      )
    );
    try {
      assertCurrent();
      const key = JSON.parse(
        new TextDecoder().decode(plaintext)
      ) as SentryAuthorityKey;
      if (
        key.role !== envelope.summary.role ||
        key.scheme !== envelope.summary.scheme ||
        key.publicKey !== envelope.summary.publicKey
      )
        throw new Error(
          'Sentry key identity does not match its encrypted record'
        );
      return key;
    } finally {
      plaintext.fill(0);
    }
  };

  const removeSentryKey = async (
    vaultId: string,
    network: SentryNetwork,
    id: string,
    assertCurrent: () => void
  ) => {
    const store = await getStore(vaultId, network);
    assertCurrent();
    if (!store.keys.some(({ summary }) => summary.id === id))
      throw new Error('Sentry operator key not found');
    await host.write(
      sentryKeyVaultStorageKey(vaultId, network),
      { ...store, keys: store.keys.filter(({ summary }) => summary.id !== id) },
      assertCurrent
    );
    assertCurrent();
  };

  return {
    getSentryVaultId,
    listSentryKeys,
    loadSentryKey,
    removeSentryKey,
    saveSentryKeys,
  };
}
