import { getNetworkConfig } from '@sidhujag/sysweb3-network';
import { webcrypto } from 'crypto';
import { HDNodeWallet } from 'ethers';

jest.unmock('syscoinjs-lib');
jest.unmock('tiny-secp256k1');
// Use the actual offline SDK helpers without initializing hardware UI channels.
jest.mock('@sidhujag/sysweb3-keyring', () => ({
  ...jest.requireActual('@sidhujag/sysweb3-keyring/cjs/utils/derivation-paths'),
  ...jest.requireActual('@sidhujag/sysweb3-keyring/cjs/signers'),
}));

jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockState },
}));
jest.mock('state/rehydrate', () => ({
  rehydrateStore: jest.fn(async () => {
    mockState = structuredClone(mockOriginalState);
  }),
}));
jest.mock('utils/storageAPI', () => ({
  chromeStorage: {
    getItems: jest.fn(async (keys: string[]) =>
      Object.fromEntries(keys.map((key) => [key, mockRecords[key]]))
    ),
    setItem: jest.fn(async (key: string, value: any) => {
      mockRecords[key] = structuredClone(value);
    }),
    setItems: jest.fn(async (items: any) => {
      Object.assign(mockRecords, structuredClone(items));
    }),
    removeItem: jest.fn(async (key: string) => {
      delete mockRecords[key];
    }),
  },
}));

import { readWalletPresence } from '../utils/readWalletPresence';
import { walletPersistenceGate } from 'state/paliStorage';
import { AsyncMutex } from 'utils/asyncMutex';
import { chromeStorage } from 'utils/storageAPI';

import {
  beginWalletRecovery as beginWithContext,
  beginLockedWalletReset as beginResetWithContext,
  resetLockedWallet as resetWithContext,
  prepareWalletRecoveryAccess as prepareWithContext,
  reconcileWalletRecoveryJournal as reconcileWithContext,
  runWalletSetup as runWithContext,
} from './walletRecovery';

const PHRASE =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const OTHER_PHRASE =
  'legal winner thank year wave sausage worth useful legal winner thank yellow';
const JOURNAL = 'pali-wallet-recovery-journal:v1';
const address = HDNodeWallet.fromPhrase(PHRASE);
const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
const originalChrome = global.chrome;
let mockState: any;
let mockOriginalState: any;
let mockRecords: Record<string, any>;
let wallet: any;
let unlocked: boolean;
const context = {
  getState: () => mockState,
  persistenceMutex: new AsyncMutex(),
  readPresence: readWalletPresence,
  rehydrate: async () => {
    mockState = structuredClone(mockOriginalState);
  },
  storage: chromeStorage,
};
const beginWalletRecovery = (controller: any) =>
  beginWithContext(controller, context);
const prepareWalletRecoveryAccess = (controller: any) =>
  prepareWithContext(controller, context);
const reconcileWalletRecoveryJournal = () => reconcileWithContext(context);
const runWalletSetup = (
  controller: any,
  recovery: boolean,
  password: string,
  phrase: string,
  token: string | undefined,
  walletStateGeneration: number,
  generation: number
) =>
  runWithContext(
    controller,
    recovery,
    password,
    phrase,
    token,
    walletStateGeneration,
    generation,
    context
  );
const beginLockedReset = () =>
  wallet.authenticationMutex.runExclusive(() =>
    beginResetWithContext(wallet, context)
  );
const submitLockedReset = async (
  token: unknown,
  ...acknowledgement: [unknown?]
) => {
  const confirmation = acknowledgement.length ? acknowledgement[0] : 'ERASE';
  wallet.isCreatingWallet = true;
  try {
    return await wallet.authenticationMutex.runExclusive(() =>
      resetWithContext(wallet, token, confirmation, context)
    );
  } finally {
    wallet.isCreatingWallet = false;
  }
};
const originalRecords = () => ({
  'sysweb3-vault': 'original authenticated encrypted mnemonic',
  'sysweb3-vault-keys': { salt: 'original salt' },
  state: { vaultGlobal: { activeSlip44: 60 } },
  'state-vault-60': {
    ...mockOriginalState.vault,
    importedCiphertext: 'original encrypted imported key',
  },
  'pali-slh-dsa-state:original': { encrypted: 'original encrypted signer' },
  language: 'en',
});
const resetOwned = (key: string) =>
  key === 'sysweb3-vault' ||
  key.startsWith('sysweb3-vault-') ||
  key === 'state' ||
  key.startsWith('state-') ||
  key.startsWith('pali-slh-dsa-state:') ||
  key.startsWith('pali-slh-dsa-precompute:') ||
  key.startsWith('pali-slh-dsa-smart-account-setup:') ||
  key.startsWith('pali-slh-dsa-prepared-smart-account-signer:v1:');
const assertOriginal = () => {
  for (const [key, value] of Object.entries(originalRecords()))
    expect(mockRecords[key]).toEqual(value);
  expect(mockRecords[JOURNAL]).toBeUndefined();
};
const submit = async (
  ticket: string,
  phrase = PHRASE,
  password = 'StrongPassword12!'
) => {
  wallet.isCreatingWallet = true;
  try {
    await runWalletSetup(wallet, true, password, phrase, ticket, 0, 0);
  } finally {
    wallet.isCreatingWallet = false;
  }
};

describe('explicit seed recovery transaction', () => {
  beforeEach(() => {
    walletPersistenceGate.blocked = false;
    Object.defineProperty(globalThis, 'crypto', {
      value: webcrypto,
      configurable: true,
    });
    unlocked = false;
    mockOriginalState = {
      vault: {
        accounts: {
          HDAccount: {
            0: {
              id: 0,
              xpub: address.signingKey.publicKey,
              address: address.address,
            },
          },
        },
        activeNetwork: {
          kind: 'ethereum',
          chainId: 1,
          slip44: 60,
          currency: 'eth',
          url: 'https://example.invalid',
        },
      },
    };
    mockState = structuredClone(mockOriginalState);
    mockRecords = originalRecords();
    global.chrome = {
      runtime: {},
      storage: {
        local: {
          get: (_keys: any, callback: any) =>
            callback(structuredClone(mockRecords)),
        },
      },
    } as unknown as typeof chrome;
    jest.clearAllMocks();
    jest
      .mocked(chromeStorage.setItem)
      .mockReset()
      .mockImplementation(async (key, value) => {
        mockRecords[key] = structuredClone(value);
      });
    jest
      .mocked(chromeStorage.setItems)
      .mockReset()
      .mockImplementation(async (items) => {
        Object.assign(mockRecords, structuredClone(items));
      });
    jest
      .mocked(chromeStorage.removeItem)
      .mockReset()
      .mockImplementation(async (key) => {
        for (const item of Array.isArray(key) ? key : [key])
          delete mockRecords[item];
      });
    wallet = {
      walletSessionGeneration: 0,
      walletStateGeneration: 0,
      isCreatingWallet: false,
      recoveryJournalPending: false,
      resetRateLimitState: jest.fn(),
      authenticationMutex: new AsyncMutex(),
      isAnyKeyringUnlocked: () => unlocked,
      isUnlocked: () => unlocked,
      lock: jest.fn(() => {
        wallet.walletSessionGeneration += 1;
        unlocked = false;
      }),
      isSeedValid: (phrase: string) => [PHRASE, OTHER_PHRASE].includes(phrase),
      resetWalletState: jest.fn(async () => {
        wallet.walletSessionGeneration += 1;
        wallet.walletStateGeneration += 1;
        unlocked = false;
        for (const key of Object.keys(mockRecords).filter(resetOwned))
          delete mockRecords[key];
      }),
      createWalletExclusive: jest.fn(async () => {
        await wallet.resetWalletState();
        mockRecords['sysweb3-vault'] = 'new authenticated encrypted mnemonic';
        mockRecords['sysweb3-vault-keys'] = { salt: 'new salt' };
        mockRecords['state'] = {
          vaultGlobal: { activeSlip44: 57, hasEncryptedVault: true },
        };
        mockState = structuredClone(mockOriginalState);
        mockRecords['state-vault-57'] = {
          accounts: structuredClone(mockState.vault.accounts),
        };
        unlocked = true;
      }),
    };
  });

  afterEach(() => {
    walletPersistenceGate.blocked = false;
    global.chrome = originalChrome;
    if (originalCrypto)
      Object.defineProperty(globalThis, 'crypto', originalCrypto);
    jest.restoreAllMocks();
  });

  it('requires a locked wallet before issuing a recovery ticket', async () => {
    unlocked = true;
    await expect(beginWalletRecovery(wallet)).rejects.toThrow(
      'Lock the wallet'
    );
    expect(wallet.createWalletExclusive).not.toHaveBeenCalled();
    assertOriginal();
  });

  it('does not weaken ordinary create admission over an existing durable wallet', async () => {
    await expect(
      runWalletSetup(wallet, false, 'new password', PHRASE, undefined, 0, 0)
    ).rejects.toThrow('A wallet already exists');
    expect(wallet.createWalletExclusive).not.toHaveBeenCalled();
    assertOriginal();
  });

  it.each([
    'weakpassword1!',
    'WeakPassword!',
    'WEAKPASSWORD12!',
    'WeakPassword12',
    'Aa1!short',
  ])(
    'rejects a recovery password outside the existing strong policy: %s',
    async (password) => {
      const ticket = await beginWalletRecovery(wallet);
      await expect(submit(ticket, PHRASE, password)).rejects.toThrow(
        'strong password'
      );
      expect(wallet.createWalletExclusive).not.toHaveBeenCalled();
      assertOriginal();
    }
  );

  it.each([57, 1])(
    'matches the actual SDK UTXO xpub at a saved account index for slip44 %s without a backend query',
    async (slip44) => {
      const { getSyscoinSigners } = jest.requireActual(
        '@sidhujag/sysweb3-keyring/cjs/signers'
      );
      const network = {
        kind: 'syscoin',
        chainId: slip44,
        slip44,
        currency: slip44 === 1 ? 'tsys' : 'sys',
        url: 'https://example.invalid',
      };
      const { hd } = getSyscoinSigners({
        mnemonic: PHRASE,
        rpc: {
          formattedNetwork: network,
          networkConfig: getNetworkConfig(slip44, network.currency),
        },
      });
      hd.createAccountAtIndex(3, 84);
      mockState.vault.activeNetwork = network;
      mockState.vault.accounts.HDAccount = {
        3: {
          id: 3,
          xpub: hd.getAccountXpub(),
          address: hd.createAddress(7, false, 84),
        },
      };
      const ticket = await beginWalletRecovery(wallet);
      await submit(ticket);
      expect(wallet.createWalletExclusive).toHaveBeenCalledTimes(1);
    }
  );

  it.each(
    [0, 3, 500].flatMap((index): [number, string][] => [
      [index, PHRASE],
      [index, OTHER_PHRASE],
    ])
  )(
    'matches the real recovery proof to the published SDK EVM derivation at index %s',
    async (index, phrase) => {
      const { deriveEvmAccountFromMnemonic } = jest.requireActual(
        '@sidhujag/sysweb3-keyring/cjs/transactions/evm-local-signer'
      );
      const { getAddressDerivationPath } = jest.requireActual(
        '@sidhujag/sysweb3-keyring/cjs/utils/derivation-paths'
      );
      const path = getAddressDerivationPath('eth', 60, 0, false, index);
      const sdk = deriveEvmAccountFromMnemonic(phrase, path);
      mockState.vault.accounts.HDAccount = {
        [index]: { id: index, address: sdk.address, xpub: sdk.publicKey },
      };
      const ticket = await beginWalletRecovery(wallet);
      await submit(ticket, phrase);
      expect(wallet.createWalletExclusive).toHaveBeenCalledTimes(1);
      expect(wallet.createWalletExclusive).toHaveBeenCalledWith(
        'StrongPassword12!',
        phrase
      );
    }
  );

  it.each([true, false])(
    'clears the transient EVM seed buffer after matching proof: %s',
    async (matching) => {
      const bip39 = jest.requireActual('bip39') as typeof import('bip39');
      const original = bip39.mnemonicToSeedSync;
      const buffers: Buffer[] = [];
      jest.spyOn(bip39, 'mnemonicToSeedSync').mockImplementation((phrase) => {
        const seed = original(phrase);
        buffers.push(seed);
        return seed;
      });
      const ticket = await beginWalletRecovery(wallet);
      if (matching) await submit(ticket);
      else
        await expect(submit(ticket, OTHER_PHRASE)).rejects.toThrow(
          'does not match'
        );
      expect(buffers).toHaveLength(1);
      expect(buffers[0].every((byte) => byte === 0)).toBe(true);
    }
  );

  it('requires both the SDK public-key representation and address to match the recovery seed', async () => {
    mockState.vault.accounts.HDAccount[0].xpub =
      HDNodeWallet.fromPhrase(OTHER_PHRASE).signingKey.publicKey;
    const ticket = await beginWalletRecovery(wallet);
    await expect(submit(ticket)).rejects.toThrow('does not match');
    expect(wallet.createWalletExclusive).not.toHaveBeenCalled();
    assertOriginal();
  });

  it.each([
    'forged',
    'expired',
    'invalid seed',
    'wrong seed',
    'changed account',
    'changed storage',
    'unlocked',
  ])(
    'preserves the encrypted old wallet on %s admission failure',
    async (failure) => {
      let ticket = await beginWalletRecovery(wallet);
      let phrase = PHRASE;
      if (failure === 'forged') ticket = 'not the recovery capability';
      if (failure === 'expired')
        jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 11 * 60 * 1000);
      if (failure === 'invalid seed') phrase = 'invalid phrase';
      if (failure === 'wrong seed') phrase = OTHER_PHRASE;
      if (failure === 'changed account')
        mockState.vault.accounts.HDAccount[0].address =
          address.address.toLowerCase() + '0';
      if (failure === 'changed storage')
        mockRecords['sysweb3-vault'] = 'a later encrypted vault';
      if (failure === 'unlocked') unlocked = true;
      const before = structuredClone(mockRecords);
      await expect(submit(ticket, phrase)).rejects.toThrow();
      expect(mockRecords).toEqual(before);
      expect(wallet.createWalletExclusive).not.toHaveBeenCalled();
    }
  );

  it('fails before reset if the encrypted backup cannot be durably written', async () => {
    const ticket = await beginWalletRecovery(wallet);
    jest
      .mocked(chromeStorage.setItem)
      .mockRejectedValueOnce(new Error('backup write failed'));
    await expect(submit(ticket)).rejects.toThrow('backup write failed');
    expect(wallet.resetWalletState).not.toHaveBeenCalled();
    assertOriginal();
  });

  it('journals only the old encrypted records before any destructive initialization', async () => {
    const ticket = await beginWalletRecovery(wallet);
    const initialize = wallet.createWalletExclusive.getMockImplementation();
    wallet.createWalletExclusive.mockImplementation(async () => {
      const serialized = JSON.stringify(mockRecords[JOURNAL]);
      expect(serialized).not.toContain(PHRASE);
      expect(serialized).not.toContain('StrongPassword12!');
      expect(mockRecords[JOURNAL].before).toMatchObject({
        'sysweb3-vault': 'original authenticated encrypted mnemonic',
        'state-vault-60': {
          importedCiphertext: 'original encrypted imported key',
        },
      });
      await initialize();
    });
    await submit(ticket);
    expect(mockRecords['sysweb3-vault']).toBe(
      'new authenticated encrypted mnemonic'
    );
    expect(mockRecords[JOURNAL]).toBeUndefined();
  });

  it('restores the complete old snapshot after partial initializer failure', async () => {
    const ticket = await beginWalletRecovery(wallet);
    wallet.createWalletExclusive.mockImplementation(async () => {
      await wallet.resetWalletState();
      mockRecords['sysweb3-vault'] = 'partial new encrypted vault';
      mockRecords['state-vault-57'] = { partial: true };
      throw new Error('initialization failed');
    });
    await expect(submit(ticket)).rejects.toThrow(
      'previous wallet was restored'
    );
    assertOriginal();
    expect(mockRecords['state-vault-57'] ?? null).toBeNull();
    expect(unlocked).toBe(false);
    expect(mockState).toEqual(mockOriginalState);
  });

  it.each([
    'state-vault-60',
    'state-vault-57-passkey-profile',
    'state-vault-60-passkey-profile',
    'sysweb3-vault-60',
    'pali-slh-dsa-state:old',
    'pali-slh-dsa-precompute:old',
    'pali-slh-dsa-smart-account-setup:old',
    'pali-slh-dsa-prepared-smart-account-signer:v1:old',
  ])(
    'rolls back when reset leaves the old %s record beside the newly initialized wallet',
    async (key) => {
      const oldRecord = { encrypted: `original encrypted ${key}` };
      mockRecords[key] ??= oldRecord;
      const original = structuredClone(mockRecords);
      const ticket = await beginWalletRecovery(wallet);
      const reset = wallet.resetWalletState.getMockImplementation();
      wallet.resetWalletState.mockImplementation(async () => {
        const surviving = structuredClone(mockRecords[key]);
        await reset();
        // MainController reset intentionally catches deletion errors. This
        // models a record whose failed deletion leaves its original value.
        mockRecords[key] = surviving;
      });

      await expect(submit(ticket)).rejects.toThrow(
        'previous wallet was restored'
      );

      for (const [recordKey, record] of Object.entries(original))
        expect(mockRecords[recordKey]).toEqual(record);
      expect(mockRecords[JOURNAL]).toBeUndefined();
      expect(mockRecords['state-vault-57'] ?? null).toBeNull();
      expect(unlocked).toBe(false);
      expect(wallet.resetWalletState).toHaveBeenCalledTimes(2);
    }
  );

  it.each([
    'extra HD account',
    'imported account',
    'smart account',
    'embedded passkey profile',
    'inline main-state vault',
    'HD0 smart account metadata',
    'old HD0 encrypted private key',
    'extra account assets',
    'extra account transactions',
  ])(
    'rejects an old %s copy even when the new cipher pair and HD0 are present',
    async (copy) => {
      const ticket = await beginWalletRecovery(wallet);
      const initialize = wallet.createWalletExclusive.getMockImplementation();
      wallet.createWalletExclusive.mockImplementation(async () => {
        await initialize();
        const vault = mockRecords['state-vault-57'];
        const oldAccount = { id: 1, xprv: 'original encrypted imported key' };
        if (copy === 'extra HD account')
          vault.accounts.HDAccount[1] = oldAccount;
        if (copy === 'imported account')
          vault.accounts.Imported = { 1: oldAccount };
        if (copy === 'smart account')
          vault.accounts.SmartAccount = { 1: oldAccount };
        if (copy === 'embedded passkey profile')
          vault.passkeyCredentialProfile = {
            id: 'original passkey credential',
          };
        if (copy === 'inline main-state vault')
          mockRecords.state.vault = {
            accounts: { Imported: { 1: oldAccount } },
          };
        if (copy === 'HD0 smart account metadata')
          vault.accounts.HDAccount[0].smartAccount = {
            authenticator: 'original passkey credential',
          };
        if (copy === 'old HD0 encrypted private key') {
          mockState.vault.accounts.HDAccount[0].xprv = 'new encrypted HD key';
          vault.accounts.HDAccount[0].xprv = 'original encrypted HD key';
        }
        if (copy === 'extra account assets')
          vault.accountAssets = { Imported: { 1: { syscoin: [] } } };
        if (copy === 'extra account transactions')
          vault.accountTransactions = { Imported: { 1: { syscoin: {} } } };
      });

      await expect(submit(ticket)).rejects.toThrow(
        'previous wallet was restored'
      );
      assertOriginal();
      expect(unlocked).toBe(false);
    }
  );

  it('allows null tombstones for reset-owned records without reviving old data', async () => {
    const ticket = await beginWalletRecovery(wallet);
    const initialize = wallet.createWalletExclusive.getMockImplementation();
    wallet.createWalletExclusive.mockImplementation(async () => {
      await initialize();
      mockRecords['state-vault-60'] = null;
      mockRecords['state-vault-57-passkey-profile'] = null;
      mockRecords['pali-slh-dsa-state:old'] = null;
    });

    await submit(ticket);
    expect(mockRecords[JOURNAL]).toBeUndefined();
    expect(mockRecords['sysweb3-vault']).toBe(
      'new authenticated encrypted mnemonic'
    );
    expect(mockRecords['state-vault-60']).toBeNull();
  });

  it.each([false, true])(
    'handles a commit-marker failure after durable write: %s',
    async (afterWrite) => {
      const ticket = await beginWalletRecovery(wallet);
      const write = jest.mocked(chromeStorage.setItem).getMockImplementation()!;
      jest
        .mocked(chromeStorage.setItem)
        .mockImplementation(async (key, value) => {
          if (value.committedFingerprint) {
            if (afterWrite) await write(key, value);
            throw new Error('marker acknowledgement failed');
          }
          await write(key, value);
        });
      if (afterWrite) {
        await submit(ticket);
        expect(mockRecords['sysweb3-vault']).toBe(
          'new authenticated encrypted mnemonic'
        );
        expect(wallet.resetWalletState).toHaveBeenCalledTimes(1);
      } else {
        await expect(submit(ticket)).rejects.toThrow(
          'previous wallet was restored'
        );
        assertOriginal();
      }
    }
  );

  it('restores an interrupted uncommitted journal on cold startup', async () => {
    const ticket = await beginWalletRecovery(wallet);
    wallet.createWalletExclusive.mockImplementation(async () => {
      await wallet.resetWalletState();
      mockRecords['sysweb3-vault'] = 'interrupted new vault';
      mockRecords['state-vault-57'] = { interrupted: true };
      wallet.resetWalletState.mockRejectedValue(new Error('worker stopped'));
      throw new Error('worker stopped');
    });
    await expect(submit(ticket)).rejects.toThrow('worker stopped');
    expect(mockRecords[JOURNAL]).toBeDefined();
    await expect(reconcileWalletRecoveryJournal()).resolves.toBe(true);
    assertOriginal();
    expect(mockRecords['state-vault-57']).toBeNull();
    await expect(reconcileWalletRecoveryJournal()).resolves.toBe(false);
  });

  it('retains a committed wallet when journal cleanup failed before worker restart', async () => {
    const ticket = await beginWalletRecovery(wallet);
    jest
      .mocked(chromeStorage.removeItem)
      .mockRejectedValueOnce(new Error('worker stopped'));
    await expect(submit(ticket)).rejects.toThrow('recovery cleanup');
    expect(mockRecords[JOURNAL].committedFingerprint).toBeDefined();
    expect(unlocked).toBe(false);
    expect(wallet.lock).toHaveBeenCalledTimes(1);
    expect(wallet.resetWalletState).toHaveBeenCalledTimes(1);
    expect(wallet.recoveryJournalPending).toBe(true);
    await expect(reconcileWalletRecoveryJournal()).resolves.toBe(false);
    expect(mockRecords['sysweb3-vault']).toBe(
      'new authenticated encrypted mnemonic'
    );
    expect(mockRecords[JOURNAL]).toBeUndefined();
  });

  it.each(['cold startup', 'same-worker access'])(
    'keeps the committed pair and backup closed during %s when old records remain',
    async (path) => {
      const ticket = await beginWalletRecovery(wallet);
      jest
        .mocked(chromeStorage.removeItem)
        .mockRejectedValueOnce(new Error('worker stopped'));
      await expect(submit(ticket)).rejects.toThrow('recovery cleanup');
      mockRecords['state-vault-60'] = structuredClone(
        mockRecords[JOURNAL].before['state-vault-60']
      );
      const before = structuredClone(mockRecords);

      await expect(
        path === 'cold startup'
          ? reconcileWalletRecoveryJournal()
          : prepareWalletRecoveryAccess(wallet)
      ).rejects.toThrow('unexpected wallet data');

      expect(mockRecords).toEqual(before);
      expect(wallet.recoveryJournalPending).toBe(true);
      expect(unlocked).toBe(false);
    }
  );

  it('locks the initialized session before a secondary recovery read can fail', async () => {
    const ticket = await beginWalletRecovery(wallet);
    const initialize = wallet.createWalletExclusive.getMockImplementation();
    wallet.createWalletExclusive.mockImplementation(async () => {
      await initialize();
      (chrome.runtime as any).lastError = new Error('storage unavailable');
    });
    await expect(submit(ticket)).rejects.toThrow('storage unavailable');
    expect(unlocked).toBe(false);
    expect(wallet.lock).toHaveBeenCalledTimes(1);
    expect(wallet.resetWalletState).toHaveBeenCalledTimes(1);
    expect(wallet.recoveryJournalPending).toBe(true);
    expect(mockRecords[JOURNAL]).toBeDefined();
    expect(mockRecords['sysweb3-vault']).toBe(
      'new authenticated encrypted mnemonic'
    );
  });

  it.each([undefined, { version: 99 }])(
    'locks the initialized session before rejecting an unreadable durable marker %p',
    async (marker) => {
      const ticket = await beginWalletRecovery(wallet);
      const initialize = wallet.createWalletExclusive.getMockImplementation();
      wallet.createWalletExclusive.mockImplementation(async () => {
        await initialize();
        delete mockRecords['state-vault-57'];
        mockRecords[JOURNAL] = marker;
      });
      await expect(submit(ticket)).rejects.toThrow('journal is invalid');
      expect(unlocked).toBe(false);
      expect(wallet.lock).toHaveBeenCalledTimes(1);
      expect(wallet.resetWalletState).toHaveBeenCalledTimes(1);
      expect(wallet.recoveryJournalPending).toBe(true);
      await expect(prepareWalletRecoveryAccess(wallet)).rejects.toThrow();
      expect(wallet.recoveryJournalPending).toBe(true);
      expect(mockRecords['sysweb3-vault']).toBe(
        'new authenticated encrypted mnemonic'
      );
    }
  );

  it('refuses to commit a new ciphertext pair without its durable HD account state', async () => {
    const ticket = await beginWalletRecovery(wallet);
    const initialize = wallet.createWalletExclusive.getMockImplementation();
    wallet.createWalletExclusive.mockImplementation(async () => {
      await initialize();
      delete mockRecords['state-vault-57'];
    });
    await expect(submit(ticket)).rejects.toThrow(
      'previous wallet was restored'
    );
    assertOriginal();
  });

  it('validates stable committed identity while allowing balance and active-network updates', async () => {
    const ticket = await beginWalletRecovery(wallet);
    jest
      .mocked(chromeStorage.removeItem)
      .mockRejectedValueOnce(new Error('worker stopped'));
    await expect(submit(ticket)).rejects.toThrow('recovery cleanup');
    mockRecords['state-vault-57'].accounts.HDAccount[0].balances = {
      syscoin: 123,
    };
    mockRecords['state-vault-57'].accounts.HDAccount[0].label =
      'renamed account';
    mockRecords['state-vault-57'].accounts.HDAccount[0].address =
      'legitimate-next-UTXO-receiving-address';
    mockRecords.state.vaultGlobal.activeSlip44 = 60;
    await expect(reconcileWalletRecoveryJournal()).resolves.toBe(false);
    expect(mockRecords['sysweb3-vault']).toBe(
      'new authenticated encrypted mnemonic'
    );
  });

  it('accepts canonical HD0 asset/history updates and real UTXO receiving-address advancement', async () => {
    const { getSyscoinSigners } = jest.requireActual(
      '@sidhujag/sysweb3-keyring/cjs/signers'
    );
    const {
      default: vaultReducer,
      createAccount,
      initializeCleanVaultForSlip44,
      setAccountAssets,
      setSingleTransactionToState,
    } = jest.requireActual('state/vault');
    const { SYSCOIN_UTXO_MAINNET_NETWORK: network } =
      jest.requireActual('utils/constants');
    const { hd } = getSyscoinSigners({
      mnemonic: PHRASE,
      rpc: {
        formattedNetwork: network,
        networkConfig: getNetworkConfig(network.slip44, network.currency),
      },
    });
    hd.createAccountAtIndex(0, 84);
    const ticket = await beginWalletRecovery(wallet);
    const initialize = wallet.createWalletExclusive.getMockImplementation();
    wallet.createWalletExclusive.mockImplementation(async () => {
      await initialize();
      let vault = vaultReducer(
        undefined,
        initializeCleanVaultForSlip44(network)
      );
      vault = vaultReducer(
        vault,
        createAccount({
          accountType: 'HDAccount',
          account: {
            id: 0,
            address: hd.createAddress(0, false, 84),
            xpub: hd.getAccountXpub(),
            xprv: 'new encrypted HD0 key',
          },
        })
      );
      vault = vaultReducer(
        vault,
        setAccountAssets({
          accountId: 0,
          accountType: 'HDAccount',
          assets: { syscoin: [{ assetGuid: '123', balance: 1 }], ethereum: [] },
        })
      );
      vault = vaultReducer(
        vault,
        setSingleTransactionToState({
          accountId: 0,
          accountType: 'HDAccount',
          networkType: 'syscoin',
          chainId: network.chainId,
          transaction: { txid: 'public-history-fixture', confirmations: 1 },
        })
      );
      mockState.vault = vault;
      mockRecords['state-vault-57'] = structuredClone(vault);
    });
    jest
      .mocked(chromeStorage.removeItem)
      .mockRejectedValueOnce(new Error('worker stopped'));
    await expect(submit(ticket)).rejects.toThrow('recovery cleanup');

    const firstAddress =
      mockRecords['state-vault-57'].accounts.HDAccount[0].address;
    const nextAddress = hd.createAddress(1, false, 84);
    expect(nextAddress).not.toBe(firstAddress);
    mockRecords['state-vault-57'].accounts.HDAccount[0].address = nextAddress;
    await expect(reconcileWalletRecoveryJournal()).resolves.toBe(false);

    expect(mockRecords[JOURNAL]).toBeUndefined();
    expect(mockRecords['state-vault-57'].accounts.HDAccount[0].xpub).toBe(
      hd.getAccountXpub()
    );
    expect(
      mockRecords['state-vault-57'].accountAssets.HDAccount[0].syscoin
    ).toEqual([{ assetGuid: '123', balance: 1 }]);
    expect(
      mockRecords['state-vault-57'].accountTransactions.HDAccount[0].syscoin[
        network.chainId
      ]
    ).toHaveLength(1);
  });

  it('fails closed if the committed public identity no longer matches its marker', async () => {
    const ticket = await beginWalletRecovery(wallet);
    jest
      .mocked(chromeStorage.removeItem)
      .mockRejectedValueOnce(new Error('worker stopped'));
    await expect(submit(ticket)).rejects.toThrow('recovery cleanup');
    mockRecords['state-vault-57'].accounts.HDAccount[0].xpub =
      'a different public identity';
    const before = structuredClone(mockRecords);
    await expect(reconcileWalletRecoveryJournal()).rejects.toThrow(
      'does not match'
    );
    expect(mockRecords).toEqual(before);
  });

  it('requires committed cleanup before unlocking or forgetting can mutate the encrypted pair', async () => {
    const ticket = await beginWalletRecovery(wallet);
    jest
      .mocked(chromeStorage.removeItem)
      .mockRejectedValueOnce(new Error('cleanup unavailable'));
    await expect(submit(ticket)).rejects.toThrow('recovery cleanup');
    jest
      .mocked(chromeStorage.removeItem)
      .mockRejectedValueOnce(new Error('cleanup still unavailable'));
    const before = structuredClone(mockRecords);
    await expect(prepareWalletRecoveryAccess(wallet)).rejects.toThrow(
      'cleanup still unavailable'
    );
    expect(mockRecords).toEqual(before);
    expect(wallet.recoveryJournalPending).toBe(true);
    expect(unlocked).toBe(false);
    await prepareWalletRecoveryAccess(wallet);
    expect(wallet.recoveryJournalPending).toBe(false);
    expect(mockRecords[JOURNAL]).toBeUndefined();
    mockRecords['sysweb3-vault'] = 'legitimate-password-change-ciphertext';
    await expect(reconcileWalletRecoveryJournal()).resolves.toBe(false);
    expect(mockRecords['sysweb3-vault']).toBe(
      'legitimate-password-change-ciphertext'
    );
  });

  it('never clears an unfinished recovery journal for an unlock or forget request', async () => {
    const ticket = await beginWalletRecovery(wallet);
    wallet.createWalletExclusive.mockRejectedValue(
      new Error('initialization failed')
    );
    wallet.resetWalletState.mockRejectedValue(new Error('worker stopped'));
    await expect(submit(ticket)).rejects.toThrow('worker stopped');
    const before = structuredClone(mockRecords);
    await expect(prepareWalletRecoveryAccess(wallet)).rejects.toThrow(
      'finish wallet recovery'
    );
    expect(mockRecords).toEqual(before);
    expect(wallet.recoveryJournalPending).toBe(true);
  });

  it('fails closed when a committed wallet loses its mandatory HD state', async () => {
    const ticket = await beginWalletRecovery(wallet);
    jest
      .mocked(chromeStorage.removeItem)
      .mockRejectedValueOnce(new Error('cleanup unavailable'));
    await expect(submit(ticket)).rejects.toThrow('recovery cleanup');
    delete mockRecords['state-vault-57'];
    const before = structuredClone(mockRecords);
    await expect(reconcileWalletRecoveryJournal()).rejects.toThrow(
      'account state was not durably saved'
    );
    expect(mockRecords).toEqual(before);
  });

  it('fails closed on a damaged journal without erasing current records', async () => {
    const ticket = await beginWalletRecovery(wallet);
    wallet.createWalletExclusive.mockRejectedValue(
      new Error('initialization failed')
    );
    wallet.resetWalletState.mockRejectedValue(new Error('worker stopped'));
    await expect(submit(ticket)).rejects.toThrow('worker stopped');
    mockRecords[JOURNAL].before['sysweb3-vault'] = 'changed ciphertext';
    const before = structuredClone(mockRecords);
    await expect(reconcileWalletRecoveryJournal()).rejects.toThrow(
      'journal is damaged'
    );
    expect(mockRecords).toEqual(before);
  });

  it.each([false, 0, '', [], {}])(
    'fails closed on malformed present journal %p',
    async (stored) => {
      mockRecords[JOURNAL] = stored;
      const before = structuredClone(mockRecords);
      await expect(beginWalletRecovery(wallet)).rejects.toThrow(
        'previous recovery'
      );
      await expect(reconcileWalletRecoveryJournal()).rejects.toThrow(
        'journal is invalid'
      );
      expect(mockRecords).toEqual(before);
      expect(wallet.createWalletExclusive).not.toHaveBeenCalled();
    }
  );

  it('does not admit ordinary setup over a pending journal even when its current pair is absent', async () => {
    const ticket = await beginWalletRecovery(wallet);
    wallet.createWalletExclusive.mockImplementation(async () => {
      await wallet.resetWalletState();
      wallet.resetWalletState.mockRejectedValue(new Error('worker stopped'));
      throw new Error('worker stopped');
    });
    await expect(submit(ticket)).rejects.toThrow('worker stopped');
    const before = structuredClone(mockRecords);
    await expect(
      runWalletSetup(
        wallet,
        false,
        'other password',
        PHRASE,
        undefined,
        wallet.walletStateGeneration,
        wallet.walletSessionGeneration
      )
    ).rejects.toThrow('previous recovery');
    expect(mockRecords).toEqual(before);
    expect(wallet.createWalletExclusive).toHaveBeenCalledTimes(1);
  });

  it('retains the backup if rollback storage fails, then restores it on cold startup', async () => {
    const ticket = await beginWalletRecovery(wallet);
    wallet.createWalletExclusive.mockRejectedValue(
      new Error('initialization failed')
    );
    jest
      .mocked(chromeStorage.setItems)
      .mockRejectedValueOnce(new Error('rollback storage failed'));
    await expect(submit(ticket)).rejects.toThrow('rollback storage failed');
    expect(mockRecords[JOURNAL].before['sysweb3-vault']).toBe(
      'original authenticated encrypted mnemonic'
    );
    await expect(reconcileWalletRecoveryJournal()).resolves.toBe(true);
    assertOriginal();
  });

  it('rejects an unrelated lock during initialization and restores the old wallet', async () => {
    const ticket = await beginWalletRecovery(wallet);
    const initialize = wallet.createWalletExclusive.getMockImplementation();
    wallet.createWalletExclusive.mockImplementation(async () => {
      await initialize();
      wallet.walletSessionGeneration += 1;
      unlocked = false;
    });
    await expect(submit(ticket)).rejects.toThrow(
      'previous wallet was restored'
    );
    assertOriginal();
  });

  it('does not journal after an unrelated lock while the original records are being read', async () => {
    const ticket = await beginWalletRecovery(wallet);
    let release!: () => void;
    chrome.storage.local.get = ((_keys: any, callback: any) => {
      release = () => callback(structuredClone(mockRecords));
    }) as any;
    const recovery = submit(ticket);
    const rejection = expect(recovery).rejects.toThrow('Wallet state changed');
    for (let wait = 0; !release && wait < 100; wait += 1)
      await new Promise((resolve) => setTimeout(resolve, 0));
    expect(release).toBeDefined();
    wallet.walletSessionGeneration += 1;
    release();
    await rejection;
    expect(wallet.createWalletExclusive).not.toHaveBeenCalled();
    assertOriginal();
  });

  it('rechecks wallet generation after waiting for earlier authentication', async () => {
    const ticket = await beginWalletRecovery(wallet);
    let release!: () => void;
    const earlier = wallet.authenticationMutex.runExclusive(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );
    const recovery = submit(ticket);
    const rejection = expect(recovery).rejects.toThrow('Wallet state changed');
    await Promise.resolve();
    wallet.walletStateGeneration += 1;
    release();
    await earlier;
    await rejection;
    expect(wallet.createWalletExclusive).not.toHaveBeenCalled();
    assertOriginal();
  });

  it('consumes the ticket so a failed submission cannot replay the recovery', async () => {
    const ticket = await beginWalletRecovery(wallet);
    await expect(submit(ticket, OTHER_PHRASE)).rejects.toThrow(
      'does not match'
    );
    await expect(submit(ticket)).rejects.toThrow('Seed recovery expired');
    expect(wallet.createWalletExclusive).not.toHaveBeenCalled();
    assertOriginal();
  });

  it('does not let an older popup consume the newer popup recovery ticket', async () => {
    const older = await beginWalletRecovery(wallet);
    const newer = await beginWalletRecovery(wallet);
    expect(older).not.toBe(newer);
    await expect(submit(older)).rejects.toThrow('Seed recovery expired');
    expect(wallet.createWalletExclusive).not.toHaveBeenCalled();
    assertOriginal();
    await submit(newer);
    expect(wallet.createWalletExclusive).toHaveBeenCalledTimes(1);
    expect(mockRecords['sysweb3-vault']).toBe(
      'new authenticated encrypted mnemonic'
    );
  });
  describe('explicit locked-wallet reset', () => {
    it('issues a random confirmation ticket without reading a seed or writing wallet data', async () => {
      const seedValidation = jest.spyOn(wallet, 'isSeedValid');
      const before = structuredClone(mockRecords);
      const first = await beginLockedReset();
      const second = await beginLockedReset();
      expect(first).toMatch(/^[0-9a-f]{64}$/);
      expect(second).toMatch(/^[0-9a-f]{64}$/);
      expect(second).not.toBe(first);
      expect(mockRecords).toEqual(before);
      expect(seedValidation).not.toHaveBeenCalled();
      expect(chromeStorage.setItem).not.toHaveBeenCalled();
      expect(chromeStorage.setItems).not.toHaveBeenCalled();
      expect(chromeStorage.removeItem).not.toHaveBeenCalled();
      expect(wallet.resetWalletState).not.toHaveBeenCalled();
    });

    it('erases a locked wallet only after explicit confirmation without an old password or seed', async () => {
      const ticket = await beginLockedReset();
      await expect(submitLockedReset(ticket)).resolves.toBeUndefined();
      expect(wallet.resetWalletState).toHaveBeenCalledTimes(1);
      expect(wallet.resetWalletState).toHaveBeenCalledWith({
        resetNetworks: true,
      });
      expect(wallet.createWalletExclusive).not.toHaveBeenCalled();
      expect(mockRecords).toEqual({ language: 'en' });
      expect(wallet.recoveryJournalPending).toBe(false);
      expect(walletPersistenceGate.blocked).toBe(false);
    });

    it.each([undefined, null, 123, 'wrong-token'])(
      'refuses an absent or unrelated reset ticket: %p',
      async (token) => {
        await beginLockedReset();
        await expect(submitLockedReset(token)).rejects.toThrow(
          'Wallet reset expired'
        );
        expect(wallet.resetWalletState).not.toHaveBeenCalled();
        assertOriginal();
      }
    );

    it.each([undefined, null, true, '', 'erase', ' ERASE ', 1])(
      'requires the exact destructive acknowledgement and consumes a rejected matching attempt: %p',
      async (confirmation) => {
        const ticket = await beginLockedReset();
        await expect(submitLockedReset(ticket, confirmation)).rejects.toThrow(
          'typing ERASE'
        );
        await expect(submitLockedReset(ticket)).rejects.toThrow(
          'Wallet reset expired'
        );
        expect(wallet.resetWalletState).not.toHaveBeenCalled();
        assertOriginal();
      }
    );

    it('rejects replay after successful deletion', async () => {
      const ticket = await beginLockedReset();
      await submitLockedReset(ticket);
      await expect(submitLockedReset(ticket)).rejects.toThrow(
        'Wallet reset expired'
      );
      expect(wallet.resetWalletState).toHaveBeenCalledTimes(1);
      expect(mockRecords).toEqual({ language: 'en' });
    });

    it('does not let an older popup consume a newer reset ticket', async () => {
      const older = await beginLockedReset();
      const newer = await beginLockedReset();
      await expect(submitLockedReset(older)).rejects.toThrow(
        'Wallet reset expired'
      );
      expect(wallet.resetWalletState).not.toHaveBeenCalled();
      assertOriginal();
      await submitLockedReset(newer);
      expect(wallet.resetWalletState).toHaveBeenCalledTimes(1);
    });

    it.each([10 * 60 * 1000 + 1, -1])(
      'rejects an expired or backward-clock reset ticket: %pms',
      async (offset) => {
        const now = Date.now();
        jest.spyOn(Date, 'now').mockReturnValue(now);
        const ticket = await beginLockedReset();
        jest.mocked(Date.now).mockReturnValue(now + offset);
        await expect(submitLockedReset(ticket)).rejects.toThrow(
          'Wallet reset expired'
        );
        expect(wallet.resetWalletState).not.toHaveBeenCalled();
        assertOriginal();
      }
    );

    it('rejects reset initiation when any keyring is unlocked', async () => {
      unlocked = true;
      await expect(beginLockedReset()).rejects.toThrow('Lock the wallet');
      expect(wallet.resetWalletState).not.toHaveBeenCalled();
      assertOriginal();
    });

    it('rejects a previously issued ticket if another unlock succeeds', async () => {
      const ticket = await beginLockedReset();
      unlocked = true;
      await expect(submitLockedReset(ticket)).rejects.toThrow(
        'Lock the wallet'
      );
      unlocked = false;
      await expect(submitLockedReset(ticket)).rejects.toThrow(
        'Wallet reset expired'
      );
      expect(wallet.resetWalletState).not.toHaveBeenCalled();
      assertOriginal();
    });

    it.each(['walletSessionGeneration', 'walletStateGeneration'])(
      'rejects a ticket after %s changes',
      async (field) => {
        const ticket = await beginLockedReset();
        wallet[field] += 1;
        await expect(submitLockedReset(ticket)).rejects.toThrow(
          'Wallet state changed'
        );
        expect(wallet.resetWalletState).not.toHaveBeenCalled();
        assertOriginal();
      }
    );

    it.each(['sysweb3-vault', 'sysweb3-vault-keys'])(
      'rejects a ticket after its stored identity changes: %s',
      async (key) => {
        const ticket = await beginLockedReset();
        mockRecords[key] =
          key === 'sysweb3-vault'
            ? 'different ciphertext'
            : { salt: 'different salt' };
        const changed = structuredClone(mockRecords);
        await expect(submitLockedReset(ticket)).rejects.toThrow(
          'Wallet storage changed'
        );
        expect(wallet.resetWalletState).not.toHaveBeenCalled();
        expect(mockRecords).toEqual(changed);
      }
    );

    it('rechecks lock and generation after its asynchronous storage read', async () => {
      const ticket = await beginLockedReset();
      jest
        .mocked(chromeStorage.getItems)
        .mockImplementationOnce(async (keys) => {
          const current = Object.fromEntries(
            keys.map((key) => [key, mockRecords[key]])
          );
          wallet.walletSessionGeneration += 1;
          return current;
        });
      await expect(submitLockedReset(ticket)).rejects.toThrow(
        'Wallet state changed'
      );
      expect(wallet.resetWalletState).not.toHaveBeenCalled();
      assertOriginal();
    });

    it('does not issue a ticket during setup or an unfinished recovery', async () => {
      wallet.isCreatingWallet = true;
      await expect(beginLockedReset()).rejects.toThrow('already in progress');
      wallet.isCreatingWallet = false;
      mockRecords[JOURNAL] = { version: 1 };
      await expect(beginLockedReset()).rejects.toThrow('previous recovery');
      expect(wallet.resetWalletState).not.toHaveBeenCalled();
      expect(chromeStorage.setItem).not.toHaveBeenCalled();
    });

    it('does not consume or bypass a pending recovery journal during confirmation', async () => {
      const ticket = await beginLockedReset();
      mockRecords[JOURNAL] = { version: 1 };
      const before = structuredClone(mockRecords);
      await expect(submitLockedReset(ticket)).rejects.toThrow(
        'previous recovery'
      );
      expect(mockRecords).toEqual(before);
      expect(wallet.resetWalletState).not.toHaveBeenCalled();
    });

    it('cannot use a recovery ticket for destructive reset', async () => {
      const ticket = await beginWalletRecovery(wallet);
      await expect(submitLockedReset(ticket)).rejects.toThrow(
        'Wallet reset expired'
      );
      expect(wallet.resetWalletState).not.toHaveBeenCalled();
      assertOriginal();
    });

    it('invalidates recovery tickets when a separate reset is begun', async () => {
      const recovery = await beginWalletRecovery(wallet);
      const reset = await beginLockedReset();
      await expect(submit(recovery)).rejects.toThrow('Seed recovery expired');
      assertOriginal();
      await submitLockedReset(reset);
      expect(wallet.resetWalletState).toHaveBeenCalledTimes(1);
    });

    it('does not invalidate a reset ticket when recovery cannot issue a valid ticket', async () => {
      const reset = await beginLockedReset();
      mockState.vault.accounts.HDAccount = {};
      await expect(beginWalletRecovery(wallet)).rejects.toThrow(
        'Saved HD account identity'
      );
      await expect(submitLockedReset(reset)).resolves.toBeUndefined();
      expect(wallet.resetWalletState).toHaveBeenCalledTimes(1);
      expect(mockRecords).toEqual({ language: 'en' });
    });

    it('refuses pending same-worker recovery even when its journal is absent', async () => {
      wallet.recoveryJournalPending = true;
      await expect(beginLockedReset()).rejects.toThrow('previous recovery');
      wallet.recoveryJournalPending = false;
      const reset = await beginLockedReset();
      wallet.recoveryJournalPending = true;
      await expect(submitLockedReset(reset)).rejects.toThrow(
        'previous recovery'
      );
      expect(wallet.resetWalletState).not.toHaveBeenCalled();
      assertOriginal();
    });

    it('invalidates a reset ticket when same-wallet recovery is begun', async () => {
      const reset = await beginLockedReset();
      const recovery = await beginWalletRecovery(wallet);
      await expect(submitLockedReset(reset)).rejects.toThrow(
        'Wallet reset expired'
      );
      assertOriginal();
      await submit(recovery);
      expect(wallet.createWalletExclusive).toHaveBeenCalledTimes(1);
    });

    it.each(['sysweb3-vault', 'sysweb3-vault-keys'])(
      'refuses an incomplete durable wallet when %s is missing',
      async (key) => {
        delete mockRecords[key];
        const before = structuredClone(mockRecords);
        await expect(beginLockedReset()).rejects.toThrow(
          'storage is incomplete'
        );
        expect(mockRecords).toEqual(before);
        expect(wallet.resetWalletState).not.toHaveBeenCalled();
      }
    );

    it.each(['before', 'after', 'noop'])(
      'does not delete the old wallet if its verified backup cannot be saved: %s',
      async (fault) => {
        const ticket = await beginLockedReset();
        const write = jest
          .mocked(chromeStorage.setItem)
          .getMockImplementation()!;
        jest
          .mocked(chromeStorage.setItem)
          .mockImplementationOnce(async (key, value) => {
            expect(key).toBe(JOURNAL);
            if (fault === 'after') await write(key, value);
            if (fault !== 'noop')
              throw new Error('synthetic journal write failed');
          });
        await expect(submitLockedReset(ticket)).rejects.toBeDefined();
        expect(wallet.resetWalletState).not.toHaveBeenCalled();
        assertOriginal();
        expect(walletPersistenceGate.blocked).toBe(false);
        expect(wallet.recoveryJournalPending).toBe(false);
      }
    );

    it('restores the old multi-record snapshot after a failed erase', async () => {
      const ticket = await beginLockedReset();
      const reset = wallet.resetWalletState.getMockImplementation();
      wallet.resetWalletState.mockImplementation(async () => {
        await reset();
        throw new Error('synthetic erase failure');
      });
      await expect(submitLockedReset(ticket)).rejects.toThrow(
        'synthetic erase failure'
      );
      assertOriginal();
      expect(walletPersistenceGate.blocked).toBe(false);
      expect(wallet.recoveryJournalPending).toBe(false);
    });

    it('allows ordinary creation only after the explicit erase committed', async () => {
      const ticket = await beginLockedReset();
      await submitLockedReset(ticket);
      await expect(
        runWalletSetup(
          wallet,
          false,
          'NewPassword12!',
          OTHER_PHRASE,
          undefined,
          wallet.walletStateGeneration,
          wallet.walletSessionGeneration
        )
      ).resolves.toBeUndefined();
      expect(wallet.createWalletExclusive).toHaveBeenCalledWith(
        'NewPassword12!',
        OTHER_PHRASE
      );
      expect(mockRecords['sysweb3-vault']).toBe(
        'new authenticated encrypted mnemonic'
      );
    });
  });
});
