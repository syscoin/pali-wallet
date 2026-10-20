/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions":["node","node-addons"]}
 */
import '@testing-library/jest-dom';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import React from 'react';
import { Provider } from 'react-redux';

import MainController from 'scripts/Background/controllers/MainController';
import { loadState, walletPersistenceGate } from 'state/paliStorage';
import store, { persistCommittedWalletState } from 'state/store';
import { restoreVaultSnapshot, setActiveAccount } from 'state/vault';
import vaultCache from 'state/vaultCache';
import { setActiveSlip44, setNetworks } from 'state/vaultGlobal';
import { INetwork, INetworkType, KeyringAccountType } from 'types/network';
import { networkRegistrationFingerprint } from 'utils/networkRegistration';

import CustomRPC from './CustomRPC';
import { clearCustomRpcDrafts } from './customRpcDraft';

jest.mock('scripts/Background', () => ({
  getController: jest.fn(),
  notificationManager: { cleanup: jest.fn() },
}));
jest.mock(
  'scripts/Background/controllers/providers/patchFetchWithPaliHeaders',
  () => ({
    patchFetchWithPaliHeaders: jest.fn(),
  })
);
jest.mock('utils/syscoinPsbtValues', () => ({}));
jest.mock('@sidhujag/sysweb3-keyring', () => ({
  KeyringManager: jest.fn(),
  CustomJsonRpcProvider: jest.fn(),
  PsbtUtils: {},
}));
jest.mock('react-router-dom', () => ({ useLocation: () => mockLocation }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({ navigate: mockNavigate, alert: mockAlert }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('hooks/controllerStatus', () => ({
  getControllerStatus: () => ({ isUnlocked: true }),
  subscribeControllerStatus: () => () => undefined,
}));
jest.mock('components/ChainIcon', () => ({ ChainIcon: () => null }));
jest.mock('components/Icon', () => ({ Icon: () => null }));
jest.mock('components/Modal/StatusModal', () => ({
  StatusModal: ({ show, description }: any) =>
    show ? <div role="alert">{description}</div> : null,
}));
jest.mock('components/ToastActionFooter', () => ({
  ToastActionFooter: ({ children }: any) => <div>{children}</div>,
}));
jest.mock('components/index', () => ({
  Button: ({ children, disabled, type, onClick }: any) => (
    <button disabled={disabled} type={type} onClick={onClick}>
      {children}
    </button>
  ),
  Tooltip: ({ children }: any) => children,
}));

const originalChrome = global.chrome;
const originalMessageChannel = globalThis.MessageChannel;
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const mockNavigate = jest.fn();
const mockAlert = { error: jest.fn(), success: jest.fn() };
const mockEmitter = jest.fn();
const source: INetwork = {
  chainId: 1,
  kind: INetworkType.Ethereum,
  slip44: 60,
  label: 'Active synthetic chain',
  currency: 'eth',
  url: 'https://active.synthetic.invalid',
};
const target: INetwork = {
  ...source,
  chainId: 31337,
  label: 'Original inactive chain',
  url: 'https://original.synthetic.invalid',
  default: false,
};
const proposal = { ...target, url: 'https://old-editor.synthetic.invalid' };
const replacement = {
  ...target,
  label: 'Newly approved replacement',
  url: 'https://replacement.synthetic.invalid',
};
const mockLocation = {
  pathname: '/settings/networks/custom-rpc',
  search: '',
  hash: '',
  key: 'network-editor',
  state: {
    isEditing: true,
    isDefault: false,
    chain: INetworkType.Ethereum,
    selected: { chainId: target.chainId, kind: target.kind },
    customRpcDraftId: '00000000-0000-4000-8000-000000000001',
  },
};
let wallet: any;
let records: Record<string, any>;
const liveTarget = () => store.getState().vaultGlobal.networks.ethereum[31337];
const deferred = () => {
  let resolve!: (value: INetwork) => void;
  const promise = new Promise<INetwork>((done) => (resolve = done));
  return { promise, resolve };
};

beforeEach(async () => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation();
  jest.spyOn(console, 'warn').mockImplementation();
  clearCustomRpcDrafts();
  vaultCache.clearCache();
  walletPersistenceGate.blocked = false;
  window.history.replaceState({ key: mockLocation.key }, '', '/app.html');
  globalThis.MessageChannel = class {
    port1 = { onmessage: null as (() => void) | null };
    port2 = {
      postMessage: () => queueMicrotask(() => this.port1.onmessage?.()),
    };
  } as unknown as typeof MessageChannel;
  window.matchMedia = jest.fn().mockImplementation(() => ({
    matches: false,
    addListener: jest.fn(),
    removeListener: jest.fn(),
  }));
  records = {};
  global.chrome = {
    runtime: { id: 'synthetic-network-replacement' },
    storage: {
      local: {
        get: (keys: string[], callback: (value: any) => void) =>
          callback(
            Object.fromEntries(
              keys
                .filter((key) => key in records)
                .map((key) => [key, clone(records[key])])
            )
          ),
        set: (items: Record<string, any>, callback: () => void) => {
          Object.assign(records, clone(items));
          callback();
        },
        remove: (keys: string[], callback: () => void) => {
          keys.forEach((key) => delete records[key]);
          callback();
        },
      },
    },
  } as any;
  store.dispatch(
    restoreVaultSnapshot({
      ...store.getState().vault,
      activeNetwork: source,
      isBitcoinBased: false,
    })
  );
  store.dispatch(setActiveSlip44(60));
  store.dispatch(
    setNetworks({ ethereum: { 1: source, 31337: target }, syscoin: {} })
  );
  wallet = Object.create(MainController.prototype);
  wallet.walletStateGeneration = 0;
  wallet.walletSessionGeneration = 0;
  wallet.isRemovingNetwork = false;
  wallet.keyrings = new Map();
  wallet.resetAutoLockTimer = jest.fn();
  wallet.evmAssetsController = {
    detectCoinGeckoIds: jest.fn().mockResolvedValue(null),
  };
  mockEmitter.mockImplementation(async ([, method], args) => {
    if (method === 'getChainData') return [];
    if (method === 'getRpc')
      return {
        ...target,
        label: args[0].label,
        url: args[0].url,
        currency: args[0].symbol.toLowerCase(),
        explorer: args[0].explorer,
        apiUrl: args[0].apiUrl,
      };
    if (method === 'editCustomRpc') return wallet.editCustomRpc(...args);
    return undefined;
  });
  await persistCommittedWalletState(true);
});

afterEach(() => {
  global.chrome = originalChrome;
  globalThis.MessageChannel = originalMessageChannel;
  vaultCache.clearCache();
  jest.restoreAllMocks();
});

async function submitEdit() {
  const view = render(
    <Provider store={store}>
      <CustomRPC />
    </Provider>
  );
  const input = screen.getByPlaceholderText('settings.rpcUrlPlaceholder');
  expect(input).toHaveValue(target.url);
  fireEvent.change(input, { target: { value: proposal.url } });
  fireEvent.submit(view.container.querySelector('form')!);
  await waitFor(() =>
    expect(
      mockEmitter.mock.calls.some(([[, method]]) => method === 'getRpc')
    ).toBe(true)
  );
  return view;
}

it('saves a healthy current EVM edit through the real durable registry path', async () => {
  await submitEdit();
  await waitFor(() => expect(mockAlert.success).toHaveBeenCalledTimes(1));
  expect(liveTarget()).toMatchObject(proposal);
  expect((await loadState()).vaultGlobal.networks.ethereum[31337]).toEqual(
    liveTarget()
  );
});

it.each(['edit', 'remove and re-add'])(
  'rejects a stale EVM edit when another window performs a same-chain %s during endpoint validation',
  async (change) => {
    const validation = deferred();
    const normal = mockEmitter.getMockImplementation()!;
    mockEmitter.mockImplementation(async (path, args) =>
      path[1] === 'getRpc' ? validation.promise : normal(path, args)
    );
    await submitEdit();
    await act(async () => {
      if (change === 'edit')
        await wallet.editCustomRpc(
          replacement,
          networkRegistrationFingerprint(liveTarget())
        );
      else {
        await wallet.removeKeyringNetwork(
          target.kind,
          target.chainId,
          target.url,
          target.label,
          networkRegistrationFingerprint(liveTarget())!
        );
        await wallet.addCustomRpc(replacement);
      }
    });
    expect(liveTarget()).toMatchObject(replacement);
    expect((await loadState()).vaultGlobal.networks.ethereum[31337]).toEqual(
      liveTarget()
    );
    await act(async () => validation.resolve(proposal));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'buttons.save' })).toBeEnabled()
    );
    expect({
      live: liveTarget(),
      saved: (await loadState()).vaultGlobal.networks.ethereum[31337],
    }).toEqual({
      live: replacement,
      saved: replacement,
    });
    expect(mockAlert.success).not.toHaveBeenCalled();
  }
);

it('refreshes a replaced registration before submitting and permits a fresh save', async () => {
  const view = render(
    <Provider store={store}>
      <CustomRPC />
    </Provider>
  );
  const input = screen.getByPlaceholderText('settings.rpcUrlPlaceholder');
  expect(input).toHaveValue(target.url);
  await act(async () =>
    wallet.editCustomRpc(
      replacement,
      networkRegistrationFingerprint(liveTarget())
    )
  );
  // The existing form still represents the original registration.
  expect(input).toHaveValue(target.url);
  fireEvent.submit(view.container.querySelector('form')!);
  await screen.findByRole('alert');
  expect(input).toHaveValue(replacement.url);
  expect(
    mockEmitter.mock.calls.filter(([[, method]]) => method === 'getRpc')
  ).toHaveLength(0);
  expect(liveTarget()).toEqual(replacement);

  fireEvent.change(input, {
    target: { value: 'https://fresh-editor.synthetic.invalid' },
  });
  fireEvent.submit(view.container.querySelector('form')!);
  await waitFor(() => expect(mockAlert.success).toHaveBeenCalledTimes(1));
  expect(liveTarget()).toMatchObject({
    label: replacement.label,
    url: 'https://fresh-editor.synthetic.invalid',
  });
  expect((await loadState()).vaultGlobal.networks.ethereum[31337]).toEqual(
    liveTarget()
  );
});

it('does not restore an old registration draft when the same chain is reopened after replacement', async () => {
  const first = render(
    <Provider store={store}>
      <CustomRPC />
    </Provider>
  );
  fireEvent.change(screen.getByPlaceholderText('settings.rpcUrlPlaceholder'), {
    target: { value: proposal.url },
  });
  first.unmount();
  await wallet.editCustomRpc(
    replacement,
    networkRegistrationFingerprint(liveTarget())
  );
  await act(async () => {
    render(
      <Provider store={store}>
        <CustomRPC />
      </Provider>
    );
  });
  expect(screen.getByPlaceholderText('settings.rpcUrlPlaceholder')).toHaveValue(
    replacement.url
  );
});

it('keeps drafts bound to the refreshed predecessor after a conflict', async () => {
  const first = render(
    <Provider store={store}>
      <CustomRPC />
    </Provider>
  );
  await act(async () =>
    wallet.editCustomRpc(
      replacement,
      networkRegistrationFingerprint(liveTarget())
    )
  );
  fireEvent.submit(first.container.querySelector('form')!);
  await screen.findByRole('alert');
  const input = screen.getByPlaceholderText('settings.rpcUrlPlaceholder');
  expect(input).toHaveValue(replacement.url);
  fireEvent.change(input, {
    target: { value: 'https://replacement-draft.synthetic.invalid' },
  });
  first.unmount();
  let reopened!: ReturnType<typeof render>;
  await act(async () => {
    reopened = render(
      <Provider store={store}>
        <CustomRPC />
      </Provider>
    );
  });
  expect(screen.getByPlaceholderText('settings.rpcUrlPlaceholder')).toHaveValue(
    'https://replacement-draft.synthetic.invalid'
  );
  reopened.unmount();
  await wallet.editCustomRpc(
    target,
    networkRegistrationFingerprint(liveTarget())
  );
  await act(async () => {
    render(
      <Provider store={store}>
        <CustomRPC />
      </Provider>
    );
  });
  expect(screen.getByPlaceholderText('settings.rpcUrlPlaceholder')).toHaveValue(
    target.url
  );
});

it('does not reapply a restored old-registration draft after an account round trip', async () => {
  store.dispatch(
    setActiveAccount({ id: 0, type: KeyringAccountType.HDAccount })
  );
  const first = render(
    <Provider store={store}>
      <CustomRPC />
    </Provider>
  );
  fireEvent.change(screen.getByPlaceholderText('settings.rpcUrlPlaceholder'), {
    target: { value: proposal.url },
  });
  first.unmount();
  let restored!: ReturnType<typeof render>;
  await act(async () => {
    restored = render(
      <Provider store={store}>
        <CustomRPC />
      </Provider>
    );
  });
  expect(screen.getByPlaceholderText('settings.rpcUrlPlaceholder')).toHaveValue(
    proposal.url
  );
  await act(async () => {
    store.dispatch(
      setActiveAccount({ id: 1, type: KeyringAccountType.HDAccount })
    );
  });
  await act(async () =>
    wallet.editCustomRpc(
      replacement,
      networkRegistrationFingerprint(liveTarget())
    )
  );
  await act(async () => {
    store.dispatch(
      setActiveAccount({ id: 0, type: KeyringAccountType.HDAccount })
    );
  });
  // This is the same mounted editor; returning to account A cannot resurrect R1.
  const restoredUrl = (
    screen.getByPlaceholderText(
      'settings.rpcUrlPlaceholder'
    ) as HTMLInputElement
  ).value;
  fireEvent.submit(restored.container.querySelector('form')!);
  await waitFor(() => expect(mockAlert.success).toHaveBeenCalledTimes(1));
  expect({
    restoredUrl,
    live: liveTarget(),
    saved: (await loadState()).vaultGlobal.networks.ethereum[31337],
  }).toMatchObject({
    restoredUrl: replacement.url,
    live: replacement,
    saved: replacement,
  });
});

it('rejects an edit delivered to the background after the UI check and refreshes for retry', async () => {
  let deliver!: () => void;
  const delivery = new Promise<void>((resolve) => (deliver = resolve));
  const normal = mockEmitter.getMockImplementation()!;
  mockEmitter.mockImplementation(async (path, args) => {
    if (path[1] === 'editCustomRpc') await delivery;
    return normal(path, args);
  });
  await submitEdit();
  await waitFor(() =>
    expect(
      mockEmitter.mock.calls.some(([[, method]]) => method === 'editCustomRpc')
    ).toBe(true)
  );
  await act(async () =>
    wallet.editCustomRpc(
      replacement,
      networkRegistrationFingerprint(liveTarget())
    )
  );
  await act(async () => deliver());
  await screen.findByRole('alert');
  expect(liveTarget()).toEqual(replacement);
  expect((await loadState()).vaultGlobal.networks.ethereum[31337]).toEqual(
    replacement
  );
  expect(screen.getByPlaceholderText('settings.rpcUrlPlaceholder')).toHaveValue(
    replacement.url
  );
  expect(mockAlert.success).not.toHaveBeenCalled();
});

describe.each([INetworkType.Ethereum, INetworkType.Syscoin])(
  '%s background edit intent',
  (family) => {
    const prepare = async () => {
      const registration = {
        ...target,
        kind: family,
        slip44: family === INetworkType.Ethereum ? 60 : 111,
      };
      store.dispatch(
        setNetworks({
          ethereum: {
            1: source,
            ...(family === INetworkType.Ethereum
              ? { 31337: registration }
              : {}),
          },
          syscoin:
            family === INetworkType.Syscoin ? { 31337: registration } : {},
        })
      );
      await persistCommittedWalletState(true);
      return registration;
    };

    it('accepts a healthy explicit predecessor and rejects missing edit intent', async () => {
      const registration = await prepare();
      const expected = networkRegistrationFingerprint(registration);
      const changed = { ...registration, url: proposal.url };
      await expect(wallet.editCustomRpc(changed, undefined)).rejects.toThrow(
        'Network changed'
      );
      expect((await loadState()).vaultGlobal.networks[family][31337]).toEqual(
        registration
      );
      await expect(wallet.editCustomRpc(changed, expected)).resolves.toEqual(
        changed
      );
      expect(store.getState().vaultGlobal.networks[family][31337]).toEqual(
        changed
      );
      expect((await loadState()).vaultGlobal.networks[family][31337]).toEqual(
        changed
      );
    });

    it('rejects stale intent delivered after another accepted edit', async () => {
      const registration = await prepare();
      const expected = networkRegistrationFingerprint(registration);
      let deliver!: () => void;
      const delivery = new Promise<void>((resolve) => (deliver = resolve));
      const oldRequest = delivery.then(() =>
        wallet.editCustomRpc({ ...registration, url: proposal.url }, expected)
      );
      const rejected = expect(oldRequest).rejects.toThrow('Network changed');
      const newer = {
        ...registration,
        label: replacement.label,
        url: replacement.url,
      };
      await wallet.editCustomRpc(newer, expected);
      deliver();
      await rejected;
      expect(store.getState().vaultGlobal.networks[family][31337]).toEqual(
        newer
      );
      expect((await loadState()).vaultGlobal.networks[family][31337]).toEqual(
        newer
      );
    });
  }
);
