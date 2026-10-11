import { rehydrateStore } from 'state/rehydrate';
import store, { loadAndActivateSlip44Vault } from 'state/store';
import vaultGlobal, {
  rehydrate,
  setIsSwitchingAccount,
} from 'state/vaultGlobal';

let mockState: any;
const mockGetItem = jest.fn();
const mockGetItems = jest.fn();
const mockReadWalletPresence = jest.fn();
const mockMasterController = jest.fn();
const mockMigrationController = jest.fn();
const mockRecoveryModuleLoaded = jest.fn();
const mockReconcileRecoveryJournal = jest.fn();
const controller = {
  wallet: {
    cleanupMainStateVault: jest.fn().mockResolvedValue(undefined),
    isUnlocked: jest.fn().mockReturnValue(false),
  },
};

jest.mock('scripts/Background/controllers', () => ({
  __esModule: true,
  default: (...args: any[]) => mockMasterController(...args),
}));
jest.mock('scripts/Background/controllers/MigrationController', () => ({
  __esModule: true,
  default: (...args: any[]) => mockMigrationController(...args),
}));
jest.mock('../controllers/walletRecovery', () => {
  mockRecoveryModuleLoaded();
  return {
    reconcileWalletRecoveryJournal: (...args: any[]) =>
      mockReconcileRecoveryJournal(...args),
  };
});
jest.mock('../utils/readWalletPresence', () => ({
  readWalletPresence: () => mockReadWalletPresence(),
}));
jest.mock('utils/storageAPI', () => ({
  chromeStorage: {
    getItem: (...args: any[]) => mockGetItem(...args),
    getItems: (...args: any[]) => mockGetItems(...args),
  },
}));
jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    dispatch: (action: any) => {
      const reducer = jest.requireActual('state/vaultGlobal').default;
      mockState.vaultGlobal = reducer(mockState.vaultGlobal, action);
    },
    getState: () => mockState,
  },
  loadAndActivateSlip44Vault: jest.fn(),
}));
jest.mock('state/vaultCache', () => ({
  __esModule: true,
  default: { emergencySave: jest.fn() },
}));

describe('cold background transient state recovery', () => {
  const originalChrome = global.chrome;
  let initialize: () => Promise<unknown>;
  let persisted: any;
  let journal: any;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const initial = vaultGlobal(undefined, { type: '@@INIT' });
    persisted = {
      vaultGlobal: {
        ...initial,
        activeSlip44: 60,
        advancedSettings: { ...initial.advancedSettings, autolock: 10 },
        isPollingUpdate: true,
        isPostNetworkSwitchLoading: true,
        isSwitchingAccount: true,
        loadingStates: { isLoadingBalances: true },
        networkStatus: 'switching',
        networkTarget: { chainId: 1 },
      },
    };
    mockState = {
      vaultGlobal: initial,
      vault: {
        activeAccount: { id: 499, type: 'HDAccount' },
        accounts: { HDAccount: { 499: { label: 'Account 500' } } },
      },
    };
    mockGetItem.mockReset().mockResolvedValue(persisted);
    journal = undefined;
    mockGetItems.mockReset().mockImplementation(async () => ({
      state: persisted,
      'pali-wallet-recovery-journal:v1': journal,
    }));
    mockMigrationController.mockReset().mockResolvedValue(undefined);
    mockRecoveryModuleLoaded.mockReset();
    mockReconcileRecoveryJournal.mockReset().mockResolvedValue(false);
    mockReadWalletPresence.mockReset().mockResolvedValue(true);
    mockMasterController.mockReset().mockReturnValue(controller);
    (loadAndActivateSlip44Vault as jest.Mock)
      .mockReset()
      .mockResolvedValue(true);
    global.chrome = { runtime: {} } as unknown as typeof chrome;
    jest.isolateModules(() => {
      initialize = jest.requireActual(
        './handleMasterControllerInstance'
      ).handleMasterControllerInstance;
    });
  });

  it('starts an ordinary wallet with one batched storage read without loading recovery crypto', async () => {
    await initialize();
    expect(mockGetItems).toHaveBeenCalledTimes(1);
    expect(mockGetItems).toHaveBeenCalledWith([
      'state',
      'pali-wallet-recovery-journal:v1',
    ]);
    expect(mockGetItem).not.toHaveBeenCalled();
    expect(mockRecoveryModuleLoaded).not.toHaveBeenCalled();
    expect(mockReconcileRecoveryJournal).not.toHaveBeenCalled();
    expect(mockMigrationController).toHaveBeenCalledTimes(1);
    expect(mockReadWalletPresence).toHaveBeenCalledTimes(1);
    expect(loadAndActivateSlip44Vault).toHaveBeenCalledTimes(1);
    expect(mockMasterController).toHaveBeenCalledTimes(1);
  });

  it('awaits interrupted recovery rollback before migrating or loading the restored wallet', async () => {
    journal = { version: 1, before: { state: 'original storage' } };
    const restored = {
      vaultGlobal: { ...persisted.vaultGlobal, activeSlip44: 57 },
    };
    mockGetItem.mockResolvedValueOnce(restored);
    let finishReconcile!: (value: boolean) => void;
    let markReconcileStarted!: () => void;
    const reconcileStarted = new Promise<void>((resolve) => {
      markReconcileStarted = resolve;
    });
    mockReconcileRecoveryJournal.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          finishReconcile = resolve;
          markReconcileStarted();
        })
    );
    const initializing = initialize();
    // Dynamic import and storage reads must finish admission, while migration
    // and all wallet construction remain gated by the unresolved rollback.
    await reconcileStarted;
    expect(finishReconcile).toBeDefined();
    const context = mockReconcileRecoveryJournal.mock.calls[0][0];
    expect(context).toEqual({
      getState: expect.any(Function),
      persistenceMutex: expect.objectContaining({
        runExclusive: expect.any(Function),
      }),
      readPresence: expect.any(Function),
      rehydrate: expect.any(Function),
      storage: expect.objectContaining({
        getItem: expect.any(Function),
        getItems: expect.any(Function),
      }),
    });
    expect(context.getState()).toBe(mockState);
    expect(mockMigrationController).not.toHaveBeenCalled();
    expect(loadAndActivateSlip44Vault).not.toHaveBeenCalled();
    expect(mockReadWalletPresence).not.toHaveBeenCalled();
    expect(mockMasterController).not.toHaveBeenCalled();
    expect(mockGetItem).not.toHaveBeenCalled();
    finishReconcile(true);
    await initializing;
    expect(mockGetItem).toHaveBeenCalledTimes(1);
    expect(mockGetItem).toHaveBeenCalledWith('state');
    expect(mockMigrationController).toHaveBeenCalledWith(restored);
    expect(loadAndActivateSlip44Vault).toHaveBeenCalledWith(57);
    expect(mockState.vaultGlobal.activeSlip44).toBe(57);
    expect(mockMasterController).toHaveBeenCalledTimes(1);
  });

  it('uses the current state after committed recovery cleanup without rereading or rolling back it', async () => {
    journal = { version: 1, committedFingerprint: 'committed recovery' };
    mockReconcileRecoveryJournal.mockResolvedValueOnce(false);
    mockMigrationController.mockImplementationOnce(async (state) => {
      expect(mockReconcileRecoveryJournal).toHaveBeenCalledTimes(1);
      expect(state).toBe(persisted);
    });
    await initialize();
    expect(mockGetItem).not.toHaveBeenCalled();
    expect(mockReconcileRecoveryJournal).toHaveBeenCalledTimes(1);
    expect(loadAndActivateSlip44Vault).toHaveBeenCalledWith(60);
    expect(mockMasterController).toHaveBeenCalledTimes(1);
  });

  it.each(['batched read', 'journal validation', 'restored state read'])(
    'fails closed on %s failure before migration, vault loading, or controller cleanup',
    async (failure) => {
      const before = mockState.vaultGlobal;
      const error = new Error(`Synthetic ${failure} failure`);
      if (failure === 'batched read') mockGetItems.mockRejectedValueOnce(error);
      else {
        journal = { version: 1 };
        if (failure === 'journal validation')
          mockReconcileRecoveryJournal.mockRejectedValueOnce(error);
        else {
          mockReconcileRecoveryJournal.mockResolvedValueOnce(true);
          mockGetItem.mockRejectedValueOnce(error);
        }
      }
      await expect(initialize()).rejects.toThrow(error.message);
      expect(mockMigrationController).not.toHaveBeenCalled();
      expect(loadAndActivateSlip44Vault).not.toHaveBeenCalled();
      expect(mockReadWalletPresence).not.toHaveBeenCalled();
      expect(mockMasterController).not.toHaveBeenCalled();
      expect(controller.wallet.cleanupMainStateVault).not.toHaveBeenCalled();
      expect(mockState.vaultGlobal).toBe(before);
    }
  );

  afterEach(() => {
    global.chrome = originalChrome;
    jest.restoreAllMocks();
  });

  it('clears persisted in-flight flags only after the vault loads, before publishing the controller', async () => {
    (loadAndActivateSlip44Vault as jest.Mock).mockImplementation(async () => {
      expect(mockState.vaultGlobal.isSwitchingAccount).toBe(true);
      expect(mockMasterController).not.toHaveBeenCalled();
      return true;
    });
    mockMasterController.mockImplementation(() => {
      expect(mockState.vaultGlobal).toMatchObject({
        activeSlip44: 60,
        advancedSettings: { autolock: 10 },
        hasEncryptedVault: true,
        isPollingUpdate: false,
        isPostNetworkSwitchLoading: false,
        isSwitchingAccount: false,
        loadingStates: { isLoadingBalances: false },
        networkStatus: 'idle',
      });
      expect(mockState.vaultGlobal.networkTarget).toBeUndefined();
      return controller;
    });

    await initialize();

    expect(mockState.vault.activeAccount.id).toBe(499);
    expect(mockState.vault.accounts.HDAccount[499].label).toBe('Account 500');
    expect(persisted.vaultGlobal.isSwitchingAccount).toBe(true);
  });

  it('does not consume cold recovery or expose a controller when vault loading fails', async () => {
    (loadAndActivateSlip44Vault as jest.Mock).mockRejectedValueOnce(
      new Error('Storage unavailable')
    );
    await expect(initialize()).rejects.toThrow('Storage unavailable');
    expect(mockMasterController).not.toHaveBeenCalled();
    expect(mockState.vaultGlobal.isSwitchingAccount).toBe(true);

    await initialize();
    expect(mockState.vaultGlobal.isSwitchingAccount).toBe(false);
  });

  it('does not clear a live switch guard during same-worker reinitialization', async () => {
    await initialize();
    store.dispatch(setIsSwitchingAccount(true));
    await initialize();
    expect(mockState.vaultGlobal.isSwitchingAccount).toBe(true);
  });

  it('does not reconcile or load a live recovery journal during same-worker retry', async () => {
    await initialize();
    const before = mockState.vaultGlobal;
    journal = { version: 1, before: { state: 'live recovery snapshot' } };
    const cleanupCalls =
      controller.wallet.cleanupMainStateVault.mock.calls.length;

    await expect(initialize()).rejects.toThrow('Wallet recovery is pending');

    expect(mockGetItems).toHaveBeenCalledTimes(2);
    expect(mockRecoveryModuleLoaded).not.toHaveBeenCalled();
    expect(mockReconcileRecoveryJournal).not.toHaveBeenCalled();
    expect(mockGetItem).not.toHaveBeenCalled();
    expect(mockMigrationController).toHaveBeenCalledTimes(1);
    expect(loadAndActivateSlip44Vault).toHaveBeenCalledTimes(1);
    expect(mockReadWalletPresence).toHaveBeenCalledTimes(1);
    expect(mockMasterController).toHaveBeenCalledTimes(1);
    expect(controller.wallet.cleanupMainStateVault).toHaveBeenCalledTimes(
      cleanupCalls
    );
    expect(mockState.vaultGlobal).toBe(before);
  });

  it('allows cold recovery again when controller construction failed', async () => {
    mockMasterController.mockImplementationOnce(() => {
      throw new Error('Controller initialization failed');
    });
    await expect(initialize()).rejects.toThrow(
      'Controller initialization failed'
    );
    await initialize();
    expect(mockState.vaultGlobal.isSwitchingAccount).toBe(false);
    expect(mockMasterController).toHaveBeenCalledTimes(2);
  });

  it('retains a live background switch when the frontend rehydrates its snapshot', async () => {
    await rehydrateStore(store, { ...persisted, vault: mockState.vault });
    expect(mockState.vaultGlobal.isSwitchingAccount).toBe(true);
    expect(mockState.vaultGlobal.networkStatus).toBe('switching');
    expect(mockState.vaultGlobal.loadingStates.isLoadingBalances).toBe(true);
    expect(
      vaultGlobal(undefined, rehydrate(persisted.vaultGlobal))
    ).toMatchObject({
      isSwitchingAccount: true,
      networkStatus: 'switching',
    });
  });
});
