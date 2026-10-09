import { rehydrateStore } from 'state/rehydrate';
import store, { loadAndActivateSlip44Vault } from 'state/store';
import vaultGlobal, {
  rehydrate,
  setIsSwitchingAccount,
} from 'state/vaultGlobal';

let mockState: any;
const mockGetItem = jest.fn();
const mockReadWalletPresence = jest.fn();
const mockMasterController = jest.fn();
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
  default: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../utils/readWalletPresence', () => ({
  readWalletPresence: () => mockReadWalletPresence(),
}));
jest.mock('utils/storageAPI', () => ({
  chromeStorage: { getItem: (...args: any[]) => mockGetItem(...args) },
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

  beforeEach(() => {
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
