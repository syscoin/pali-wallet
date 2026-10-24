/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions":["node","node-addons"]}
 */
import '@testing-library/jest-dom';
import { clearRpcCaches } from '@sidhujag/sysweb3-network';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfigProvider } from 'antd';
import React from 'react';
import { Provider } from 'react-redux';

import MainController from 'scripts/Background/controllers/MainController';
import { loadState, walletPersistenceGate } from 'state/paliStorage';
import store, { persistCommittedWalletState } from 'state/store';
import { restoreVaultSnapshot } from 'state/vault';
import vaultCache from 'state/vaultCache';
import { setActiveSlip44, setNetworks } from 'state/vaultGlobal';
import { INetworkType } from 'types/network';
import { networkRegistrationFingerprint } from 'utils/networkRegistration';

import CustomRPC from './CustomRPC';
import { clearCustomRpcDrafts } from './customRpcDraft';
import ExternalAddRPC from './ExternalAddRPC';

jest.mock('scripts/Background', () => ({
  getController: jest.fn(),
  notificationManager: { cleanup: jest.fn() },
}));
jest.mock(
  'scripts/Background/controllers/providers/patchFetchWithPaliHeaders',
  () => ({ patchFetchWithPaliHeaders: jest.fn() })
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
  useQueryData: () => mockProposal,
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
jest.mock('components/Icon/Icon', () => ({
  LoadingSvg: () => <span>Pending</span>,
}));
jest.mock('components/Modal/StatusModal', () => ({
  StatusModal: ({ show, description }: any) =>
    show ? <div role="alert">{description}</div> : null,
}));
jest.mock('components/ToastActionFooter', () => ({
  ToastActionFooter: ({ children }: any) => <div>{children}</div>,
}));
jest.mock('components/index', () => ({
  Button: jest.requireActual('components/Button/Button').Button,
  Tooltip: ({ children }: any) => children,
}));

const originalChrome = global.chrome;
const originalFetch = globalThis.fetch;
const originalMessageChannel = globalThis.MessageChannel;
const originalMatchMedia = window.matchMedia;
const mockNavigate = jest.fn();
const mockAlert = { error: jest.fn(), success: jest.fn() };
const mockEmitter = jest.fn();
const mockLocation = {
  pathname: '/settings/networks/custom-rpc',
  search: '',
  hash: '',
  key: 'network-whitespace-proof',
  state: {} as any,
};
const RPC = 'https://rpc.fields.synthetic.invalid';
const source = {
  chainId: 1,
  kind: INetworkType.Ethereum,
  slip44: 60,
  label: 'Current synthetic chain',
  currency: 'eth',
  url: 'https://current.fields.synthetic.invalid',
};
let mockProposal: any = {};
let wallet: any;
let records: Record<string, any>;
let reads: any[];
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const calls = () =>
  mockEmitter.mock.calls.filter(([[, method]]) => method === 'addCustomRpc');
const edits = () =>
  mockEmitter.mock.calls.filter(([[, method]]) => method === 'editCustomRpc');

beforeEach(async () => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  jest.spyOn(window, 'close').mockImplementation(() => undefined);
  mockProposal = {};
  mockLocation.state = {
    customRpcDraftId: '00000000-0000-4000-8000-000000000001',
  };
  jest.spyOn(console, 'log').mockImplementation();
  jest.spyOn(console, 'warn').mockImplementation();
  clearCustomRpcDrafts();
  clearRpcCaches();
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
  reads = [];
  globalThis.fetch = jest.fn(async (url, options) => {
    const body = JSON.parse(String(options?.body));
    // A closed allowlist: no HTTP call escapes the synthetic transport.
    expect(url).toBe(RPC);
    expect(options?.method).toBe('POST');
    expect(body).toMatchObject({
      jsonrpc: '2.0',
      method: 'eth_chainId',
      params: [],
    });
    reads.push({ url, method: body.method });
    return {
      ok: true,
      status: 200,
      json: async () => ({ jsonrpc: '2.0', id: body.id, result: '0x7a69' }),
    } as Response;
  });
  global.chrome = {
    runtime: { id: 'synthetic-network-whitespace' },
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
  store.dispatch(setNetworks({ ethereum: { 1: source }, syscoin: {} }));
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
    if (method === 'getRpc') return wallet.getRpc(...args);
    if (method === 'addCustomRpc') return wallet.addCustomRpc(...args);
    if (method === 'editCustomRpc') return wallet.editCustomRpc(...args);
    // These tests stop at the saved network; switching is covered separately.
    if (method === 'setActiveNetwork') return undefined;
    throw new Error('Unexpected controller method: ' + method);
  });
  await persistCommittedWalletState(true);
});

afterEach(() => {
  cleanup();
  clearCustomRpcDrafts();
  clearRpcCaches();
  vaultCache.clearCache();
  jest.restoreAllMocks();
  global.chrome = originalChrome;
  globalThis.fetch = originalFetch;
  globalThis.MessageChannel = originalMessageChannel;
  window.matchMedia = originalMatchMedia;
  jest.clearAllTimers();
  jest.useRealTimers();
});

async function submit(
  mode: 'ordinary' | 'external',
  label: string,
  symbol: string
) {
  const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
  mockProposal = {
    host: 'https://dapp.synthetic.invalid',
    eventName: 'wallet_addEthereumChain',
    chainConfig: {
      chainId: '0x7a69',
      chainName: label,
      rpcUrls: [RPC],
      nativeCurrency: { name: 'Synthetic', symbol, decimals: 18 },
    },
  };
  render(
    <Provider store={store}>
      {mode === 'ordinary' ? <CustomRPC /> : <ExternalAddRPC />}
    </Provider>
  );
  if (mode === 'ordinary')
    await waitFor(() =>
      expect(mockEmitter).toHaveBeenCalledWith(
        ['wallet', 'getChainData'],
        [INetworkType.Ethereum]
      )
    );
  const name =
    mode === 'ordinary'
      ? screen.getByRole('combobox')
      : screen.getByPlaceholderText('settings.networkName');
  await user.clear(name);
  if (label) await user.type(name, label);
  const endpoint = screen.getByPlaceholderText('settings.rpcUrlPlaceholder');
  await user.clear(endpoint);
  await user.type(endpoint, RPC);
  await user.tab();
  if (mode === 'ordinary') {
    const id = screen.getByPlaceholderText('settings.chainIdCustomEvm');
    await user.clear(id);
    await user.type(id, '31337');
  }
  const currency = screen.getByPlaceholderText('settings.symbol');
  await user.clear(currency);
  if (symbol) await user.type(currency, symbol);
  await user.click(
    screen.getByRole('button', {
      name: mode === 'ordinary' ? 'buttons.save' : 'buttons.addNetwork',
    })
  );
  return { name, currency };
}

describe.each(['ordinary', 'external'] as const)(
  '%s custom-network required fields',
  (mode) => {
    it.each([
      ['normal', 'My synthetic chain', 'TST'],
      ['meaningfully padded label', '  My synthetic chain  ', 'TST'],
      ['meaningfully padded symbol', 'My synthetic chain', ' TST '],
    ])(
      'saves %s through the SDK and durable registry without trimming',
      async (_kind, label, symbol) => {
        await submit(mode, label, symbol);
        await waitFor(() =>
          expect(mockAlert.success).toHaveBeenCalledWith(
            'settings.rpcSuccessfullyAdded'
          )
        );
        const live = store.getState().vaultGlobal.networks.ethereum[31337];
        expect(live).toMatchObject({
          label,
          currency: symbol.toLowerCase(),
          chainId: 31337,
          url: RPC,
        });
        expect(
          (await loadState()).vaultGlobal.networks.ethereum[31337]
        ).toEqual(live);
        expect(calls()).toHaveLength(1);
        expect(reads.length).toBeGreaterThan(0);
        expect(reads.every((read) => read.method === 'eth_chainId')).toBe(true);
      }
    );

    it.each([
      ['empty label', '', 'TST', 'settings.networkNameRequired'],
      ['spaces label', '   ', 'TST', 'settings.networkNameRequired'],
      ['NBSP label', '\u00a0\u00a0', 'TST', 'settings.networkNameRequired'],
      ['empty symbol', 'My synthetic chain', '', 'settings.symbolRequired'],
      ['spaces symbol', 'My synthetic chain', '   ', 'settings.symbolRequired'],
      [
        'NBSP symbol',
        'My synthetic chain',
        '\u00a0\u00a0',
        'settings.symbolRequired',
      ],
    ])(
      'refuses %s before adding or switching networks',
      async (_kind, label, symbol, message) => {
        const { name, currency } = await submit(mode, label, symbol);
        expect(await screen.findByText(message)).toBeVisible();
        expect(name).toHaveValue(label);
        expect(currency).toHaveValue(symbol);
        expect(calls()).toHaveLength(0);
        expect(
          store.getState().vaultGlobal.networks.ethereum[31337]
        ).toBeUndefined();
        expect(
          (await loadState()).vaultGlobal.networks.ethereum[31337]
        ).toBeUndefined();
        expect(mockAlert.success).not.toHaveBeenCalled();
        expect(
          mockEmitter.mock.calls.some(
            ([[, method]]) => method === 'setActiveNetwork'
          )
        ).toBe(false);
      }
    );
  }
);

async function editExisting(label: string | null) {
  const previous = {
    ...source,
    chainId: 31337,
    label,
    currency: 'tst',
    url: RPC,
    default: false,
  };
  store.dispatch(
    setNetworks({
      ethereum: { 1: source, 31337: previous },
      syscoin: {},
    } as any)
  );
  await persistCommittedWalletState(true);
  mockLocation.state = {
    ...mockLocation.state,
    isEditing: true,
    isDefault: false,
    selected: { chainId: 31337, kind: INetworkType.Ethereum },
  };
  const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
  render(
    <Provider store={store}>
      <CustomRPC />
    </Provider>
  );
  return {
    user,
    previous,
    labelInput: screen.getByPlaceholderText('settings.label'),
  };
}

it.each(['', '   ', null])(
  'allows an existing invalid label %j to be repaired through the real save path',
  async (label) => {
    const { user, previous, labelInput } = await editExisting(label);
    expect(labelInput).toHaveAttribute('type', 'text');
    expect(labelInput).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'buttons.save' }));
    expect(
      await screen.findByText('settings.networkNameRequired')
    ).toBeVisible();
    expect(edits()).toHaveLength(0);
    expect((await loadState()).vaultGlobal.networks.ethereum[31337]).toEqual(
      previous
    );
    expect(mockAlert.success).not.toHaveBeenCalled();

    await user.clear(labelInput);
    await user.type(labelInput, '  Repaired chain  ');
    await user.click(screen.getByRole('button', { name: 'buttons.save' }));
    await waitFor(() =>
      expect(mockAlert.success).toHaveBeenCalledWith(
        'settings.rpcSuccessfullyEdited'
      )
    );
    expect(edits()).toHaveLength(1);
    expect(edits()[0][1][1]).toBe(
      networkRegistrationFingerprint(previous as any)
    );
    const live = store.getState().vaultGlobal.networks.ethereum[31337];
    expect(live).toMatchObject({
      label: '  Repaired chain  ',
      currency: 'tst',
      url: RPC,
    });
    expect((await loadState()).vaultGlobal.networks.ethereum[31337]).toEqual(
      live
    );
    expect(calls()).toHaveLength(0);
    expect(reads.length).toBeGreaterThan(0);
  }
);

it('keeps a valid padded edit label hidden and preserves its registration identity', async () => {
  const { user, previous, labelInput } = await editExisting(
    '  Existing chain  '
  );
  expect(labelInput).toHaveAttribute('type', 'hidden');
  expect(labelInput).not.toBeVisible();
  await user.click(screen.getByRole('button', { name: 'buttons.save' }));
  await waitFor(() =>
    expect(mockAlert.success).toHaveBeenCalledWith(
      'settings.rpcSuccessfullyEdited'
    )
  );
  expect(edits()).toHaveLength(1);
  expect(edits()[0][1][1]).toBe(
    networkRegistrationFingerprint(previous as any)
  );
  const live = store.getState().vaultGlobal.networks.ethereum[31337];
  expect(live.label).toBe(previous.label);
  expect((await loadState()).vaultGlobal.networks.ethereum[31337]).toEqual(
    live
  );
});

// Real Form/field semantics for the Add-network Name, without CSS timing.
// Existing SDK registration/edit and keyboard suites remain unchanged.
async function nameFeedbackScope() {
  return clone({
    active: store.getState().vault.activeNetwork,
    live: store.getState().vaultGlobal.networks,
    saved: (await loadState()).vaultGlobal.networks,
  });
}

async function openNameFeedbackForm() {
  const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
  const before = await nameFeedbackScope();
  render(
    <ConfigProvider theme={{ token: { motion: false } }}>
      <Provider store={store}>
        <CustomRPC />
      </Provider>
    </ConfigProvider>
  );
  await waitFor(() =>
    expect(mockEmitter).toHaveBeenCalledWith(
      ['wallet', 'getChainData'],
      [INetworkType.Ethereum]
    )
  );
  return {
    user,
    before,
    name: screen.getByRole('combobox', { name: 'settings.label' }),
    symbol: screen.getByPlaceholderText('settings.symbol'),
    endpoint: screen.getByPlaceholderText('settings.rpcUrlPlaceholder'),
    save: screen.getByRole('button', { name: 'buttons.save' }),
  };
}

async function expectNameFeedbackScopeUnchanged(
  before: Awaited<ReturnType<typeof nameFeedbackScope>>
) {
  expect(await nameFeedbackScope()).toEqual(before);
  expect(calls()).toHaveLength(0);
  expect(edits()).toHaveLength(0);
  expect(reads).toEqual([]);
  expect(mockAlert.success).not.toHaveBeenCalled();
  expect(
    mockEmitter.mock.calls.some(([[, method]]) => method === 'setActiveNetwork')
  ).toBe(false);
}

it('keeps the pristine Name native control and existing affix/dropdown structure', async () => {
  const { name, symbol, endpoint, before } = await openNameFeedbackForm();
  expect(name).toHaveValue('');
  expect(symbol).toHaveValue('');
  expect(endpoint).toHaveValue('');
  expect(name).toHaveAttribute('id', 'rpc_label');
  expect(name).toHaveAttribute('aria-required', 'true');
  expect(name).not.toHaveAttribute('aria-invalid', 'true');
  expect(name).not.toHaveAttribute('aria-describedby');
  expect(document.querySelectorAll('#rpc_label')).toHaveLength(1);
  const affix = name.closest('.ant-input-affix-wrapper');
  expect(affix).not.toBeNull();
  const anchor = document.getElementById('custom-rpc-network-suggestions')!
    .parentElement!;
  expect(affix!.parentElement).toBe(anchor);
  expect(anchor).toHaveClass('relative', 'w-full');
  expect(anchor).not.toHaveAttribute('id', 'rpc_label');
  expect(anchor).not.toHaveAttribute('aria-required');
  expect(anchor.querySelector('.ant-form-item-feedback-icon')).toBeNull();
  await expectNameFeedbackScopeUnchanged(before);
});

it.each(['', '   ', '\u00a0\u00a0'])(
  'associates current required Name %j with the actual native combobox without adding an icon',
  async (value) => {
    const { user, name, symbol, endpoint, save, before } =
      await openNameFeedbackForm();
    if (value) await user.type(name, value);
    await user.click(save);
    expect(
      await screen.findByText('settings.networkNameRequired')
    ).toBeVisible();
    await waitFor(() => expect(name).toHaveAttribute('aria-invalid', 'true'));
    expect(name).toHaveValue(value);
    expect(name).toHaveAttribute('aria-describedby', 'rpc_label_help');
    expect(name).toHaveAccessibleDescription('settings.networkNameRequired');
    expect(document.querySelectorAll('#rpc_label_help')).toHaveLength(1);
    expect(document.getElementById('rpc_label_help')).toHaveTextContent(
      'settings.networkNameRequired'
    );
    expect(name).toHaveAttribute('aria-required', 'true');
    expect(name.closest('.ant-input-affix-wrapper')).not.toBeNull();
    const anchor = document.getElementById('custom-rpc-network-suggestions')!
      .parentElement!;
    expect(anchor.querySelector('.ant-form-item-feedback-icon')).toBeNull();
    expect(symbol).toHaveValue('');
    expect(endpoint).toHaveValue('');
    await expectNameFeedbackScopeUnchanged(before);
  }
);

it('clears stale Name feedback after ordinary correction while preserving focus and meaningful padding', async () => {
  const { user, name, symbol, endpoint, save, before } =
    await openNameFeedbackForm();
  await user.click(save);
  expect(await screen.findByText('settings.networkNameRequired')).toBeVisible();
  await user.type(name, '  Personal sandbox  ');
  await waitFor(() => {
    expect(name).not.toHaveAttribute('aria-invalid', 'true');
    expect(name).not.toHaveAttribute('aria-describedby');
    expect(
      screen.queryByText('settings.networkNameRequired')
    ).not.toBeInTheDocument();
  });
  expect(name).toHaveFocus();
  expect(name).toHaveValue('  Personal sandbox  ');
  expect(name).toHaveAttribute('aria-required', 'true');
  expect(name).toHaveAccessibleDescription('');
  expect(document.querySelectorAll('#rpc_label')).toHaveLength(1);
  expect(name.closest('.ant-input-affix-wrapper')).not.toBeNull();
  const anchor = document.getElementById('custom-rpc-network-suggestions')!
    .parentElement!;
  expect(anchor.querySelector('.ant-form-item-feedback-icon')).toBeNull();
  expect(symbol).toHaveValue('');
  expect(endpoint).toHaveValue('');
  await expectNameFeedbackScopeUnchanged(before);
});
