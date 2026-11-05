import { webcrypto } from 'crypto';

import {
  assertImportedRecoveryAccount,
  importAccountWithRecovery,
  importedRecoveryStorageKey,
  readImportedRecoverySecret,
  snapshotImportedRecoveryEntry,
} from './importedAccountRecovery';

jest.unmock('syscoinjs-lib');
const { SoftwareKeyring, createKeyringHost } = jest.requireActual(
  '@sidhujag/sysweb3-keyring/cjs/software.js'
);
const { BIP32Factory } = jest.requireActual('bip32');
const secp = jest.requireActual('@bitcoinerlab/secp256k1');
const { getNetworkConfig } = jest.requireActual('@sidhujag/sysweb3-network');
const { convertExtendedKeyVersion } = jest.requireActual(
  '@sidhujag/sysweb3-keyring/cjs/utils/derivation-paths'
);
const phrase =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const password = 'Public fixture password 1!';

async function fixture(
  kind: 'ethereum' | 'syscoin' = 'ethereum',
  seed = phrase
) {
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: webcrypto,
  });
  const records = new Map<string, unknown>();
  const storage = {
    async get(key: string) {
      return records.get(key);
    },
    async set(key: string, value: unknown) {
      records.set(key, value);
    },
    async deleteItem(key: string) {
      records.delete(key);
    },
    async createManyIfAbsent(items: Record<string, unknown>) {
      if (Object.keys(items).some((key) => records.has(key))) return false;
      Object.entries(items).forEach(([key, value]) => records.set(key, value));
      return true;
    },
  };
  const network = { kind, slip44: kind === 'ethereum' ? 60 : 0 };
  const state = {
    activeAccount: { id: 0, type: 'HDAccount' },
    activeNetwork: {
      ...network,
      chainId: 1,
      currency: kind === 'ethereum' ? 'ETH' : 'Bitcoin',
      label: 'Fixture',
      url: 'https://offline.invalid',
    },
    accounts: {
      HDAccount: {},
      Imported: {},
      Ledger: {},
      Trezor: {},
      SmartAccount: {},
    },
  };
  const keyring = new SoftwareKeyring(createKeyringHost(storage), {
    captureEvmSubmission: null,
  });
  keyring.setVaultStateGetter(() => state);
  await keyring.initializeSession(seed, password);
  return { keyring, network, state, records };
}

const current = () => undefined;
for (const mode of [
  'evm',
  'wif-p2wpkh',
  'wif-p2pkh',
  'wif-p2tr',
  'extended',
] as const) {
  it(`protects an actual SDK ${mode} import without exposing or reallocating its key`, async () => {
    const f = await fixture(mode === 'evm' ? 'ethereum' : 'syscoin');
    const network = getNetworkConfig(0, 'Bitcoin').networks.mainnet;
    const node = BIP32Factory(secp)
      .fromSeed(Buffer.alloc(32, 9), network)
      .derivePath("m/84'/0'/0'");
    const secret =
      mode === 'evm'
        ? `0x${'12'.repeat(32)}`
        : mode === 'extended'
        ? convertExtendedKeyVersion(
            node.toBase58(),
            getNetworkConfig(0, 'Bitcoin').types.zPubType.mainnet.zprv
          )
        : node.toWIF();
    const options = mode.startsWith('wif-')
      ? { utxoAddressType: mode.slice(4) as 'p2wpkh' | 'p2pkh' | 'p2tr' }
      : undefined;
    const noNetwork = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => {
        throw Error('Unexpected network');
      });
    try {
      const before = JSON.stringify(f.state);
      const imported = await importAccountWithRecovery(
        f.keyring,
        { secret, label: 'Saved import', network: f.network, options },
        current
      );
      expect(imported.account.id).toBe(0);
      expect(imported.account.isImported).toBe(true);
      expect(imported.account.label).toBe('Saved import');
      expect(imported.recovery.identity).toEqual({
        ...f.network,
        id: 0,
        address: imported.account.address,
        xpub: imported.account.xpub,
      });
      expect(JSON.stringify(f.state)).toBe(before);
      expect(JSON.stringify(imported.recovery)).not.toContain(secret);
      expect(importedRecoveryStorageKey(imported.recovery)).toContain(
        imported.recovery.envelope.profileId
      );
      const advanced = {
        ...imported.recovery.identity,
        address:
          mode === 'extended'
            ? jest
                .requireActual('syscoinjs-lib')
                .utils.bitcoinjs.payments.p2wpkh({
                  pubkey: node.derive(0).derive(7).publicKey,
                  network,
                }).address
            : 'different address',
      };
      if (mode === 'extended') {
        expect(advanced.address).not.toBe(imported.account.address);
        expect(() =>
          assertImportedRecoveryAccount(imported.recovery, advanced)
        ).not.toThrow();
      } else {
        expect(() =>
          assertImportedRecoveryAccount(imported.recovery, advanced)
        ).toThrow('IMPORTED_RECOVERY_INVALID');
      }
      expect(() =>
        assertImportedRecoveryAccount(imported.recovery, {
          ...advanced,
          id: advanced.id + 1,
        })
      ).toThrow('IMPORTED_RECOVERY_INVALID');
      expect(() =>
        assertImportedRecoveryAccount(imported.recovery, {
          ...advanced,
          xpub: 'different key',
        })
      ).toThrow('IMPORTED_RECOVERY_INVALID');
      const restored = await readImportedRecoverySecret(
        f.keyring,
        imported.recovery,
        imported.recovery.identity,
        current
      );
      expect(restored.secret).toBe(secret);
      expect(restored.options).toEqual(options ?? null);
      expect(noNetwork).not.toHaveBeenCalled();
    } finally {
      noNetwork.mockRestore();
      await f.keyring.destroy();
    }
  });
}

it('rejects another seed profile and altered account identity', async () => {
  const f = await fixture();
  const other = await fixture(
    'ethereum',
    'test test test test test test test test test test test junk'
  );
  try {
    const imported = await importAccountWithRecovery(
      f.keyring,
      { secret: `0x${'13'.repeat(32)}`, network: f.network },
      current
    );
    await expect(
      readImportedRecoverySecret(
        other.keyring,
        imported.recovery,
        imported.recovery.identity,
        current
      )
    ).rejects.toThrow('IMPORTED_RECOVERY_INVALID');
    expect(() =>
      snapshotImportedRecoveryEntry(imported.recovery, {
        ...imported.recovery.identity,
        id: 1,
      })
    ).toThrow('IMPORTED_RECOVERY_INVALID');
    const changed = {
      ...imported.recovery,
      envelope: {
        ...imported.recovery.envelope,
        ciphertext: `AAAA${imported.recovery.envelope.ciphertext.slice(4)}`,
      },
    };
    await expect(
      readImportedRecoverySecret(f.keyring, changed, changed.identity, current)
    ).rejects.toThrow();
  } finally {
    await f.keyring.destroy();
    await other.keyring.destroy();
  }
});

it('clears plaintext when the live operation is revoked after encryption', async () => {
  const f = await fixture();
  let active = true;
  let retained: Uint8Array | undefined;
  const encrypt = f.keyring.encryptPrivateRecord.bind(f.keyring);
  f.keyring.encryptPrivateRecord = async (input: any) => {
    retained = input.plaintext;
    const result = await encrypt(input);
    active = false;
    return result;
  };
  try {
    await expect(
      importAccountWithRecovery(
        f.keyring,
        { secret: `0x${'14'.repeat(32)}`, network: f.network },
        () => {
          if (!active) throw Error('Cancelled');
        }
      )
    ).rejects.toThrow('Cancelled');
    expect(retained).toBeInstanceOf(Uint8Array);
    expect(retained!.every((byte) => byte === 0)).toBe(true);
    expect(f.state.accounts.Imported).toEqual({});
  } finally {
    await f.keyring.destroy();
  }
});
