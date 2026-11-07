import { sentryPrivateLabelParts } from '../shared/sentryKeyLabel.ts';

import type { SentryNetwork } from '../shared/sentryNetworks.ts';

const roles = ['owner', 'operator', 'voting', 'collateral'] as const;
const schemes = ['bls-basic', 'slh-dsa-shake-128s', 'secp256k1'] as const;

/** The stored key representation produced by the Sentry SDK. */
export type SentryAuthorityKey = {
  publicKey: string;
  role: (typeof roles)[number];
  scheme: (typeof schemes)[number];
  secretKey: string;
};
export type SentryAuthorityScheme = SentryAuthorityKey['scheme'];
export function isAllowedSentryKeyRoleScheme(
  role: SentryAuthorityKey['role'],
  scheme: SentryAuthorityKey['scheme']
): boolean {
  return (
    roles.includes(role) &&
    schemes.includes(scheme) &&
    (role !== 'collateral' || scheme === 'secp256k1') &&
    (role !== 'operator' || scheme !== 'secp256k1') &&
    (role === 'operator' || scheme !== 'bls-basic')
  );
}
export type SentryKeySummary = Omit<SentryAuthorityKey, 'secretKey'> & {
  id: string;
  label: string;
  network: SentryNetwork;
};

const publicKeyPatterns = {
  'bls-basic': /^[0-9a-f]{96}$/,
  secp256k1: /^[0-9a-f]{66}$/,
  'slh-dsa-shake-128s': /^[0-9a-f]{64}$/,
} satisfies Record<SentryAuthorityScheme, RegExp>;
export function isSentryAuthorityPublicKey(
  scheme: SentryAuthorityScheme,
  value: unknown
): value is string {
  return (
    typeof value === 'string' &&
    Object.hasOwn(publicKeyPatterns, scheme) &&
    publicKeyPatterns[scheme].test(value)
  );
}

export function isSentryAuthorityKey(
  value: unknown
): value is SentryAuthorityKey {
  const key = value as SentryAuthorityKey | null;
  return (
    !!key &&
    isAllowedSentryKeyRoleScheme(key.role, key.scheme) &&
    isSentryAuthorityPublicKey(key.scheme, key.publicKey) &&
    typeof key.secretKey === 'string' &&
    new RegExp(
      `^[0-9a-f]{${key.scheme === 'slh-dsa-shake-128s' ? 128 : 64}}$`
    ).test(key.secretKey)
  );
}

const DOMAIN = 'Pali/Sentry/operator-vault/v1';
const utf8 = new TextEncoder();
const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
export async function deriveSentryVaultId(
  rootPublicIdentity: string,
  sha256: (value: Uint8Array<ArrayBuffer>) => Promise<Uint8Array>
): Promise<string> {
  if (!rootPublicIdentity)
    throw new Error('Wallet public identity is unavailable');
  const digest = await sha256(utf8.encode(rootPublicIdentity));
  if (!(digest instanceof Uint8Array) || digest.byteLength !== 32)
    throw new Error('Invalid wallet public identity digest');
  return hex(digest);
}
const unhex = (value: string) => {
  if (!/^(?:[0-9a-f]{2})+$/.test(value))
    throw new Error('Invalid encrypted Sentry key');
  return Uint8Array.from(value.match(/../g)!, (byte) => parseInt(byte, 16));
};

export const sentryKeyVaultStoragePrefix = (vaultId: string) =>
  `sentry-operator-v1:${vaultId}:`;

export const sentryKeyVaultStorageKey = (
  vaultId: string,
  network: SentryNetwork
) => `${sentryKeyVaultStoragePrefix(vaultId)}${network}`;

interface ISentryKeyEnvelope {
  ciphertext: string;
  iv: string;
  summary: SentryKeySummary;
}
export interface ISentryKeyStore {
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

export interface ISentryKeyVaultHost {
  crypto(): SentryKeyCrypto;
  read(key: string): Promise<unknown>;
  // Replace only the exact prior store under the supplied live owner guard.
  write(
    key: string,
    expected: ISentryKeyStore | undefined,
    value: ISentryKeyStore,
    assertCurrent: () => void
  ): Promise<void>;
}

export function assertSentryKeyStore(
  value: unknown,
  vaultId: string,
  network: SentryNetwork
): asserts value is ISentryKeyStore {
  const store = value as ISentryKeyStore;
  if (
    !value ||
    typeof value !== 'object' ||
    !hasSentryStoreHeader(store, vaultId, network) ||
    store.keys.length > 100 ||
    store.keys.some(
      (entry: ISentryKeyEnvelope) =>
        !entry?.summary ||
        entry.summary.network !== network ||
        !roles.includes(entry.summary.role) ||
        !schemes.includes(entry.summary.scheme) ||
        typeof entry.summary.id !== 'string' ||
        !/^[a-f0-9-]{36}$/.test(entry.summary.id) ||
        typeof entry.summary.label !== 'string' ||
        entry.summary.label.length > 80 ||
        typeof entry.summary.publicKey !== 'string' ||
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
}

/** Shared Sentry envelope operations; wallet authorization belongs to the caller. */
export function createSentryKeyVault(host: ISentryKeyVaultHost) {
  const getSentryVaultId = (rootPublicIdentity: string) =>
    deriveSentryVaultId(
      rootPublicIdentity,
      async (bytes) =>
        new Uint8Array(await host.crypto().subtle.digest('SHA-256', bytes))
    );

  const getStore = async (vaultId: string, network: SentryNetwork) => {
    const expected = await host.read(
      sentryKeyVaultStorageKey(vaultId, network)
    );
    if (expected === undefined || expected === null) {
      const store: ISentryKeyStore = { version: 1, vaultId, network, keys: [] };
      return { expected: undefined, store };
    }
    assertSentryKeyStore(expected, vaultId, network);
    return { expected, store: expected };
  };

  const listSentryKeys = async (vaultId: string, network: SentryNetwork) =>
    (await getStore(vaultId, network)).store.keys.map(({ summary }) => ({
      id: summary.id,
      label: summary.label,
      network: summary.network,
      role: summary.role,
      scheme: summary.scheme,
      publicKey: summary.publicKey,
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
      if (!isSentryAuthorityKey(key))
        throw new Error(`Key ${index + 1}: invalid key metadata`);
      return { label: label.trim(), key };
    });
    const privateParts = entries.flatMap(({ key }) =>
      sentryPrivateLabelParts(key.secretKey)
    );
    if (
      entries.some(({ label }) =>
        privateParts.some((part) => label.toLowerCase().includes(part))
      )
    )
      throw new Error('Key labels must not contain private keys');
    assertCurrent();
    const { expected, store } = await getStore(vaultId, network);
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
      const plaintext = utf8.encode(
        JSON.stringify({
          role: key.role,
          scheme: key.scheme,
          publicKey: key.publicKey,
          secretKey: key.secretKey,
        })
      );
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
      expected,
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
    const envelope = (await getStore(vaultId, network)).store.keys.find(
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
    const { expected, store } = await getStore(vaultId, network);
    assertCurrent();
    if (!store.keys.some(({ summary }) => summary.id === id))
      throw new Error('Sentry operator key not found');
    await host.write(
      sentryKeyVaultStorageKey(vaultId, network),
      expected,
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
