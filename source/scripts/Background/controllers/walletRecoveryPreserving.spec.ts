import { webcrypto } from 'crypto';
import { Transaction } from 'ethers/transaction';
import { Wallet } from 'ethers/wallet';

import { getSLHDSAStateStorageKey } from '../../../utils/slhDsa/constants';
import {
  createSLHDSAProvisionedState,
  saveEncryptedSLHDSAState,
  loadEncryptedSLHDSAState,
} from '../../../utils/slhDsa/state';
import {
  EVM_SIGNED_RECORD_PREFIX,
  EvmSignedRecords,
} from '../../../wallet/evmSignedRecords';
import {
  importAccountWithRecovery,
  importedRecoveryStorageKey,
} from '../../../wallet/importedAccountRecovery';
import {
  envelopeHash,
  readPrivateVaultBundle,
  PRIVATE_VAULT_STORAGE_PREFIX,
} from '../../../wallet/privateVaultInspection';
import { createSlhDsaProfileStateCrypto } from '../../../wallet/slhDsaStateCrypto';
import { walletPersistenceGate } from 'state/paliStorage';
import { AsyncMutex } from 'utils/asyncMutex';
import { chromeStorage } from 'utils/storageAPI';

import { beginWalletRecovery, runWalletSetup } from './walletRecovery';

jest.unmock('syscoinjs-lib');
jest.mock('@sidhujag/sysweb3-keyring', () => ({
  ...jest.requireActual('@sidhujag/sysweb3-keyring/cjs/utils/derivation-paths'),
  ...jest.requireActual('@sidhujag/sysweb3-keyring/cjs/signers'),
}));
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockState },
}));
jest.mock('utils/storageAPI', () => ({
  chromeStorage: {
    getItems: async (keys: string[]) =>
      Object.fromEntries(keys.map((key) => [key, mockRecords[key]])),
    getItem: async (key: string) => mockRecords[key],
    setItem: async (key: string, value: any) => {
      if (mockWrite) await mockWrite({ [key]: value });
      else mockRecords[key] = structuredClone(value);
    },
    setItems: async (items: any) => {
      if (mockWrite) await mockWrite(items);
      else Object.assign(mockRecords, structuredClone(items));
    },
    removeItem: async (key: string | string[]) => {
      for (const name of Array.isArray(key) ? key : [key])
        delete mockRecords[name];
    },
  },
}));

const sdk = jest.requireActual('@sidhujag/sysweb3-keyring/cjs/software.js');
const phrase =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const old = 'Public previous wallet password 1!';
const next = 'Public replacement wallet password 2!';
const JOURNAL = 'pali-wallet-recovery-journal:v1';
let mockState: any,
  mockRecords: Record<string, any>,
  mockWrite: ((items: Record<string, any>) => Promise<void>) | undefined;
const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
beforeEach(() => {
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: webcrypto,
  });
  mockWrite = undefined;
  walletPersistenceGate.blocked = false;
});
afterEach(() => {
  walletPersistenceGate.blocked = false;
  if (originalCrypto)
    Object.defineProperty(globalThis, 'crypto', originalCrypto);
  jest.restoreAllMocks();
});

async function fixture() {
  mockRecords = {};
  const port = {
    get: async (key: string) => mockRecords[`sysweb3-${key}`],
    set: async (key: string, value: unknown) => {
      mockRecords[`sysweb3-${key}`] = value;
    },
    deleteItem: async () => undefined,
    createManyIfAbsent: async (items: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(items))
        mockRecords[`sysweb3-${key}`] = value;
      return true;
    },
  };
  const network = {
    kind: 'ethereum',
    slip44: 60,
    chainId: 1,
    currency: 'ETH',
    label: 'Public offline fixture',
    url: 'https://offline.invalid',
  };
  let keyring = new sdk.SoftwareKeyring(sdk.createSoftwareKeyringHost(port));
  const group: any = {
    activeNetwork: network,
    activeAccount: { type: 'HDAccount', id: 0 },
    accounts: {
      HDAccount: {},
      Imported: {},
      Ledger: {},
      Trezor: {},
      SmartAccount: {},
    },
  };
  keyring.setVaultStateGetter(() => group);
  await keyring.initializeSession(phrase, old);
  group.accounts.HDAccount[0] = await keyring.createFirstAccount();
  group.accounts.HDAccount[3] = await keyring.deriveEvmHdRuntimeAccount(
    { index: 3 },
    { assertCurrent: () => undefined }
  );
  const imported = await importAccountWithRecovery(
    keyring,
    {
      secret: `0x${'11'.repeat(32)}`,
      label: 'Retained imported key',
      network: { kind: 'ethereum', slip44: 60 },
    },
    () => undefined
  );
  group.accounts.Imported[imported.account.id] = imported.account;
  group.activeAccount = { type: 'Imported', id: imported.account.id };
  group.accounts.Ledger[9] = {
    id: 9,
    address: 'hardware fixture',
    xpub: 'hardware public',
    xprv: '',
    label: 'Hardware',
    isLedgerWallet: true,
    custom: { retained: true },
  };
  mockRecords[importedRecoveryStorageKey(imported.recovery)] =
    imported.recovery;
  mockRecords['state-vault-60'] = {
    ...group,
    accountAssets: { retained: ['token'] },
    accountTransactions: { retained: ['history'] },
  };
  mockRecords.state = {
    vaultGlobal: {
      activeSlip44: 60,
      hasEncryptedVault: true,
      advancedSettings: { autolock: 10 },
      networks: { retained: true },
    },
    dapp: { allowed: true },
    price: { retained: true },
  };
  const profile = await keyring.getPrivateRecordProfileId();
  const raw = await new Wallet(`0x${'11'.repeat(32)}`).signTransaction({
    type: 2,
    chainId: 1,
    to: '0x2222222222222222222222222222222222222222',
    value: 1,
    nonce: 0,
    gasLimit: 21000,
    maxFeePerGas: 2,
    maxPriorityFeePerGas: 1,
  });
  const tx = Transaction.from(raw);
  const signed = new EvmSignedRecords({
    read: async (id) => mockRecords[EVM_SIGNED_RECORD_PREFIX + id],
    compareAndSet: async (id, _before, value) => {
      mockRecords[EVM_SIGNED_RECORD_PREFIX + id] = value;
      return true;
    },
  });
  await signed.append(
    { keyring, assertCurrent: () => undefined },
    {
      rawTransaction: raw,
      hash: tx.hash!,
      from: tx.from!,
      nonce: 0,
      chainId: '1',
      type: 2,
      context: {
        account: {
          id: imported.account.id,
          type: 'Imported',
          address: imported.account.address,
        },
        operation: 'send',
        network,
      },
    }
  );
  const pq = {
    ...createSLHDSAProvisionedState({
      accountIndex: 0,
      derivationLabel: 'public fixture',
      keyId: 'public-pq-fixture',
      pkRoot: `0x${'33'.repeat(16)}`,
      pkSeed: `0x${'44'.repeat(16)}`,
      secretKeyHex: `0x${'55'.repeat(64)}`,
    }),
    signatureCount: 7,
  };
  await saveEncryptedSLHDSAState(
    pq,
    createSlhDsaProfileStateCrypto(keyring, () => undefined)
  );
  let sequence = 0;
  const nextId = () =>
    `00000000-0000-4000-8000-${(++sequence).toString().padStart(12, '0')}`;
  const notes = Array.from({ length: 17 }, (_, index) => ({
    id: nextId(),
    createdAt: 1,
    note: `tornado-eth-1-1-0x${(index + 1).toString(16).padStart(124, '0')}`,
  }));
  const shards = [];
  for (let index = 0; index < notes.length; index += 16)
    shards.push(
      await keyring.encryptPrivateRecord({
        domain: 'org.syscoin.pali.privacy.notes.shard.v2',
        recordId: nextId(),
        plaintext: new TextEncoder().encode(
          JSON.stringify({ version: 1, notes: notes.slice(index, index + 16) })
        ),
      })
    );
  const noteRoot = await keyring.encryptPrivateRecord({
    domain: 'org.syscoin.pali.privacy.notes.v1',
    recordId: nextId(),
    plaintext: new TextEncoder().encode(
      JSON.stringify({
        format: 'pali-private-note-vault',
        version: 1,
        noteCount: notes.length,
        capacity: 128,
        restore: { version: 1 },
        shards: shards.map((shard, index) => ({
          recordId: shard.recordId,
          hash: envelopeHash(shard),
          count: index ? 1 : 16,
        })),
      })
    ),
  });
  mockRecords[PRIVATE_VAULT_STORAGE_PREFIX + profile] = {
    format: 'pali-private-note-vault',
    version: 1,
    root: noteRoot,
    shards,
  };
  await keyring.destroy();
  mockState = {
    ...mockRecords.state,
    vault: structuredClone(mockRecords['state-vault-60']),
  };
  (globalThis as any).chrome = {
    runtime: {},
    storage: {
      local: {
        get: (_keys: any, callback: any) =>
          callback(structuredClone(mockRecords)),
      },
    },
  };
  let unlocked = false;
  const wallet: any = {
    walletStateGeneration: 0,
    walletSessionGeneration: 0,
    isCreatingWallet: false,
    recoveryJournalPending: false,
    authenticationMutex: new AsyncMutex(),
    isAnyKeyringUnlocked: () => unlocked,
    isUnlocked: () => unlocked,
    isSeedValid: (value: string) => value === phrase,
    resetRateLimitState: jest.fn(),
    createWalletExclusive: jest.fn(),
    resetWalletState: jest.fn(),
    lock() {
      this.walletSessionGeneration++;
      unlocked = false;
    },
    async retireWalletRuntime() {
      this.walletSessionGeneration++;
      this.walletStateGeneration++;
      unlocked = false;
    },
    async activateRecoveredWallet(password: string, assertCurrent: () => void) {
      keyring = new sdk.SoftwareKeyring(sdk.createSoftwareKeyringHost(port));
      keyring.setVaultStateGetter(() => mockState.vault);
      expect(await keyring.unlock(password)).toMatchObject({ canLogin: true });
      assertCurrent();
      unlocked = true;
    },
  };
  const context = {
    getState: () => mockState,
    persistenceMutex: new AsyncMutex(),
    readPresence: async () => true,
    storage: chromeStorage,
    rehydrate: async (state: any) => {
      mockState = {
        ...state,
        vault: structuredClone(
          mockRecords[`state-vault-${state.vaultGlobal.activeSlip44}`]
        ),
      };
    },
  };
  const recover = async () => {
    const ticket = await beginWalletRecovery(wallet, context);
    await runWalletSetup(
      wallet,
      true,
      next,
      phrase,
      ticket,
      wallet.walletStateGeneration,
      wallet.walletSessionGeneration,
      context
    );
  };
  return {
    wallet,
    recover,
    profile,
    imported,
    pq,
    get keyring() {
      return keyring;
    },
    close: () => keyring.destroy(),
  };
}

it('matching-phrase reset preserves full account metadata, imported profile copies and signed bytes with a new password', async () => {
  const f = await fixture();
  try {
    const before = structuredClone(mockRecords);
    await f.recover();
    expect(f.wallet.createWalletExclusive).not.toHaveBeenCalled();
    expect(f.wallet.resetWalletState).not.toHaveBeenCalled();
    expect(mockRecords[JOURNAL]).toBeUndefined();
    expect(f.wallet.isUnlocked()).toBe(false);
    expect(mockRecords.state).toEqual(before.state);
    expect(
      mockRecords[importedRecoveryStorageKey(f.imported.recovery)]
    ).toEqual(before[importedRecoveryStorageKey(f.imported.recovery)]);
    expect(mockRecords[EVM_SIGNED_RECORD_PREFIX + f.profile]).toBe(
      before[EVM_SIGNED_RECORD_PREFIX + f.profile]
    );
    expect(mockRecords[PRIVATE_VAULT_STORAGE_PREFIX + f.profile]).toEqual(
      before[PRIVATE_VAULT_STORAGE_PREFIX + f.profile]
    );
    expect(
      (
        await readPrivateVaultBundle(
          mockRecords[PRIVATE_VAULT_STORAGE_PREFIX + f.profile],
          { keyring: f.keyring, generation: 0, assertCurrent: () => undefined }
        )
      ).manifest.notes
    ).toHaveLength(17);
    expect(mockRecords[getSLHDSAStateStorageKey(f.pq.keyId)]).toEqual(
      before[getSLHDSAStateStorageKey(f.pq.keyId)]
    );
    expect(
      await loadEncryptedSLHDSAState({
        keyId: f.pq.keyId,
        crypto: createSlhDsaProfileStateCrypto(f.keyring, () => undefined),
      })
    ).toEqual(f.pq);
    const oldGroups = before['state-vault-60'],
      newGroups = mockRecords['state-vault-60'];
    for (const type of Object.keys(oldGroups.accounts))
      for (const id of Object.keys(oldGroups.accounts[type])) {
        const original = oldGroups.accounts[type][id],
          restored = newGroups.accounts[type][id];
        expect({ ...restored, xprv: original.xprv }).toEqual(original);
        if (original.xprv) expect(restored.xprv).not.toBe(original.xprv);
      }
    expect(
      await f.keyring.getPrivateKeyByAccountId(
        f.imported.account.id,
        'Imported',
        next
      )
    ).toBe(`0x${'11'.repeat(32)}`);
    await expect(
      f.keyring.getPrivateKeyByAccountId(f.imported.account.id, 'Imported', old)
    ).rejects.toThrow();
  } finally {
    await f.close();
  }
});

it.each(['copy', 'pq'])(
  'refuses a missing imported copy or password-bound PQ state before modifying the pair: %s',
  async (failure) => {
    const f = await fixture();
    try {
      if (failure === 'copy')
        delete mockRecords[importedRecoveryStorageKey(f.imported.recovery)];
      else
        mockRecords['pali-slh-dsa-state:fixture'] = {
          encrypted: 'retained bytes',
        };
      const before = structuredClone(mockRecords);
      await expect(f.recover()).rejects.toThrow();
      expect(mockRecords).toEqual(before);
      expect(f.wallet.walletStateGeneration).toBe(0);
    } finally {
      await f.close();
    }
  }
);

it('a partial replacement acknowledgement restores the exact prior snapshot', async () => {
  const f = await fixture();
  try {
    const before = structuredClone(mockRecords);
    let failed = false;
    mockWrite = async (items) => {
      if (!failed && items['sysweb3-vault']) {
        failed = true;
        mockRecords['sysweb3-vault'] = items['sysweb3-vault'];
        throw Error('public partial write');
      }
      Object.assign(mockRecords, structuredClone(items));
    };
    await expect(f.recover()).rejects.toThrow('previous wallet was restored');
    expect(mockRecords).toEqual(before);
    expect(f.wallet.isUnlocked()).toBe(false);
  } finally {
    await f.close();
  }
});

it.each([
  'backup-noop',
  'replacement-noop',
  'marker-noop',
  'marker-lost-ack',
] as const)(
  'verifies storage acknowledgements at %s without losing the old or proven new wallet',
  async (fault) => {
    const f = await fixture();
    try {
      const before = structuredClone(mockRecords);
      let injected = false;
      mockWrite = async (items) => {
        const marker = items[JOURNAL];
        const hit =
          fault === 'backup-noop'
            ? marker && !marker.committedFingerprint
            : fault === 'replacement-noop'
            ? items['sysweb3-vault']
            : marker?.committedFingerprint;
        if (!injected && hit) {
          injected = true;
          if (fault === 'marker-lost-ack') {
            Object.assign(mockRecords, structuredClone(items));
            throw new Error('public lost acknowledgement');
          }
          return;
        }
        Object.assign(mockRecords, structuredClone(items));
      };
      if (fault === 'marker-lost-ack') {
        await f.recover();
        expect(mockRecords['sysweb3-vault']).not.toEqual(
          before['sysweb3-vault']
        );
        expect(mockRecords[EVM_SIGNED_RECORD_PREFIX + f.profile]).toBe(
          before[EVM_SIGNED_RECORD_PREFIX + f.profile]
        );
      } else {
        await expect(f.recover()).rejects.toThrow();
        expect(mockRecords).toEqual(before);
      }
      expect(injected).toBe(true);
      expect(mockRecords[JOURNAL]).toBeUndefined();
      expect(f.wallet.isUnlocked()).toBe(false);
    } finally {
      await f.close();
    }
  }
);

it('revocation after pair write discards the new session and restores the old exact records', async () => {
  const f = await fixture();
  try {
    const before = structuredClone(mockRecords);
    let revoked = false;
    mockWrite = async (items) => {
      Object.assign(mockRecords, structuredClone(items));
      if (items['sysweb3-vault'] && !revoked) {
        revoked = true;
        f.wallet.lock();
      }
    };
    await expect(f.recover()).rejects.toThrow('previous wallet was restored');
    expect(revoked).toBe(true);
    expect(mockRecords).toEqual(before);
    expect(f.wallet.isUnlocked()).toBe(false);
  } finally {
    await f.close();
  }
});
