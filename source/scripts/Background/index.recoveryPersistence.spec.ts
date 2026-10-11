import { webcrypto } from 'crypto';
import { HDNodeWallet } from 'ethers';

import { rehydrate as rehydrateDapps } from 'state/dapp';
import { walletPersistenceGate } from 'state/paliStorage';
import { rehydrateStore } from 'state/rehydrate';
import store, { persistCommittedWalletState } from 'state/store';
import { forgetWallet, restoreVaultSnapshot } from 'state/vault';
import vaultCache from 'state/vaultCache';
import { setActiveSlip44, setHasEncryptedVault } from 'state/vaultGlobal';
import { AsyncMutex, walletPersistenceMutex } from 'utils/asyncMutex';
import { PALI_NETWORKS_STATE } from 'utils/constants';
import { chromeStorage } from 'utils/storageAPI';

import {
  beginWalletRecovery,
  runWalletSetup,
} from './controllers/walletRecovery';

const mockConstructController = jest.fn();

jest.unmock('syscoinjs-lib');
jest.unmock('tiny-secp256k1');
jest.mock('@sidhujag/sysweb3-keyring', () => ({
  ...jest.requireActual('@sidhujag/sysweb3-keyring/cjs/utils/derivation-paths'),
  ...jest.requireActual('@sidhujag/sysweb3-keyring/cjs/signers'),
}));
jest.mock('scripts/Background/controllers', () => ({
  __esModule: true,
  default: (...args: any[]) => mockConstructController(...args),
}));
jest.mock('scripts/Background/handlers/handleListeners', () => ({
  handleListeners: jest.fn(),
}));
jest.mock('scripts/Background/handlers/handleFiatPrice', () => ({
  handleFiatPrice: jest.fn(),
}));
jest.mock('scripts/Background/handlers/handleOffscreenPreload', () => ({
  initializeOffscreenPreload: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('scripts/Background/handlers/handleStartPolling', () => ({
  handleStartPolling: jest.fn(),
}));
jest.mock('scripts/Background/handlers/handleStateChanges', () => ({
  handleObserveStateChanges: jest.fn(),
}));
jest.mock('scripts/Background/controllers/spamFilterCleanup', () => ({
  startSpamFilterCleanup: jest.fn(),
}));
jest.mock('scripts/Background/notification-manager', () => ({
  notificationManager: {},
}));

// Public test mnemonic and opaque synthetic ciphertext. Startup, migration,
// message authorization, Redux hydration and the recovery journal transaction
// are real. Controller construction, KDF/keyring creation and passive services
// are controlled boundaries; no provider, signing or real wallet is involved.
const PHRASE =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const JOURNAL = 'pali-wallet-recovery-journal:v1';
const OLD_IMPORTED = 'synthetic-old-imported-ciphertext';
const OLD_SITE = 'old-permission.example';
const clone = <T>(value: T): T => structuredClone(value);
const owned = (key: string) =>
  key === 'state' ||
  key.startsWith('state-') ||
  key === 'sysweb3-vault' ||
  key.startsWith('sysweb3-vault-');
const flushMicrotasks = async () => {
  for (let i = 0; i < 100; i += 1) await Promise.resolve();
};

describe('trusted startup retries and committed wallet recovery', () => {
  const originalChrome = global.chrome;
  const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  const messageListeners = new Set<any>();
  let records: Record<string, any>;
  let writes: Record<string, any>[];
  let readKeys: string[][];
  let heldMigrationReads: Array<() => void>;
  let holdLegacyReads: boolean;
  let baselineVault: any;
  let controller: any;
  let background: typeof import('./index');

  const context = {
    getState: store.getState,
    persistenceMutex: walletPersistenceMutex,
    readPresence: async () => true,
    rehydrate: (state: any) =>
      rehydrateStore(store, state, state.vaultGlobal?.activeSlip44, false),
    storage: chromeStorage,
  };

  function send(methods: string[], params: any[] = []): Promise<any> {
    return new Promise((resolve, reject) => {
      let accepted = false;
      for (const listener of [...messageListeners]) {
        const pending = listener(
          { type: 'CONTROLLER_ACTION', data: { methods, params } },
          {
            id: 'recovery-regression',
            url: 'chrome-extension://recovery-regression/popup.html',
          },
          resolve
        );
        accepted = accepted || pending === true;
      }
      if (!accepted)
        reject(new Error('Trusted controller message was rejected'));
    });
  }

  function makeController() {
    let unlocked = false;
    const wallet: any = {
      walletSessionGeneration: 0,
      walletStateGeneration: 0,
      isCreatingWallet: false,
      recoveryJournalPending: false,
      authenticationMutex: new AsyncMutex(),
      cleanupMainStateVault: jest.fn().mockResolvedValue(undefined),
      getWalletSetupStatus: () => wallet.isCreatingWallet,
      isAnyKeyringUnlocked: () => unlocked,
      isUnlocked: () => unlocked,
      isSeedValid: (phrase: string) => phrase === PHRASE,
      resetRateLimitState: jest.fn(),
      lock: () => {
        wallet.walletSessionGeneration += 1;
        unlocked = false;
      },
      resetWalletState: async () => {
        wallet.walletSessionGeneration += 1;
        wallet.walletStateGeneration += 1;
        unlocked = false;
        vaultCache.clearCache();
        await walletPersistenceMutex.runExclusive(async () => {
          for (const key of Object.keys(records).filter(owned)) {
            await chromeStorage.removeItem(key);
          }
          store.dispatch(forgetWallet());
          store.dispatch(rehydrateDapps({ dapps: {} }));
        });
      },
      createWalletExclusive: async () => {
        await wallet.resetWalletState();
        const fresh = clone(baselineVault);
        const hd = HDNodeWallet.fromPhrase(PHRASE);
        fresh.activeNetwork = clone(PALI_NETWORKS_STATE.ethereum[8453]);
        fresh.activeChain = 'ethereum';
        fresh.isBitcoinBased = false;
        fresh.accounts.HDAccount[0] = {
          ...fresh.accounts.HDAccount[0],
          address: hd.address,
          xpub: hd.signingKey.publicKey,
          xprv: 'synthetic-recovered-hd-ciphertext',
          slip44: 60,
        };
        store.dispatch(setActiveSlip44(60));
        store.dispatch(setHasEncryptedVault(true));
        store.dispatch(restoreVaultSnapshot(fresh));
        await chromeStorage.setItems({
          'sysweb3-vault': 'synthetic-recovered-seed-ciphertext',
          'sysweb3-vault-keys': { salt: 'synthetic-recovered-salt' },
        });
        await persistCommittedWalletState(true);
        unlocked = true;
      },
      beginWalletRecovery: () => beginWalletRecovery(wallet, context),
      recoverWalletFromSeed: async (
        password: string,
        phrase: string,
        ticket: string
      ) => {
        wallet.isCreatingWallet = true;
        try {
          await runWalletSetup(
            wallet,
            true,
            password,
            phrase,
            ticket,
            0,
            0,
            context
          );
        } finally {
          wallet.isCreatingWallet = false;
        }
      },
    };
    return { wallet };
  }

  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    Object.defineProperty(globalThis, 'crypto', {
      value: webcrypto,
      configurable: true,
    });
    records = {};
    writes = [];
    readKeys = [];
    heldMigrationReads = [];
    holdLegacyReads = false;
    messageListeners.clear();
    walletPersistenceGate.blocked = false;
    vaultCache.clearCache();
    store.dispatch(forgetWallet());
    store.dispatch(setActiveSlip44(60));
    baselineVault = clone(store.getState().vault);
    const hd = HDNodeWallet.fromPhrase(PHRASE);
    const legacy = clone(baselineVault);
    legacy.activeNetwork = {
      kind: 'ethereum',
      slip44: 60,
      chainId: 137,
      default: true,
      label: 'Polygon Mainnet',
      currency: 'matic',
      url: 'https://polygon-rpc.com',
      explorer: 'https://polygonscan.com',
      apiUrl: 'https://polygon.blockscout.com/api',
      coingeckoId: 'matic-network',
      coingeckoPlatformId: 'polygon-pos',
    };
    legacy.activeChain = 'ethereum';
    legacy.isBitcoinBased = false;
    legacy.accounts.HDAccount[0] = {
      ...legacy.accounts.HDAccount[0],
      address: hd.address,
      xpub: hd.signingKey.publicKey,
      slip44: 60,
    };
    legacy.accounts.Imported[7] = {
      ...clone(legacy.accounts.HDAccount[0]),
      id: 7,
      isImported: true,
      xprv: OLD_IMPORTED,
    };
    const current = clone(store.getState());
    records = {
      '4.0.0': 'migrated',
      '4.0.72': 'migrated',
      'sysweb3-vault': 'synthetic-old-seed-ciphertext',
      'sysweb3-vault-keys': { salt: 'synthetic-old-salt' },
      'state-vault-60': legacy,
      state: {
        dapp: { dapps: { [OLD_SITE]: { host: OLD_SITE, accountId: 7 } } },
        price: current.price,
        vaultGlobal: {
          ...current.vaultGlobal,
          activeSlip44: 60,
          hasEncryptedVault: true,
          networks: {
            ...current.vaultGlobal.networks,
            ethereum: {
              ...current.vaultGlobal.networks.ethereum,
              137: clone(legacy.activeNetwork),
            },
          },
        },
      },
    };
    const event = () => ({ addListener: jest.fn(), removeListener: jest.fn() });
    global.chrome = {
      runtime: {
        id: 'recovery-regression',
        getURL: (path: string) =>
          'chrome-extension://recovery-regression/' + path,
        onMessage: {
          addListener: (listener: any) => messageListeners.add(listener),
          removeListener: (listener: any) => messageListeners.delete(listener),
        },
        onSuspend: event(),
        onStartup: event(),
      },
      storage: {
        local: {
          setAccessLevel: jest
            .fn()
            .mockRejectedValueOnce(
              new Error('controlled storage isolation failure')
            )
            .mockRejectedValueOnce(
              new Error('controlled storage isolation failure')
            )
            .mockRejectedValueOnce(
              new Error('controlled storage isolation failure')
            )
            .mockResolvedValue(undefined),
          get: (keys: any, callback: any) => {
            const list: string[] =
              keys === null
                ? Object.keys(records)
                : typeof keys === 'string'
                ? [keys]
                : keys;
            readKeys.push([...list]);
            // Capture at read admission, before a recovery can replace storage.
            const result = Object.fromEntries(
              list
                .filter((key) => key in records)
                .map((key) => [key, clone(records[key])])
            );
            if (
              holdLegacyReads &&
              list.length === 1 &&
              list[0] === 'state-vault-60' &&
              result['state-vault-60']?.activeNetwork.chainId === 137
            ) {
              heldMigrationReads.push(() => callback(result));
            } else callback(result);
          },
          set: (items: any, callback: any) => {
            writes.push(clone(items));
            Object.assign(records, clone(items));
            callback();
          },
          remove: (keys: string[], callback: any) => {
            for (const key of keys) delete records[key];
            callback();
          },
        },
      },
    } as any;
    controller = makeController();
    mockConstructController.mockReset().mockReturnValue(controller);
    // Only the runtime entry point is loaded here. Its initializer and
    // MigrationController remain actual modules in the shared real store graph.
    background = jest.requireActual('./index');
  });

  afterEach(async () => {
    for (const release of heldMigrationReads) release();
    await flushMicrotasks();
    await walletPersistenceMutex.runExclusive(() => undefined);
    walletPersistenceGate.blocked = false;
    vaultCache.clearCache();
    global.chrome = originalChrome;
    if (originalCrypto)
      Object.defineProperty(globalThis, 'crypto', originalCrypto);
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('commits recovery after two degraded retries without a late legacy account or permission writer', async () => {
    await flushMicrotasks();
    await jest.advanceTimersByTimeAsync(2000);
    await jest.advanceTimersByTimeAsync(2000);
    expect(await send(['getInitializationStatus'])).toEqual({
      isReady: false,
      attempts: 3,
      maxAttempts: 3,
    });

    holdLegacyReads = true;
    const firstRetry = send(['retryInitialization']);
    const secondRetry = send(['retryInitialization']);
    await flushMicrotasks();
    expect(heldMigrationReads.length).toBeGreaterThan(0);
    heldMigrationReads.shift()!();
    expect(await firstRetry).toEqual({ retrying: true });
    expect(background.getIsReady()).toBe(true);
    expect(store.getState().vault.accounts.Imported[7].xprv).toBe(OLD_IMPORTED);

    const ticket = await send(['wallet', 'beginWalletRecovery']);
    expect(typeof ticket).toBe('string');
    expect(
      await send(
        ['wallet', 'recoverWalletFromSeed'],
        ['StrongPassword12!', PHRASE, ticket]
      )
    ).toBeUndefined();
    expect(records[JOURNAL]).toBeUndefined();
    expect(records['sysweb3-vault']).toBe(
      'synthetic-recovered-seed-ciphertext'
    );
    const committed = clone(records);

    // The unfixed runtime admits another initializer and leaves this second
    // legacy read pending. Releasing it after the actual commit exposes its
    // stale migration write and subsequent stale global-state rehydration.
    for (const release of heldMigrationReads.splice(0)) release();
    expect(await secondRetry).toEqual({ retrying: true });
    await flushMicrotasks();

    expect({
      durableRecords: records,
      liveImportedAccounts: store.getState().vault.accounts.Imported,
      livePermissions: store.getState().dapp.dapps,
      initializerReads: readKeys.filter(
        (keys) =>
          keys.length === 2 && keys.includes('state') && keys.includes(JOURNAL)
      ).length,
      migrationCompletions: writes.filter(
        (write) => write['4.0.12'] === 'migrated'
      ).length,
      constructedControllers: mockConstructController.mock.calls.length,
    }).toEqual({
      durableRecords: committed,
      liveImportedAccounts: {},
      livePermissions: {},
      initializerReads: 1,
      migrationCompletions: 1,
      constructedControllers: 1,
    });
    expect(background.getController()).toBe(controller);
    expect(walletPersistenceGate.blocked).toBe(false);
  });
});
