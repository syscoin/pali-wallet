/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions":["node","node-addons"]}
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import React from 'react';
import { Provider } from 'react-redux';

import MainController from 'scripts/Background/controllers/MainController';
import { walletPersistenceGate } from 'state/paliStorage';
import store, { persistMainStateStrict } from 'state/store';
import { rehydrate as rehydrateVault } from 'state/vault';
import { setActiveSlip44, setAdvancedSettings } from 'state/vaultGlobal';
import { AsyncMutex } from 'utils/asyncMutex';
import { getWalletNavigationScope } from 'utils/navigationState';
import { chromeStorage } from 'utils/storageAPI';

import Advanced from './Advanced';

const mockEmitter = jest.fn();
const mockNavigate = jest.fn();
const mockLocation = { pathname: '/settings/advanced', key: 'advanced-a' };
jest.mock('scripts/Background', () => ({
  getController: () => ({
    dapp: { handleStateChange: jest.fn().mockResolvedValue(undefined) },
  }),
  notificationManager: { cleanup: jest.fn() },
}));
jest.mock(
  'scripts/Background/controllers/providers/patchFetchWithPaliHeaders',
  () => ({
    patchFetchWithPaliHeaders: jest.fn(),
  })
);
jest.mock('@sidhujag/sysweb3-keyring', () => ({
  KeyringManager: jest.fn(),
  CustomJsonRpcProvider: jest.fn(),
  PsbtUtils: {},
}));
// This transaction-signing helper is unrelated to preference persistence.
jest.mock('utils/syscoinPsbtValues', () => ({}));
jest.mock('utils/slhDsa', () => ({
  ...jest.requireActual('utils/slhDsa'),
  cancelSLHDSAWorkerInOffscreen: jest.fn().mockResolvedValue(undefined),
  clearRuntimeSLHDSAStates: jest.fn(),
  clearSLHDSAPublicPrecomputeCache: jest.fn().mockResolvedValue(undefined),
  clearSLHDSAXmssTreeCache: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => mockLocation,
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({
    controllerEmitter: mockEmitter,
    isUnlocked: true,
    isLoading: false,
    connectionUnavailable: false,
  }),
}));
jest.mock('./SmartAccountInfrastructure', () => ({
  SmartAccountInfrastructure: () => null,
}));
jest.mock('components/index', () => ({
  PageActionFooter: jest.requireActual('components/PageActionFooter')
    .PageActionFooter,
  Button: ({ children, loading, disabled, onClick, type }: any) => (
    <button type={type} onClick={onClick} disabled={disabled || loading}>
      {children}
    </button>
  ),
  DefaultModal: ({ show, title }: any) =>
    show ? <div role="dialog">{title}</div> : null,
  ConfirmationModal: () => null,
}));
jest.mock('antd', () => {
  const Form: any = ({ children, onFinish }: any) => (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void onFinish();
      }}
    >
      {children}
    </form>
  );
  Form.Item = ({ children }: any) => <>{children}</>;
  Form.Item.displayName = 'MockFormItem';
  return { Form };
});

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const clone = (value: any) => JSON.parse(JSON.stringify(value));
const flush = async () => {
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
};

describe('advanced Save ownership across wallet reset', () => {
  let wallet: any;
  let persisted: Record<string, any>;
  let storageWrite: jest.SpyInstance;
  let firstCommitted: ReturnType<typeof deferred>;
  let deliverFirstResponse: ReturnType<typeof deferred>;

  beforeEach(async () => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
    walletPersistenceGate.blocked = false;
    store.dispatch(setActiveSlip44(57));
    store.dispatch(
      rehydrateVault({
        ...store.getState().vault,
        accounts: {
          ...store.getState().vault.accounts,
          HDAccount: {
            0: {
              ...store.getState().vault.accounts.HDAccount[0],
              xpub: 'synthetic-wallet-a',
            },
          },
        },
      })
    );
    store.dispatch(
      setAdvancedSettings({ advancedProperty: 'refresh', value: true })
    );
    store.dispatch(
      setAdvancedSettings({ advancedProperty: 'autolock', value: 5 })
    );
    persisted = {};
    storageWrite = jest
      .spyOn(chromeStorage, 'setItem')
      .mockImplementation(async (key, value) => {
        persisted[key] = clone(value);
      });
    jest.spyOn(chromeStorage, 'setItems').mockImplementation(async (items) => {
      Object.assign(persisted, clone(items));
    });
    jest.spyOn(chromeStorage, 'removeItem').mockImplementation(async (key) => {
      delete persisted[key];
    });
    (chrome.storage.local.get as jest.Mock).mockImplementation((_keys, done) =>
      done(persisted)
    );
    (chrome as any).alarms = { create: jest.fn(), clear: jest.fn() };
    await persistMainStateStrict();
    storageWrite.mockClear();

    wallet = Object.create(MainController.prototype);
    Object.assign(wallet, {
      autoLockAlarmName: 'test-auto-lock',
      isUnlocked: jest.fn().mockReturnValue(true),
      activeRapidPolls: new Map(),
      keyrings: new Map(),
      cancellablePromises: {},
      stopAllRapidPolling: jest.fn(),
      cleanupPersistentProviders: jest.fn(),
      cancelActiveBalanceUpdate: jest.fn(),
      walletSessionGeneration: 0,
      walletStateGeneration: 0,
      networkRequestGeneration: 0,
      fiatQuoteGeneration: 0,
      advancedSettingsMutex: new AsyncMutex(),
    });
    firstCommitted = deferred();
    deliverFirstResponse = deferred();
    let firstReply = true;
    mockEmitter.mockImplementation(async (path: string[], args: any[] = []) => {
      // Execute the real controller request, then delay its first response.
      // This also reproduces the old per-setting UI before the batch fix.
      // No controller result, persistence operation or generation is replaced.
      const result = await wallet[path[1]](...args);
      if (firstReply) {
        firstReply = false;
        firstCommitted.resolve();
        await deliverFirstResponse.promise;
      }
      return result;
    });
  });

  afterEach(() => {
    cleanup();
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
    walletPersistenceGate.blocked = false;
  });

  const submitDraft = () => {
    const view = render(
      <Provider store={store}>
        <Advanced />
      </Provider>
    );
    fireEvent.click(screen.getByLabelText('settings.enableRefresh'));
    fireEvent.change(screen.getByLabelText('settings.enableAutolock'), {
      target: { value: '10' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'buttons.save' }));
    return view;
  };

  const startSave = async () => {
    const view = submitDraft();
    await act(async () => {
      await firstCommitted.promise;
    });
    expect(store.getState().vaultGlobal.advancedSettings.refresh).toBe(false);
    return view;
  };

  it('retains the healthy two-setting save when the wallet is unchanged', async () => {
    await startSave();
    await act(async () => {
      deliverFirstResponse.resolve();
      await flush();
    });
    expect(store.getState().vaultGlobal.advancedSettings).toMatchObject({
      refresh: false,
      autolock: 10,
    });
    expect(persisted.state.vaultGlobal.advancedSettings.autolock).toBe(10);
    expect(screen.getByRole('dialog').textContent).toBe(
      'settings.advancedSettingsWasSet'
    );
  });

  it.each([false, true])(
    'does not send the remaining old draft after reset (view unmounted=%s)',
    async (unmount) => {
      const view = await startSave();
      await act(async () => {
        await wallet.resetWalletState({ resetNetworks: true });
      });
      expect(wallet.walletStateGeneration).toBe(1);
      expect(store.getState().vaultGlobal.advancedSettings.autolock).toBe(0);
      expect(persisted).toEqual({});
      if (unmount) view.unmount();
      await act(async () => {
        deliverFirstResponse.resolve();
        await flush();
      });
      expect({
        remainingCalls: mockEmitter.mock.calls.length - 1,
        liveAutolock: store.getState().vaultGlobal.advancedSettings.autolock,
        storedAutolock: persisted.state?.vaultGlobal.advancedSettings.autolock,
      }).toEqual({
        remainingCalls: 0,
        liveAutolock: 0,
        storedAutolock: undefined,
      });
      if (!unmount) expect(screen.queryByRole('dialog')).toBeNull();
    }
  );

  it('stops the batch before its second setting if reset overtakes the first write', async () => {
    const writing = deferred();
    const releaseWrite = deferred();
    storageWrite.mockImplementationOnce(async (key, value) => {
      writing.resolve();
      await releaseWrite.promise;
      persisted[key] = clone(value);
    });
    const saving = wallet.saveAdvancedSettings(
      { refresh: false, autolock: 10 },
      getWalletNavigationScope()
    );
    const rejected = expect(saving).rejects.toThrow('Wallet state changed');
    await writing.promise;
    const resetting = wallet.resetWalletState({ resetNetworks: true });
    expect(wallet.walletStateGeneration).toBe(1);
    releaseWrite.resolve();
    await rejected;
    await resetting;
    expect(store.getState().vaultGlobal.advancedSettings.autolock).toBe(0);
    expect(persisted).toEqual({});
    expect(chrome.alarms.create).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'checks the original UI scope at delayed controller admission (reset=%s)',
    async (reset) => {
      const received = deferred();
      const deliver = deferred();
      mockEmitter.mockImplementation(async (path: string[], args: any[]) => {
        received.resolve();
        await deliver.promise;
        return wallet[path[1]](...args);
      });
      submitDraft();
      await received.promise;
      if (reset) {
        await act(async () => {
          await wallet.resetWalletState({ resetNetworks: true });
        });
      }
      await act(async () => {
        deliver.resolve();
        await flush();
      });
      expect(store.getState().vaultGlobal.advancedSettings.autolock).toBe(
        reset ? 0 : 10
      );
      if (reset) {
        expect(persisted).toEqual({});
        expect(storageWrite).not.toHaveBeenCalled();
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(screen.queryByRole('alert')).toBeNull();
      } else {
        expect(persisted.state.vaultGlobal.advancedSettings.autolock).toBe(10);
        expect(screen.getByRole('dialog')).not.toBeNull();
      }
    }
  );

  it.each([
    null,
    { refresh: false, autolock: 4 },
    { refresh: false, autolock: 5.5 },
    { refresh: false, autolock: 121 },
    { refresh: false, autolock: NaN },
    { refresh: 'false', autolock: 10 },
  ])(
    'rejects invalid batches before saving any setting: %j',
    async (settings) => {
      await expect(wallet.saveAdvancedSettings(settings)).rejects.toThrow(
        'Invalid advanced settings'
      );
      expect(storageWrite).not.toHaveBeenCalled();
      expect(store.getState().vaultGlobal.advancedSettings).toMatchObject({
        refresh: true,
        autolock: 5,
      });
    }
  );
});
