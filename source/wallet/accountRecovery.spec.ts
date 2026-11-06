import { webcrypto } from 'crypto';

import { stageAccountRecovery } from './accountRecovery';
import { importAccountWithRecovery } from './importedAccountRecovery';

jest.unmock('syscoinjs-lib');
jest.mock('@sidhujag/sysweb3-keyring', () =>
  jest.requireActual('@sidhujag/sysweb3-keyring/cjs/signers')
);
const sdk = jest.requireActual('@sidhujag/sysweb3-keyring/cjs/software.js');
const { getNetworkConfig } = jest.requireActual('@sidhujag/sysweb3-network');
const { BIP32Factory } = jest.requireActual('bip32');
const secp = jest.requireActual('@bitcoinerlab/secp256k1');
const { convertExtendedKeyVersion } = jest.requireActual(
  '@sidhujag/sysweb3-keyring/cjs/utils/derivation-paths'
);
const phrase =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const oldPassword = 'Previous public fixture password 1!';
const password = 'Changed public fixture password 2!';
const check = () => undefined;
const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');

beforeEach(() => {
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: webcrypto,
  });
  jest.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    throw Error('Recovery must remain offline');
  });
});
afterEach(() => {
  jest.restoreAllMocks();
  if (originalCrypto)
    Object.defineProperty(globalThis, 'crypto', originalCrypto);
});

function store(initial?: Map<string, unknown>) {
  const values = initial ?? new Map<string, unknown>();
  return {
    values,
    port: {
      async get(key: string) {
        return values.get(key);
      },
      async set(key: string, value: unknown) {
        values.set(key, value);
      },
      async deleteItem(key: string) {
        values.delete(key);
      },
      async createManyIfAbsent(items: Record<string, unknown>) {
        if (Object.keys(items).some((key) => values.has(key))) return false;
        Object.entries(items).forEach(([key, value]) => values.set(key, value));
        return true;
      },
    },
  };
}

async function fixture(kind: 'ethereum' | 'syscoin' = 'ethereum') {
  const storage = store();
  const network = {
    kind,
    slip44: kind === 'ethereum' ? 60 : 0,
    chainId: kind === 'ethereum' ? 1 : 0,
    currency: kind === 'ethereum' ? 'ETH' : 'Bitcoin',
    label: 'Offline fixture',
    url: 'https://offline.invalid',
  };
  const group: any = {
    key: `state-vault-${network.slip44}`,
    activeNetwork: network,
    activeAccount: { id: 0, type: 'HDAccount' },
    accounts: {
      HDAccount: {},
      Imported: {},
      Ledger: {},
      Trezor: {},
      SmartAccount: {},
    },
  };
  const keyring = new sdk.SoftwareKeyring(sdk.createKeyringHost(storage.port), {
    captureEvmSubmission: null,
  });
  keyring.setVaultStateGetter(() => group);
  await keyring.initializeSession(phrase, oldPassword);
  const first = await keyring.createFirstAccount();
  group.accounts.HDAccount[0] = {
    ...first,
    label: 'Keep my label',
    extraMetadata: { hidden: true, tags: ['one'] },
  };
  return { storage, group, keyring, network };
}

async function openRecovered(
  result: Awaited<ReturnType<typeof stageAccountRecovery>>
) {
  const storage = store(
    new Map([
      ['vault', result.pair.vault],
      ['vault-keys', result.pair.keys],
    ])
  );
  const keyring = new sdk.SoftwareKeyring(sdk.createKeyringHost(storage.port), {
    captureEvmSubmission: null,
  });
  keyring.setVaultStateGetter(() => result.groups[0]);
  expect(await keyring.unlock(password)).toMatchObject({ canLogin: true });
  return keyring;
}

it('rewraps sparse HD records and an imported typed alias using the SDK while preserving all public metadata', async () => {
  const f = await fixture();
  try {
    const third = await f.keyring.deriveEvmHdRuntimeAccount(
      { index: 3 },
      { assertCurrent: check }
    );
    f.group.accounts.HDAccount[3] = { ...third, label: 'Third' };
    const alias = await f.keyring.deriveEvmHdRuntimeAccount(
      { index: 1 },
      { assertCurrent: check }
    );
    // SDK import admits this while HD1 is absent; a later HD1 is the valid
    // cross-type alias which recovery must preserve without a new allocator.
    f.group.accounts.HDAccount[1] = alias;
    const secret = await f.keyring.getPrivateKeyByAccountId(
      1,
      'HDAccount',
      oldPassword
    );
    delete f.group.accounts.HDAccount[1];
    const imported = await importAccountWithRecovery(
      f.keyring,
      { secret, label: 'Alias', network: { kind: 'ethereum', slip44: 60 } },
      check
    );
    f.group.accounts.Imported[imported.account.id] = imported.account;
    f.group.accounts.HDAccount[1] = alias;
    const before = structuredClone(f.group);
    const copy = JSON.stringify(imported.recovery);
    const result = await stageAccountRecovery(
      { groups: [f.group], imported: [imported.recovery], phrase, password },
      { assertCurrent: check, loadSdk: async () => sdk }
    );
    const after = result.groups[0];
    expect(Object.keys(after.accounts.HDAccount)).toEqual(['0', '1', '3']);
    expect(after.accounts.HDAccount[0].xprv).not.toBe(
      before.accounts.HDAccount[0].xprv
    );
    expect(after.accounts.Imported[0].xprv).not.toBe(
      before.accounts.Imported[0].xprv
    );
    for (const type of Object.keys(before.accounts))
      for (const id of Object.keys(before.accounts[type])) {
        expect({ ...after.accounts[type][id], xprv: '' }).toEqual({
          ...before.accounts[type][id],
          xprv: '',
        });
      }
    expect(f.group).toEqual(before);
    expect(JSON.stringify(imported.recovery)).toBe(copy);
    expect(result.profileId).toBe(await f.keyring.getPrivateRecordProfileId());
    const restored = await openRecovered(result);
    try {
      expect(
        await restored.getPrivateKeyByAccountId(0, 'Imported', password)
      ).toBe(secret);
      await expect(
        restored.getPrivateKeyByAccountId(0, 'Imported', oldPassword)
      ).rejects.toThrow();
      expect(
        await restored.getPrivateKeyByAccountId(1, 'HDAccount', password)
      ).toBe(secret);
    } finally {
      await restored.destroy();
    }
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    await f.keyring.destroy();
  }
});

it.each(['p2wpkh', 'p2pkh', 'p2tr', 'extended'] as const)(
  'uses the existing SDK importer and script option for %s while preserving a rolling extended-key receive address',
  async (mode) => {
    const f = await fixture('syscoin');
    try {
      const config = getNetworkConfig(0, 'Bitcoin');
      const node = BIP32Factory(secp)
        .fromSeed(Buffer.alloc(32, 9), config.networks.mainnet)
        .derivePath("m/84'/0'/0'");
      const secret =
        mode === 'extended'
          ? convertExtendedKeyVersion(
              node.toBase58(),
              config.types.zPubType.mainnet.zprv
            )
          : node.toWIF();
      const imported = await importAccountWithRecovery(
        f.keyring,
        {
          secret,
          network: { kind: 'syscoin', slip44: 0 },
          options: mode === 'extended' ? undefined : { utxoAddressType: mode },
        },
        check
      );
      f.group.accounts.Imported[0] = imported.account;
      if (mode === 'extended') {
        const bitcoin = jest.requireActual('syscoinjs-lib').utils.bitcoinjs;
        f.group.accounts.Imported[0].address = bitcoin.payments.p2wpkh({
          pubkey: node.derive(0).derive(7).publicKey,
          network: config.networks.mainnet,
        }).address;
      }
      const before = structuredClone(f.group);
      const result = await stageAccountRecovery(
        { groups: [f.group], imported: [imported.recovery], phrase, password },
        { assertCurrent: check, loadSdk: async () => sdk }
      );
      expect(result.groups[0].accounts.Imported[0].address).toBe(
        before.accounts.Imported[0].address
      );
      expect(result.groups[0].accounts.HDAccount[0].xpub).toBe(
        before.accounts.HDAccount[0].xpub
      );
      const restored = await openRecovered(result);
      try {
        expect(
          await restored.getPrivateKeyByAccountId(0, 'Imported', password)
        ).toBe(secret);
      } finally {
        await restored.destroy();
      }
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      await f.keyring.destroy();
    }
  }
);

it('refuses missing or changed recovery copies and leaves the source account/pair intact', async () => {
  const f = await fixture();
  try {
    const imported = await importAccountWithRecovery(
      f.keyring,
      {
        secret: `0x${'12'.repeat(32)}`,
        network: { kind: 'ethereum', slip44: 60 },
      },
      check
    );
    f.group.accounts.Imported[0] = imported.account;
    const before = structuredClone(f.group);
    const pair = new Map(f.storage.values);
    await expect(
      stageAccountRecovery(
        { groups: [f.group], imported: [], phrase, password },
        { assertCurrent: check, loadSdk: async () => sdk }
      )
    ).rejects.toThrow('WALLET_RECOVERY_DATA_INVALID');
    await expect(
      stageAccountRecovery(
        {
          groups: [f.group],
          imported: [imported.recovery, imported.recovery],
          phrase,
          password,
        },
        { assertCurrent: check, loadSdk: async () => sdk }
      )
    ).rejects.toThrow('WALLET_RECOVERY_DATA_INVALID');
    const changed = structuredClone(imported.recovery);
    changed.envelope.ciphertext = `AAAA${changed.envelope.ciphertext.slice(4)}`;
    await expect(
      stageAccountRecovery(
        { groups: [f.group], imported: [changed], phrase, password },
        { assertCurrent: check, loadSdk: async () => sdk }
      )
    ).rejects.toThrow();
    expect(f.group).toEqual(before);
    expect(f.storage.values).toEqual(pair);
  } finally {
    await f.keyring.destroy();
  }
});

it('validates retained domains inside the staged session and cannot release a result after revocation', async () => {
  const f = await fixture();
  try {
    let current = true;
    const assertCurrent = () => {
      if (!current) throw Error('Revoked fixture');
    };
    const validateRetained = jest.fn(async ({ keyring, profileId }) => {
      expect(profileId).toBe(await f.keyring.getPrivateRecordProfileId());
      expect(keyring).not.toBe(f.keyring);
      current = false;
    });
    await expect(
      stageAccountRecovery(
        { groups: [f.group], imported: [], phrase, password },
        { assertCurrent, loadSdk: async () => sdk, validateRetained }
      )
    ).rejects.toThrow('Revoked fixture');
    expect(validateRetained).toHaveBeenCalledTimes(1);
    expect(f.keyring.isUnlocked()).toBe(true);
  } finally {
    await f.keyring.destroy();
  }
});

it('keeps complete watch, hardware and smart-account metadata while staging multiple network vaults', async () => {
  const evm = await fixture();
  const utxo = await fixture('syscoin');
  try {
    evm.group.accounts.Imported[7] = {
      id: 7,
      address: `0x${'24'.repeat(20)}`,
      xpub: `0x${'24'.repeat(20)}`,
      xprv: '',
      isImported: true,
      label: 'Watch',
      custom: { color: 'blue' },
    };
    evm.group.accounts.Ledger[4] = {
      id: 4,
      address: `0x${'34'.repeat(20)}`,
      xpub: 'ledger public identity',
      xprv: '',
      isLedgerWallet: true,
      label: 'Device',
      hardware: { path: "m/44'/60'/4'" },
    };
    evm.group.accounts.SmartAccount[2] = {
      id: 2,
      address: `0x${'44'.repeat(20)}`,
      xpub: `0x${'44'.repeat(20)}`,
      xprv: '',
      isSmartAccount: true,
      label: 'Smart',
      smartAccount: {
        auth: { scheme: 'p256-webauthn' },
        deploymentSalt: 'stored salt',
      },
    };
    const before = structuredClone([evm.group, utxo.group]);
    const result = await stageAccountRecovery(
      { groups: before, imported: [], phrase, password },
      { assertCurrent: check, loadSdk: async () => sdk }
    );
    for (const type of ['Imported', 'Ledger', 'SmartAccount'] as const)
      expect(result.groups[0].accounts[type]).toEqual(before[0].accounts[type]);
    expect(result.groups[1].accounts.HDAccount[0].xpub).toBe(
      before[1].accounts.HDAccount[0].xpub
    );
    expect(result.groups[1].accounts.HDAccount[0].xprv).not.toBe(
      before[1].accounts.HDAccount[0].xprv
    );
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    await evm.keyring.destroy();
    await utxo.keyring.destroy();
  }
});

it('uses the captured phrase, password and record snapshot across asynchronous SDK loading', async () => {
  const f = await fixture();
  try {
    let release!: (value: any) => void;
    const loaded = new Promise<any>((resolve) => {
      release = resolve;
    });
    const input = { groups: [f.group], imported: [], phrase, password };
    const pending = stageAccountRecovery(input, {
      assertCurrent: check,
      loadSdk: () => loaded,
    });
    input.phrase =
      'test test test test test test test test test test test junk';
    input.password = 'Unapproved replacement password 3!';
    f.group.accounts.HDAccount[0].address = `0x${'11'.repeat(20)}`;
    release(sdk);
    const result = await pending;
    expect(result.groups[0].accounts.HDAccount[0].address).not.toBe(
      f.group.accounts.HDAccount[0].address
    );
    const restored = await openRecovered(result);
    try {
      expect(await restored.getSeed(password)).toBe(phrase);
    } finally {
      await restored.destroy();
    }
  } finally {
    await f.keyring.destroy();
  }
});

it('rejects a stage revoked while its actual SDK session is being destroyed', async () => {
  const f = await fixture();
  let current = true;
  class CleanupKeyring extends sdk.SoftwareKeyring {
    async destroy() {
      await super.destroy();
      current = false;
    }
  }
  try {
    await expect(
      stageAccountRecovery(
        { groups: [f.group], imported: [], phrase, password },
        {
          assertCurrent: () => {
            if (!current) throw Error('Cleanup revoked');
          },
          loadSdk: async () => ({ ...sdk, SoftwareKeyring: CleanupKeyring }),
        }
      )
    ).rejects.toThrow('Cleanup revoked');
  } finally {
    await f.keyring.destroy();
  }
});

it('stages persisted JSON records without a global structuredClone implementation', async () => {
  const f = await fixture();
  const clone = Object.getOwnPropertyDescriptor(globalThis, 'structuredClone');
  try {
    Object.defineProperty(globalThis, 'structuredClone', {
      configurable: true,
      value: undefined,
    });
    const result = await stageAccountRecovery(
      { groups: [f.group], imported: [], phrase, password },
      { assertCurrent: check, loadSdk: async () => sdk }
    );
    expect(result.groups[0].accounts.HDAccount[0].address).toBe(
      f.group.accounts.HDAccount[0].address
    );
    expect(
      (result.groups[0].accounts.HDAccount[0] as any).extraMetadata
    ).toEqual(f.group.accounts.HDAccount[0].extraMetadata);
  } finally {
    if (clone) Object.defineProperty(globalThis, 'structuredClone', clone);
    await f.keyring.destroy();
  }
});

it('preserves sparse imported IDs while the scratch SDK importer allocates its own temporary IDs', async () => {
  const f = await fixture();
  try {
    const copies = [];
    const secrets = [
      `0x${'12'.repeat(32)}`,
      `0x${'13'.repeat(32)}`,
      `0x${'14'.repeat(32)}`,
    ];
    for (const secret of secrets) {
      const imported = await importAccountWithRecovery(
        f.keyring,
        { secret, network: { kind: 'ethereum', slip44: 60 } },
        check
      );
      f.group.accounts.Imported[imported.account.id] = imported.account;
      copies.push(imported.recovery);
    }
    delete f.group.accounts.Imported[1];
    const result = await stageAccountRecovery(
      { groups: [f.group], imported: [copies[0], copies[2]], phrase, password },
      { assertCurrent: check, loadSdk: async () => sdk }
    );
    expect(Object.keys(result.groups[0].accounts.Imported)).toEqual(['0', '2']);
    expect(result.groups[0].accounts.Imported[2].id).toBe(2);
    const restored = await openRecovered(result);
    try {
      expect(
        await restored.getPrivateKeyByAccountId(2, 'Imported', password)
      ).toBe(secrets[2]);
    } finally {
      await restored.destroy();
    }
  } finally {
    await f.keyring.destroy();
  }
});
