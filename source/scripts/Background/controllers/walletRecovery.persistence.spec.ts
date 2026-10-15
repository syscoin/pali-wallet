import { getNetworkConfig } from '@sidhujag/sysweb3-network';
import { webcrypto } from 'crypto';
import { HDNodeWallet } from 'ethers';

import {
  handleListeners,
  resetListenersFlag,
} from '../handlers/handleListeners';
import {
  saveCommittedWalletState,
  savePasskeyCredentialProfileState,
  saveSlip44State,
  saveState,
  walletPersistenceGate,
} from 'state/paliStorage';
import { rehydrateStore } from 'state/rehydrate';
import store, {
  loadAndActivateSlip44Vault,
  persistCommittedWalletState,
  saveMainState,
} from 'state/store';
import { forgetWallet, restoreVaultSnapshot } from 'state/vault';
import vaultCache from 'state/vaultCache';
import { setActiveSlip44 } from 'state/vaultGlobal';
import { AsyncMutex, walletPersistenceMutex } from 'utils/asyncMutex';
import { chromeStorage } from 'utils/storageAPI';

import {
  beginWalletRecovery,
  reconcileWalletRecoveryJournal,
  runWalletSetup,
} from './walletRecovery';

jest.unmock('syscoinjs-lib');
jest.unmock('tiny-secp256k1');
jest.mock('@sidhujag/sysweb3-keyring', () => ({
  ...jest.requireActual('@sidhujag/sysweb3-keyring/cjs/utils/derivation-paths'),
  ...jest.requireActual('@sidhujag/sysweb3-keyring/cjs/signers'),
}));
jest.mock('scripts/Background/controllers/message-handler', () => ({
  onMessage: jest.fn(),
}));
jest.mock('scripts/Background/handlers/handleLogout', () => ({
  handleLogout: jest.fn(),
}));
jest.mock('scripts/Background/handlers/handlePaliUpdates', () => ({
  checkForUpdates: jest.fn(),
}));
jest.mock('scripts/Background/utils/startPolling', () => ({
  startPolling: jest.fn(),
}));

// Public test mnemonic and synthetic ciphertext only. No wallet is unlocked,
// signed with, or connected to a provider by this harness.
const PHRASE =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const JOURNAL = 'pali-wallet-recovery-journal:v1';
const IMPORTED = 'synthetic-encrypted-imported-key-not-a-real-key';
const EMBEDDED_PROFILE = {
  credentialId: 'synthetic-embedded-credential',
  credentialIdHash: 'synthetic-embedded-hash',
  passkeyName: 'Embedded test profile',
  publicKey: { x: 'synthetic-x', y: 'synthetic-y' },
};
const DETACHED_PROFILE = {
  ...EMBEDDED_PROFILE,
  credentialId: 'synthetic-detached-credential',
  passkeyName: 'Detached test profile',
};
const originalChrome = global.chrome;
const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
const clone = (value: any) => structuredClone(value);
const owned = (key: string) =>
  key === 'state' ||
  key.startsWith('state-') ||
  key === 'sysweb3-vault' ||
  key.startsWith('sysweb3-vault-');

let records: Record<string, any>;
let writes: Record<string, any>[];
let readFault: { key: string; missing?: boolean } | undefined;
let failedRemoveKey: string | undefined;
let failedWriteKey: string | undefined;
let failedWriteAfterApply: boolean;
let delayedRead:
  | { entered: () => void; key: string; release?: () => void }
  | undefined;
let connectListener: (port: any) => void;
let disconnectListener: () => void;

const context = {
  getState: store.getState,
  persistenceMutex: walletPersistenceMutex,
  readPresence: async () => true,
  // Use the actual loader without migration writes while recovery owns the
  // persistence mutex; profile migration is completed by the transaction.
  rehydrate: (state: any) =>
    rehydrateStore(store, state, state.vaultGlobal?.activeSlip44, false),
  storage: chromeStorage,
};

function installStorage() {
  const event = () => ({ addListener: jest.fn(), removeListener: jest.fn() });
  global.chrome = {
    runtime: {
      onMessage: event(),
      onConnect: {
        addListener: (listener: any) => {
          connectListener = listener;
        },
      },
      getURL: (path: string) => 'chrome-extension://validation/' + path,
      id: 'validation',
    },
    alarms: { onAlarm: event() },
    storage: {
      local: {
        get: (keys: any, callback: any) => {
          const list =
            keys === null
              ? Object.keys(records)
              : typeof keys === 'string'
              ? [keys]
              : keys;
          const respond = () => {
            if (list.length === 1 && list[0] === readFault?.key) {
              const fault = readFault;
              readFault = undefined;
              if (!fault.missing) {
                (global.chrome.runtime as any).lastError = {
                  message: 'controlled wallet record read failure',
                };
              }
              callback({});
              delete (global.chrome.runtime as any).lastError;
              return;
            }
            callback(
              Object.fromEntries(
                list
                  .filter((key: string) => key in records)
                  .map((key: string) => [key, clone(records[key])])
              )
            );
          };
          if (list.length === 1 && list[0] === delayedRead?.key) {
            delayedRead.release = respond;
            delayedRead.entered();
          } else respond();
        },
        set: (items: any, callback: any) => {
          writes.push(clone(items));
          if (failedWriteKey && failedWriteKey in items) {
            failedWriteKey = undefined;
            if (failedWriteAfterApply) Object.assign(records, clone(items));
            (global.chrome.runtime as any).lastError = {
              message: 'controlled isolated vault migration failure',
            };
            callback();
            delete (global.chrome.runtime as any).lastError;
            return;
          }
          Object.assign(records, clone(items));
          callback();
        },
        remove: (keys: any, callback: any) => {
          const list = typeof keys === 'string' ? [keys] : keys;
          if (list.includes(failedRemoveKey)) {
            failedRemoveKey = undefined;
            (global.chrome.runtime as any).lastError = {
              message: 'controlled journal cleanup failure',
            };
            callback();
            delete (global.chrome.runtime as any).lastError;
            return;
          }
          for (const key of list) delete records[key];
          callback();
        },
      },
    },
  } as any;
}

async function establishOriginal(activeSlip44: number) {
  store.dispatch(forgetWallet());
  store.dispatch(setActiveSlip44(activeSlip44));
  const resetVault = clone(store.getState().vault);
  const originalSyscoin = clone(resetVault);
  originalSyscoin.accounts.Imported[7] = {
    ...clone(resetVault.accounts.HDAccount[0]),
    id: 7,
    isImported: true,
    label: 'Synthetic imported record',
    address: 'synthetic-syscoin-address',
    xpub: 'synthetic-public-key',
    xprv: IMPORTED,
    slip44: 57,
  };
  const activeVault = clone(originalSyscoin);
  if (activeSlip44 === 60) {
    const hd = HDNodeWallet.fromPhrase(PHRASE);
    activeVault.activeNetwork = {
      kind: 'ethereum',
      chainId: 1,
      slip44: 60,
      currency: 'eth',
      label: 'Synthetic ETH',
      url: 'https://example.invalid',
    };
    activeVault.activeChain = 'ethereum';
    activeVault.isBitcoinBased = false;
    // The unrelated Syscoin imported key is absent from the EVM vault.
    activeVault.accounts.Imported = {};
    activeVault.accounts.HDAccount[0] = {
      ...activeVault.accounts.HDAccount[0],
      address: hd.address,
      xpub: hd.signingKey.publicKey,
      slip44: 60,
    };
  } else {
    const { getSyscoinSigners } = jest.requireActual(
      '@sidhujag/sysweb3-keyring/cjs/signers'
    );
    const { hd } = getSyscoinSigners({
      mnemonic: PHRASE,
      rpc: {
        formattedNetwork: activeVault.activeNetwork,
        networkConfig: getNetworkConfig(57, 'sys'),
      },
    });
    hd.createAccountAtIndex(0, 84);
    activeVault.accounts.HDAccount[0] = {
      ...activeVault.accounts.HDAccount[0],
      xpub: hd.getAccountXpub(),
      address: hd.createAddress(0, false, 84),
      slip44: 57,
    };
    Object.assign(originalSyscoin, clone(activeVault));
  }
  originalSyscoin.accounts.HDAccount[0].slip44 = 57;
  store.dispatch(restoreVaultSnapshot(activeVault));
  const current = clone(store.getState());
  records = {
    'sysweb3-vault': 'synthetic-original-encrypted-seed',
    'sysweb3-vault-keys': { salt: 'synthetic-original-salt' },
    state: {
      dapp: current.dapp,
      price: current.price,
      vaultGlobal: { ...current.vaultGlobal, hasEncryptedVault: true },
    },
    'state-vault-57': originalSyscoin,
    ...(activeSlip44 === 60 ? { 'state-vault-60': clone(activeVault) } : {}),
  };
  vaultCache.clearCache();
  return clone(records);
}

async function establishInlineOnlyOriginal() {
  await establishOriginal(57);
  records.state.vault = {
    ...clone(records['state-vault-57']),
    passkeyCredentialProfile: clone(EMBEDDED_PROFILE),
  };
  delete records['state-vault-57'];
  records['state-vault-57-passkey-profile'] = {
    passkeyCredentialProfile: clone(DETACHED_PROFILE),
  };
  return clone(records);
}

async function establishExternalAccounts(activeSlip44: number) {
  await establishOriginal(activeSlip44);
  const original = records['state-vault-57'];
  const publicRecord = {
    ...clone(original.accounts.Imported[7]),
    xprv: '',
    isImported: false,
    slip44: 57,
  };
  original.accounts.Imported[8] = {
    ...publicRecord,
    id: 8,
    label: 'Synthetic watch-only',
    address: 'synthetic-watch-address',
    xpub: 'synthetic-watch-address',
    isImported: true,
  };
  original.accounts.Ledger[2] = {
    ...publicRecord,
    id: 2,
    label: 'Synthetic Ledger',
    address: 'synthetic-ledger-address',
    xpub: 'synthetic-ledger-public-key',
    isLedgerWallet: true,
  };
  original.accounts.Trezor[3] = {
    ...publicRecord,
    id: 3,
    label: 'Synthetic Trezor',
    address: 'synthetic-trezor-address',
    xpub: 'synthetic-trezor-public-key',
    isTrezorWallet: true,
  };
  if (activeSlip44 === 57)
    store.dispatch(restoreVaultSnapshot(clone(original)));
  vaultCache.clearCache();
  return clone(records);
}

function makeHost() {
  let unlocked = false;
  const host: any = {
    walletSessionGeneration: 0,
    walletStateGeneration: 0,
    isCreatingWallet: false,
    recoveryJournalPending: false,
    resetRateLimitState: () => undefined,
    authenticationMutex: new AsyncMutex(),
    isAnyKeyringUnlocked: () => unlocked,
    isUnlocked: () => unlocked,
    isSeedValid: (phrase: string) => phrase === PHRASE,
    lock: () => {
      host.walletSessionGeneration += 1;
      unlocked = false;
    },
    // This stand-in deliberately fails initialization after the real reset
    // reducer, cache clear, persistence mutex, and Chrome adapter execute.
    // MainController's hardware/provider/timer cleanup is outside this test.
    resetWalletState: async () => {
      host.walletSessionGeneration += 1;
      host.walletStateGeneration += 1;
      unlocked = false;
      vaultCache.clearCache();
      await walletPersistenceMutex.runExclusive(async () => {
        for (const key of Object.keys(records).filter(owned)) {
          await chromeStorage.removeItem(key);
        }
        store.dispatch(forgetWallet());
      });
    },
    createWalletExclusive: async () => {
      await host.resetWalletState();
      store.dispatch(setActiveSlip44(57));
      throw new Error('controlled initializer failure');
    },
  };
  return host;
}

async function submit(host: any, ticket: string) {
  host.isCreatingWallet = true;
  try {
    await runWalletSetup(
      host,
      true,
      'StrongPassword12!',
      PHRASE,
      ticket,
      0,
      0,
      context
    );
  } finally {
    host.isCreatingWallet = false;
  }
}

async function popupClose(host: any) {
  resetListenersFlag();
  handleListeners({ wallet: host } as any);
  connectListener({
    name: 'popup-connection',
    onDisconnect: {
      addListener: (listener: any) => {
        disconnectListener = listener;
      },
    },
  });
  const save = jest.spyOn(vaultCache, 'emergencySave');
  try {
    disconnectListener();
    expect(save).toHaveBeenCalledTimes(1);
    await save.mock.results[0].value;
  } finally {
    save.mockRestore();
  }
}

function expectOriginalSnapshot(before: Record<string, any>) {
  expect(
    Object.fromEntries(Object.entries(records).filter(([key]) => owned(key)))
  ).toEqual(before);
  expect(records['state-vault-57'].accounts.Imported[7].xprv).toBe(IMPORTED);
}

async function reloadAndReadImported() {
  // Emulate a fresh background worker's empty Redux/cache state without any
  // persistence. The retained durable journal goes through the real startup
  // reconciler and loader, including a later visit to the Syscoin vault.
  vaultCache.clearCache();
  store.dispatch(forgetWallet());
  walletPersistenceGate.blocked = false;
  const reconciled = await reconcileWalletRecoveryJournal(context);
  await rehydrateStore(store);
  await loadAndActivateSlip44Vault(57);
  expect(store.getState().vault.accounts.Imported[7].xprv).toBe(IMPORTED);
  expect(records[JOURNAL]).toBeUndefined();
  expect(walletPersistenceGate.blocked).toBe(false);
  return reconciled;
}

async function coldStartupHydration() {
  vaultCache.clearCache();
  store.dispatch(forgetWallet());
  walletPersistenceGate.blocked = false;
  const reconciled = await reconcileWalletRecoveryJournal(context);
  const mainState = await chromeStorage.getItem('state');
  // Cold startup removes the legacy inline copy before the actual background
  // loader selects its isolated vault. Do not repair storage via a popup save.
  delete mainState.vault;
  await rehydrateStore(store, mainState, mainState.vaultGlobal.activeSlip44);
  return reconciled;
}

function holdRead(key: string) {
  const entered = new Promise<void>((resolve) => {
    delayedRead = { key, entered: resolve };
  });
  return {
    entered,
    release: () => {
      const release = delayedRead?.release;
      delayedRead = undefined;
      expect(release).toBeDefined();
      release!();
    },
  };
}

describe('wallet recovery persistence boundaries', () => {
  beforeEach(() => {
    records = {};
    writes = [];
    readFault = undefined;
    failedRemoveKey = undefined;
    failedWriteKey = undefined;
    failedWriteAfterApply = false;
    delayedRead = undefined;
    walletPersistenceGate.blocked = false;
    Object.defineProperty(globalThis, 'crypto', {
      value: webcrypto,
      configurable: true,
    });
    installStorage();
    vaultCache.clearCache();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    delayedRead?.release?.();
    delayedRead = undefined;
    await walletPersistenceMutex.runExclusive(() => undefined);
    walletPersistenceGate.blocked = false;
    vaultCache.clearCache();
    resetListenersFlag();
    global.chrome = originalChrome;
    if (originalCrypto) {
      Object.defineProperty(globalThis, 'crypto', originalCrypto);
    }
    jest.restoreAllMocks();
  });

  it.each([
    [57, false],
    [60, false],
    [57, true],
    [60, true],
  ])(
    'retains watch-only and simulated hardware identities across failed recovery, close and reload (active %s, interrupted rollback %s)',
    async (activeSlip44, interruptedRollback) => {
      const before = await establishExternalAccounts(Number(activeSlip44));
      const external = clone(before['state-vault-57'].accounts);
      const host = makeHost();
      const ticket = await beginWalletRecovery(host, context);
      if (interruptedRollback)
        readFault = { key: `state-vault-${activeSlip44}` };
      await expect(submit(host, ticket)).rejects.toThrow(
        interruptedRollback
          ? 'Failed to rehydrate'
          : 'Your previous wallet was restored'
      );
      expectOriginalSnapshot(before);
      await popupClose(host);
      expect(await reloadAndReadImported()).toBe(interruptedRollback);
      const restored = store.getState().vault.accounts;
      for (const [type, id] of [
        ['Imported', 8],
        ['Ledger', 2],
        ['Trezor', 3],
      ] as const) {
        expect(restored[type][id]).toEqual(external[type][id]);
        expect(restored[type][id].xprv).toBe('');
        expect(restored[type][id].slip44).toBe(57);
      }
      // The actual SDK represents a single-address watch-only account by its
      // public identifier plus an empty private key, not a separate flag.
      expect(restored.Imported[8].xpub).toBe(restored.Imported[8].address);
      expect(restored.Ledger[2].isLedgerWallet).toBe(true);
      expect(restored.Trezor[3].isTrezorWallet).toBe(true);
      expect(Object.keys(restored.HDAccount)).toEqual(
        Object.keys(external.HDAccount)
      );
      expectOriginalSnapshot(before);
    }
  );

  it.each([
    [57, 'active vault'],
    [60, 'active vault'],
    [57, 'passkey profile'],
    [60, 'passkey profile'],
  ])(
    'preserves ciphertext after a failed %s %s read, popup close, and reload',
    async (slip44, record) => {
      const before = await establishOriginal(Number(slip44));
      if (record === 'passkey profile') {
        const profileKey = `state-vault-${slip44}-passkey-profile`;
        records[profileKey] = {
          passkeyCredentialProfile: clone(DETACHED_PROFILE),
        };
        before[profileKey] = clone(records[profileKey]);
      }
      const host = makeHost();
      const ticket = await beginWalletRecovery(host, context);
      readFault = {
        key:
          `state-vault-${slip44}` +
          (record === 'passkey profile' ? '-passkey-profile' : ''),
      };
      await expect(submit(host, ticket)).rejects.toThrow(
        'Failed to rehydrate state'
      );
      expectOriginalSnapshot(before);
      expect(records[JOURNAL].before).toEqual(before);
      expect(host.recoveryJournalPending).toBe(true);
      expect(host.isCreatingWallet).toBe(false);
      expect(walletPersistenceGate.blocked).toBe(true);

      const durable = clone(records);
      const writeCount = writes.length;
      await popupClose(host);
      expect(records).toEqual(durable);
      expect(writes).toHaveLength(writeCount);

      expect(await reloadAndReadImported()).toBe(true);
      expectOriginalSnapshot(before);
    }
  );

  it.each([57, 60])(
    'preserves healthy rollback data with active slip44 %s through close and reload',
    async (slip44) => {
      const before = await establishOriginal(slip44);
      const host = makeHost();
      const ticket = await beginWalletRecovery(host, context);
      await expect(submit(host, ticket)).rejects.toThrow(
        'Your previous wallet was restored'
      );
      expectOriginalSnapshot(before);
      expect(records[JOURNAL]).toBeUndefined();
      expect(host.recoveryJournalPending).toBe(false);
      expect(walletPersistenceGate.blocked).toBe(false);
      await popupClose(host);
      expect(await reloadAndReadImported()).toBe(false);
      expect(records['state-vault-57'].accounts.Imported[7].xprv).toBe(
        IMPORTED
      );
    }
  );

  it('restores legacy accounts while the real reducer normalizes origin and balances', async () => {
    await establishOriginal(57);
    for (const account of Object.values(
      records['state-vault-57'].accounts
    ).flatMap((group: any) => Object.values(group)) as any[]) {
      delete account.slip44;
      account.balances.syscoin = 123.45;
    }
    const before = clone(records);
    const host = makeHost();
    const ticket = await beginWalletRecovery(host, context);
    await expect(submit(host, ticket)).rejects.toThrow(
      'Your previous wallet was restored'
    );
    expectOriginalSnapshot(before);
    expect(store.getState().vault.accounts.HDAccount[0].slip44).toBe(57);
    expect(store.getState().vault.accounts.Imported[7].slip44).toBe(57);
    expect(store.getState().vault.accounts.Imported[7].balances.syscoin).toBe(
      -1
    );
    expect(store.getState().vault.accounts.Imported[7].xprv).toBe(IMPORTED);
    expect(records[JOURNAL]).toBeUndefined();
    expect(walletPersistenceGate.blocked).toBe(false);
    await popupClose(host);
    expect(await reloadAndReadImported()).toBe(false);
  });

  it('does not retire the backup when a hydration callback leaves the reset placeholder', async () => {
    const before = await establishOriginal(57);
    const host = makeHost();
    const ticket = await beginWalletRecovery(host, context);
    readFault = { key: 'state-vault-57' };
    await expect(submit(host, ticket)).rejects.toThrow('Failed to rehydrate');
    expect(store.getState().vault.accounts.Imported).toEqual({});
    // Deliberately violate the caller's hydration contract. The transaction
    // must validate the live Redux account records before deleting its backup.
    await expect(
      reconcileWalletRecoveryJournal({
        ...context,
        rehydrate: async () => undefined,
      })
    ).rejects.toThrow('Wallet recovery account restoration is incomplete');
    expectOriginalSnapshot(before);
    expect(records[JOURNAL].before).toEqual(before);
    expect(walletPersistenceGate.blocked).toBe(true);
    const durable = clone(records);
    await popupClose(host);
    expect(records).toEqual(durable);
    expect(await reloadAndReadImported()).toBe(true);
  });

  it('blocks direct and queued writers while a delayed restoration read fails', async () => {
    const before = await establishOriginal(57);
    const host = makeHost();
    const ticket = await beginWalletRecovery(host, context);
    const held = holdRead('state-vault-57');
    readFault = { key: 'state-vault-57' };
    const setupResult = submit(host, ticket).catch((error) => error);
    await held.entered;
    expect(walletPersistenceGate.blocked).toBe(true);
    expectOriginalSnapshot(before);
    const durable = clone(records);
    const writeCount = writes.length;
    const staleVault = clone(store.getState().vault);

    await popupClose(host);
    await expect(saveState({ stale: true })).rejects.toThrow('Wallet recovery');
    await expect(saveSlip44State(57, staleVault)).rejects.toThrow(
      'Wallet recovery'
    );
    await expect(
      saveCommittedWalletState(57, staleVault, { stale: true })
    ).rejects.toThrow('Wallet recovery');
    await expect(
      savePasskeyCredentialProfileState(57, DETACHED_PROFILE)
    ).rejects.toThrow('Wallet recovery');
    await expect(vaultCache.setSlip44Vault(57, staleVault)).rejects.toThrow(
      'Wallet recovery'
    );

    let manualSettled = false;
    const manual = saveMainState().then((result) => {
      manualSettled = true;
      return result;
    });
    const deferred = persistCommittedWalletState(true).catch((error) => error);
    await Promise.resolve();
    expect(manualSettled).toBe(false);
    expect(records).toEqual(durable);
    expect(writes).toHaveLength(writeCount);

    held.release();
    expect(await setupResult).toEqual(
      expect.objectContaining({ message: expect.stringContaining('rehydrate') })
    );
    expect(await manual).toBe(false);
    expect(await deferred).toEqual(
      expect.objectContaining({
        message: expect.stringContaining('Wallet recovery'),
      })
    );
    expect(records).toEqual(durable);
    expect(writes).toHaveLength(writeCount);
    expect(walletPersistenceGate.blocked).toBe(true);
    expect(await reloadAndReadImported()).toBe(true);
  });

  it('lets queued live-state saves proceed only after healthy delayed hydration', async () => {
    const before = await establishOriginal(57);
    const host = makeHost();
    const ticket = await beginWalletRecovery(host, context);
    const held = holdRead('state-vault-57');
    const setupResult = submit(host, ticket).catch((error) => error);
    await held.entered;
    const durable = clone(records);
    const writeCount = writes.length;
    const manual = saveMainState();
    const deferred = persistCommittedWalletState(true);
    await popupClose(host);
    expect(records).toEqual(durable);
    expect(writes).toHaveLength(writeCount);
    expect(walletPersistenceGate.blocked).toBe(true);

    held.release();
    expect(await setupResult).toEqual(
      expect.objectContaining({
        message: expect.stringContaining('Your previous wallet was restored'),
      })
    );
    await manual;
    await deferred;
    expectOriginalSnapshot(before);
    expect(records[JOURNAL]).toBeUndefined();
    expect(walletPersistenceGate.blocked).toBe(false);
    expect(await reloadAndReadImported()).toBe(false);
  });

  it('keeps the journal and write gate closed when rollback cleanup fails', async () => {
    const before = await establishOriginal(57);
    const host = makeHost();
    const ticket = await beginWalletRecovery(host, context);
    failedRemoveKey = JOURNAL;
    await expect(submit(host, ticket)).rejects.toMatchObject({
      message: 'controlled journal cleanup failure',
    });
    expectOriginalSnapshot(before);
    expect(store.getState().vault.accounts.Imported[7].xprv).toBe(IMPORTED);
    expect(records[JOURNAL].before).toEqual(before);
    expect(walletPersistenceGate.blocked).toBe(true);
    expect(host.recoveryJournalPending).toBe(true);
    const durable = clone(records);
    await popupClose(host);
    await expect(persistCommittedWalletState(true)).rejects.toThrow(
      'Wallet recovery'
    );
    expect(records).toEqual(durable);
    expect(await reloadAndReadImported()).toBe(true);
  });

  it.each(['embedded', 'detached'])(
    'preserves the %s passkey profile through rollback and a subsequent popup save',
    async (profileLocation) => {
      await establishOriginal(57);
      records['state-vault-57'].passkeyCredentialProfile =
        clone(EMBEDDED_PROFILE);
      if (profileLocation === 'detached') {
        records['state-vault-57-passkey-profile'] = {
          passkeyCredentialProfile: clone(DETACHED_PROFILE),
        };
      }
      const expectedProfile =
        profileLocation === 'detached' ? DETACHED_PROFILE : EMBEDDED_PROFILE;
      const host = makeHost();
      const ticket = await beginWalletRecovery(host, context);
      await expect(submit(host, ticket)).rejects.toThrow(
        'Your previous wallet was restored'
      );
      expect(store.getState().vault.passkeyCredentialProfile).toEqual(
        expectedProfile
      );
      expect(records['state-vault-57-passkey-profile']).toEqual({
        passkeyCredentialProfile: expectedProfile,
      });
      await popupClose(host);
      expect(
        records['state-vault-57'].passkeyCredentialProfile
      ).toBeUndefined();
      expect(records['state-vault-57-passkey-profile']).toEqual({
        passkeyCredentialProfile: expectedProfile,
      });
      expect(await reloadAndReadImported()).toBe(false);
      expect(store.getState().vault.passkeyCredentialProfile).toEqual(
        expectedProfile
      );
    }
  );

  it('preserves the authoritative isolated vault when main state has a stale inline copy', async () => {
    await establishOriginal(57);
    records.state.vault = clone(records['state-vault-57']);
    records.state.vault.accounts.Imported = {};
    const host = makeHost();
    const ticket = await beginWalletRecovery(host, context);
    await expect(submit(host, ticket)).rejects.toThrow(
      'Your previous wallet was restored'
    );
    expect(records['state-vault-57'].accounts.Imported[7].xprv).toBe(IMPORTED);
    await popupClose(host);
    expect(records['state-vault-57'].accounts.Imported[7]?.xprv).toBe(IMPORTED);
    expect(await reloadAndReadImported()).toBe(false);
  });

  it('uses the detached profile when restoring a legacy inline-only vault', async () => {
    await establishInlineOnlyOriginal();
    const host = makeHost();
    const ticket = await beginWalletRecovery(host, context);
    await expect(submit(host, ticket)).rejects.toThrow(
      'Your previous wallet was restored'
    );
    expect(store.getState().vault.passkeyCredentialProfile).toEqual(
      DETACHED_PROFILE
    );
    expect(records['state-vault-57-passkey-profile']).toEqual({
      passkeyCredentialProfile: DETACHED_PROFILE,
    });
    await popupClose(host);
    expect(records['state-vault-57'].accounts.Imported[7].xprv).toBe(IMPORTED);
    expect(await reloadAndReadImported()).toBe(false);
    expect(store.getState().vault.passkeyCredentialProfile).toEqual(
      DETACHED_PROFILE
    );
  });

  it('durably migrates an inline-only rollback before cold startup drops its inline copy', async () => {
    const before = await establishInlineOnlyOriginal();
    const host = makeHost();
    const ticket = await beginWalletRecovery(host, context);
    await expect(submit(host, ticket)).rejects.toThrow(
      'Your previous wallet was restored'
    );
    expect(records[JOURNAL]).toBeUndefined();
    expect(await coldStartupHydration()).toBe(false);
    expect(store.getState().vault.accounts.Imported[7]?.xprv).toBe(IMPORTED);
    expect(store.getState().vault.passkeyCredentialProfile).toEqual(
      DETACHED_PROFILE
    );
    expect(records['state-vault-57'].accounts.Imported[7].xprv).toBe(IMPORTED);
    expect(records['sysweb3-vault']).toBe(before['sysweb3-vault']);
    expect(records['state-vault-57-passkey-profile']).toEqual({
      passkeyCredentialProfile: DETACHED_PROFILE,
    });
  });

  it.each([false, true])(
    'keeps the backup and gate when inline migration fails (write applied: %s), then retries on restart',
    async (writeApplied) => {
      const before = await establishInlineOnlyOriginal();
      const host = makeHost();
      const ticket = await beginWalletRecovery(host, context);
      failedWriteKey = 'state-vault-57';
      failedWriteAfterApply = writeApplied;
      await expect(submit(host, ticket)).rejects.toMatchObject({
        message: expect.stringContaining(
          'controlled isolated vault migration failure'
        ),
      });
      expect(records[JOURNAL].before).toEqual(before);
      expect(walletPersistenceGate.blocked).toBe(true);
      expect(host.recoveryJournalPending).toBe(true);
      if (writeApplied) {
        expect(records['state-vault-57'].accounts.Imported[7].xprv).toBe(
          IMPORTED
        );
      } else expect(records['state-vault-57']).toBeUndefined();
      const durable = clone(records);
      await popupClose(host);
      expect(records).toEqual(durable);

      expect(await coldStartupHydration()).toBe(true);
      expect(store.getState().vault.accounts.Imported[7]?.xprv).toBe(IMPORTED);
      expect(store.getState().vault.passkeyCredentialProfile).toEqual(
        DETACHED_PROFILE
      );
      expect(records['state-vault-57'].accounts.Imported[7].xprv).toBe(
        IMPORTED
      );
      expect(records['sysweb3-vault']).toBe(before['sysweb3-vault']);
      expect(records[JOURNAL]).toBeUndefined();
      expect(walletPersistenceGate.blocked).toBe(false);
    }
  );

  it('retains the backup when a restored active vault reads as absent', async () => {
    const before = await establishOriginal(57);
    const host = makeHost();
    const ticket = await beginWalletRecovery(host, context);
    readFault = { key: 'state-vault-57', missing: true };
    await expect(submit(host, ticket)).rejects.toThrow(
      'Restored wallet account data is missing'
    );
    expectOriginalSnapshot(before);
    expect(records[JOURNAL].before).toEqual(before);
    expect(walletPersistenceGate.blocked).toBe(true);
    const durable = clone(records);
    await popupClose(host);
    expect(records).toEqual(durable);
    expect(await reloadAndReadImported()).toBe(true);
  });
});
