/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { combineReducers, configureStore } from '@reduxjs/toolkit';
import { act, cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { Provider } from 'react-redux';

import DAppController from 'scripts/Background/controllers/DAppController';
import MainController from 'scripts/Background/controllers/MainController';
import { onMessage } from 'scripts/Background/controllers/message-handler';
import { popupPromise } from 'scripts/Background/controllers/message-handler/popup-promise';
import { MethodRoute } from 'scripts/Background/controllers/message-handler/types';
import dappReducer from 'state/dapp';
import spamFilterReducer from 'state/spamFilter';
import vaultReducer, { setActiveAccount } from 'state/vault';
import vaultGlobalReducer from 'state/vaultGlobal';
import { INetworkType, KeyringAccountType } from 'types/network';

import { SmartAccountModuleConsent } from './SmartAccountModuleConsent';

let mockStore: any;
let mockController: any;
let mockQuery: any;
const mockRenderErrors: string[] = [];
const mockEmitter = jest.fn();
const mockT = (key: string) => key;

jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    getState: () => mockStore.getState(),
    dispatch: (action: any) => mockStore.dispatch(action),
  },
}));
jest.mock('scripts/Background', () => ({
  getController: () => mockController,
  notificationManager: { notifyAccountChange: jest.fn() },
}));
jest.mock('@sidhujag/sysweb3-keyring', () => ({
  KeyringManager: jest.fn(),
  CustomJsonRpcProvider: jest.fn(),
  PsbtUtils: {},
}));
// No UTXO transaction parsing is involved in this EVM approval path.
jest.mock('syscointx-js', () => ({ bufferUtils: {} }));
jest.mock('scripts/Provider/EthProvider', () => ({ EthProvider: jest.fn() }));
jest.mock('scripts/Provider/SysProvider', () => ({ SysProvider: jest.fn() }));
jest.mock(
  'scripts/Background/controllers/message-handler/popup-promise',
  () => ({
    popupPromise: jest.fn(),
  })
);
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockT }),
}));
jest.mock('hooks/index', () => ({ useQueryData: () => mockQuery }));
jest.mock('hooks/useController', () => ({
  useController: () => ({
    controllerEmitter: mockEmitter,
    handleWalletLockedError: () => false,
  }),
}));
jest.mock('components/index', () => ({
  AddressText: ({ value }: any) => <span>{value}</span>,
  Card: ({ children }: any) => <div>{children}</div>,
  Icon: () => null,
  Button: ({ children, onClick, disabled, loading }: any) => (
    <button onClick={onClick} disabled={disabled || loading}>
      {children}
    </button>
  ),
}));
jest.mock('components/ToastActionFooter', () => ({
  ToastActionFooter: ({ children }: any) => <footer>{children}</footer>,
}));

const HOST = 'https://modules.synthetic.invalid';
const address = (digit: string) => `0x${digit.repeat(40)}`;
const MODULE = address('3');
const metadata = {
  address: address('1'),
  chainId: 57057,
  isDeployed: true,
  auth: { validator: address('2'), module: 'ecdsa' },
  installedModules: [
    { address: address('2'), type: 'validator', id: 'ecdsa', data: '0x' },
    { address: MODULE, type: 'validator', id: 'custom', data: '0x' },
  ],
};

class RenderBoundary extends React.Component<
  React.PropsWithChildren,
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    mockRenderErrors.push(error.message);
  }
  render() {
    return this.state.failed ? (
      <p>Approval render failed</p>
    ) : (
      this.props.children
    );
  }
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRenderErrors.length = 0;
  jest.spyOn(console, 'log').mockImplementation();
  jest.spyOn(console, 'error').mockImplementation();
  Object.assign(chrome, {
    tabs: {
      onRemoved: { addListener: jest.fn(), removeListener: jest.fn() },
      onUpdated: { addListener: jest.fn(), removeListener: jest.fn() },
    },
  });
  const vault = vaultReducer(undefined, { type: 'test/init' });
  const global = vaultGlobalReducer(undefined, { type: 'test/init' });
  const type = KeyringAccountType.SmartAccount;
  mockStore = configureStore({
    reducer: combineReducers({
      vault: vaultReducer,
      vaultGlobal: vaultGlobalReducer,
      dapp: dappReducer,
      spamFilter: spamFilterReducer,
    }),
    preloadedState: {
      vault: {
        ...vault,
        isBitcoinBased: false,
        activeAccount: { id: 0, type },
        activeNetwork: {
          ...vault.activeNetwork,
          kind: INetworkType.Ethereum,
          chainId: 57057,
          slip44: 60,
          url: 'https://rpc.synthetic.invalid',
        },
        accounts: {
          ...vault.accounts,
          [type]: {
            0: {
              id: 0,
              address: address('1'),
              isSmartAccount: true,
              smartAccount: metadata,
            },
            1: {
              id: 1,
              address: address('4'),
              isSmartAccount: true,
              smartAccount: { ...metadata, address: address('4') },
            },
          },
        },
      },
      vaultGlobal: { ...global, activeSlip44: 60, networkStatus: 'idle' },
      dapp: {
        dapps: {
          [HOST]: {
            host: HOST,
            accountId: 0,
            accountType: type,
            chain: INetworkType.Ethereum,
            chainId: 57057,
            date: 1,
          },
        },
      },
      spamFilter: spamFilterReducer(undefined, { type: 'test/init' }),
    } as any,
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({ serializableCheck: false }),
  });
  const wallet = Object.create(MainController.prototype);
  Object.assign(wallet, { walletSessionGeneration: 1, isUnlocked: () => true });
  mockController = { wallet, dapp: DAppController(() => true) };
  mockEmitter.mockImplementation(async (method: string[]) => {
    if (method[1] === 'hydrateSmartAccount') return metadata;
    if (method[1] === 'preflightSmartAccountCustomValidator')
      return { ok: true, failures: [], compositeCompatible: true };
    throw new Error(`Unexpected approval method: ${method.join('.')}`);
  });
  jest.mocked(popupPromise).mockImplementation(async (popup) => {
    expect(popup.route).toBe(MethodRoute.SmartAccountModules);
    // Preserve the actual handler's payload through its JSON transport shape.
    mockQuery = JSON.parse(
      JSON.stringify({ ...popup.data, eventName: popup.eventName })
    );
    await act(async () => {
      render(
        <Provider store={mockStore}>
          <RenderBoundary>
            <SmartAccountModuleConsent />
          </RenderBoundary>
        </Provider>
      );
    });
    throw Object.assign(new Error('User cancelled module approval'), {
      code: 4001,
    });
  });
});
afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

const request = (method: string, module: unknown) =>
  onMessage({ type: 'METHOD_REQUEST', data: { method, params: [module] } }, {
    url: `${HOST}/app`,
    tab: { id: 50 },
  } as chrome.runtime.MessageSender);

it.each([
  'wallet_requestSmartAccountModuleInstall',
  'wallet_requestSmartAccountModuleUninstall',
])(
  'retains a valid %s approval and ordinary user rejection',
  async (method) => {
    const result = await request(method, {
      address: MODULE,
      name: 'Public module',
      initData: '0x',
    });
    expect(result.error.code).toBe(4001);
    expect(popupPromise).toHaveBeenCalledTimes(1);
    expect(mockRenderErrors).toEqual([]);
    expect(screen.getByText('Public module')).toBeInTheDocument();
    expect(screen.getByText(MODULE)).toBeInTheDocument();
  }
);

it('renders a string invalid-address error without crashing', async () => {
  const result = await request('wallet_requestSmartAccountModuleInstall', {
    address: 'not-an-address',
  });
  expect(result.error.code).toBe(4001);
  expect(mockRenderErrors).toEqual([]);
  expect(
    screen.getByText('smartAccountHub.invalidModuleAddress')
  ).toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: 'buttons.confirm' })
  ).toBeDisabled();
});

it('retains semantic validation of string initialization data in the approval', async () => {
  const result = await request('wallet_requestSmartAccountModuleInstall', {
    address: MODULE,
    initData: 'not-hex',
  });
  expect(result.error.code).toBe(4001);
  expect(mockRenderErrors).toEqual([]);
  expect(
    screen.getByText('smartAccountHub.invalidInitData')
  ).toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: 'buttons.confirm' })
  ).toBeDisabled();
});

describe.each([
  'wallet_requestSmartAccountModuleInstall',
  'wallet_requestSmartAccountModuleUninstall',
])('%s input structure', (method) => {
  it.each([
    ['null module', null],
    ['array module', []],
    ['string module', MODULE],
    ['numeric address', { address: 123 }],
    ['null address', { address: null }],
    ['object name', { address: MODULE, name: { label: 'Untrusted module' } }],
    ['null name', { address: MODULE, name: null }],
    ['object initData', { address: MODULE, initData: { bytes: '0x' } }],
    ['numeric initData', { address: MODULE, initData: 123 }],
  ])('rejects %s before approval or mutation', async (_label, module) => {
    const before = mockStore.getState();
    const result = await request(method, module);
    expect({
      code: result.error?.code,
      popupCount: jest.mocked(popupPromise).mock.calls.length,
      renderErrors: mockRenderErrors,
    }).toEqual({ code: -32602, popupCount: 0, renderErrors: [] });
    expect(mockStore.getState()).toBe(before);
    expect(mockEmitter).not.toHaveBeenCalled();
  });

  it('rejects before opening account-selection consent for another active account', async () => {
    mockStore.dispatch(
      setActiveAccount({ id: 1, type: KeyringAccountType.SmartAccount })
    );
    const before = mockStore.getState();
    const result = await request(method, { address: 123 });
    expect(result.error.code).toBe(-32602);
    expect(popupPromise).not.toHaveBeenCalled();
    expect(mockEmitter).not.toHaveBeenCalled();
    expect(mockStore.getState()).toBe(before);
  });
});
