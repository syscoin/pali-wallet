/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions":["node","node-addons"]}
 */
import '@testing-library/jest-dom';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QRCodeSVG } from 'qrcode.react';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import en from 'assets/locales/en.json';
import fr from 'assets/locales/fr.json';
import vaultGlobalReducer, { setNetwork } from 'state/vaultGlobal';
import { INetwork, INetworkType } from 'types/network';

import { Receive } from './Receive';

// Mounted presentation and native-control regression. Browser qualification
// separately proves actual custom registration, durable switching and fences.
const mockWrite = jest.fn();
const mockSuccess = jest.fn();
const mockError = jest.fn();
const mockValidate = jest.fn();
let mockState: any;
let mockLanguage: 'en' | 'fr' = 'en';
let clock = 2_000_000_000_000;
const originalFetch = global.fetch;
const OWNER = '0x9858EfFD232B4033E47d90003D41EC34EcaEda94';
const LABEL = 'Shared test network';

jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockState },
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values: Record<string, unknown> = {}) => {
      const catalog = jest.requireActual(
        mockLanguage === 'fr'
          ? 'assets/locales/fr.json'
          : 'assets/locales/en.json'
      );
      const message = key
        .split('.')
        .reduce((entry: any, part) => entry?.[part], catalog);
      return typeof message === 'string'
        ? message.replace(/{{(\w+)}}/g, (_match, name) =>
            String(values[name] ?? '')
          )
        : key;
    },
  }),
}));
jest.mock('i18next', () => ({
  __esModule: true,
  default: { t: () => 'transactions.copyFailed' },
}));
jest.mock('react-toastify', () => ({
  toast: Object.assign(jest.fn(), {
    success: (...args: any[]) => mockSuccess(...args),
    error: (...args: any[]) => mockError(...args),
    dismiss: jest.fn(),
  }),
}));
jest.mock('hooks/index', () => ({
  useUtils: jest.requireActual('../../hooks/useUtils').useUtils,
}));
jest.mock('../../hooks/useSafeNavigate', () => ({
  useSafeNavigate: () => jest.requireActual('react-router-dom').useNavigate(),
}));
jest.mock('scripts/Background/controllers/controllerEmitter', () => ({
  controllerEmitter: (...args: any[]) => mockValidate(...args),
}));
jest.mock('components/index', () => ({
  Button: jest.requireActual('../../components/Button/Button').Button,
}));
jest.mock('components/Icon/Icon', () => ({ LoadingSvg: () => null }));

const network = (chainId: number, label = LABEL): INetwork => ({
  chainId,
  kind: INetworkType.Ethereum,
  slip44: 60,
  label,
  currency: 'eth',
  // These synthetic credential fields must never become disambiguation text.
  url: `https://rpc-user:rpc-password@rpc-${chainId}.synthetic.invalid/private?apiKey=rpc-secret-${chainId}`,
  apiUrl: `https://explorer.synthetic.invalid/api?apikey=explorer-secret-${chainId}`,
  explorer: `https://explorer.synthetic.invalid/private?key=explorer-secret-${chainId}`,
  key: `registry-secret-${chainId}`,
});
const catalog = () => (mockLanguage === 'fr' ? fr : en);
const chainText = (chainId: number) =>
  catalog().settings.chainNumber.replace('{{chainId}}', String(chainId));
const mount = () =>
  render(
    <MemoryRouter>
      <Receive />
    </MemoryRouter>
  );
const redraw = (view: ReturnType<typeof mount>) =>
  view.rerender(
    <MemoryRouter>
      <Receive />
    </MemoryRouter>
  );
const pill = () =>
  document.querySelector('#qr-code')!.previousElementSibling as HTMLElement;
const qrPaths = (address: string) => {
  const element = document.createElement('div');
  element.innerHTML = renderToStaticMarkup(<QRCodeSVG value={address} />);
  return Array.from(element.querySelectorAll('path')).map((entry) =>
    entry.getAttribute('d')
  );
};
const assertPublicAddressAndPrivacy = () => {
  expect(screen.getByText(OWNER)).toBeVisible();
  expect(
    Array.from(document.querySelectorAll('#qr-code path')).map((entry) =>
      entry.getAttribute('d')
    )
  ).toEqual(qrPaths(OWNER));
  expect(document.body.innerHTML).not.toMatch(
    /rpc-user|rpc-password|rpc-secret|explorer-secret|registry-secret/
  );
};
const settle = async () => {
  await act(async () => {
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(0);
  });
};

beforeEach(() => {
  jest.useFakeTimers();
  clock += 60_000;
  jest.setSystemTime(clock);
  jest.clearAllMocks();
  mockLanguage = 'en';
  mockWrite.mockReset().mockResolvedValue(undefined);
  mockValidate.mockReset().mockImplementation(() => {
    throw new Error('EVM Receive must not request UTXO validation');
  });
  global.fetch = jest.fn(async () => {
    throw new Error('No network allowed in mounted Receive identity proof');
  });
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: mockWrite },
  });
  mockState = {
    vault: {
      accounts: {
        HDAccount: { 0: { id: 0, label: 'Owner', address: OWNER } },
      },
      activeAccount: { id: 0, type: 'HDAccount' },
      activeNetwork: network(5),
    },
    vaultGlobal: {
      ...vaultGlobalReducer(undefined, { type: 'test/initial' }),
      activeSlip44: 60,
      networks: {
        ethereum: { 5: network(5), 11155111: network(11155111) },
        syscoin: {},
      },
    },
    dapp: { dapps: {} },
  };
});
afterEach(() => {
  cleanup();
  expect(global.fetch).not.toHaveBeenCalled();
  expect(mockValidate).not.toHaveBeenCalled();
  expect(mockState.dapp.dapps).toEqual({});
  global.fetch = originalFetch;
  jest.useRealTimers();
});

it('preserves the unique-label pill without an extra chain row', () => {
  mockState.vaultGlobal.networks.ethereum[11155111] = network(
    11155111,
    'Distinct control'
  );
  mount();
  const label = screen.getByText(LABEL);
  expect(label.parentElement).toBe(pill());
  expect(label.children).toHaveLength(0);
  expect(pill().children).toHaveLength(3);
  expect(pill()).toHaveTextContent(catalog().receive.hdAccount);
  expect(screen.queryByText(chainText(5))).not.toBeInTheDocument();
  assertPublicAddressAndPrivacy();
});

it.each([
  ['en', 5],
  ['en', 11155111],
  ['fr', 5],
  ['fr', 11155111],
] as const)(
  'shows the actual localized chain on duplicate-label %s/%s without changing QR or native Copy',
  async (language, chainId) => {
    mockLanguage = language;
    mockState.vault.activeNetwork = network(chainId);
    const before = JSON.parse(JSON.stringify(mockState));
    mount();
    expect(screen.getByText(chainText(chainId))).toBeVisible();
    expect(pill()).toHaveTextContent(LABEL);
    expect(pill()).toHaveTextContent(catalog().receive.hdAccount);
    expect(pill()).not.toHaveTextContent(
      chainText(chainId === 5 ? 11155111 : 5)
    );
    assertPublicAddressAndPrivacy();
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    // userEvent installs its own clipboard stub; restore this finite boundary.
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: mockWrite },
    });
    await user.tab();
    expect(
      screen.getByRole('button', { name: catalog().buttons.copy })
    ).toHaveFocus();
    await user.keyboard('{Enter}');
    await settle();
    expect(mockWrite).toHaveBeenCalledTimes(1);
    expect(mockWrite).toHaveBeenCalledWith(OWNER);
    expect(mockSuccess).toHaveBeenCalledWith(
      catalog().home.addressCopied,
      undefined
    );
    expect(mockError).not.toHaveBeenCalled();
    expect(mockState).toEqual(before);
  }
);

it('does not qualify a label collision in the other network family', () => {
  mockState.vaultGlobal.networks.ethereum = { 5: network(5) };
  mockState.vaultGlobal.networks.syscoin = {
    57: { ...network(57), kind: INetworkType.Syscoin, slip44: 57 },
  };
  mount();
  expect(screen.queryByText(chainText(5))).not.toBeInTheDocument();
  expect(screen.queryByText(chainText(57))).not.toBeInTheDocument();
  assertPublicAddressAndPrivacy();
});

it('requires an exact matching label and a different chain ID', () => {
  mockState.vaultGlobal.networks.ethereum = {
    5: network(5),
    55: network(5),
    11155111: network(11155111, LABEL.toLowerCase()),
  };
  mount();
  expect(screen.queryByText(chainText(5))).not.toBeInTheDocument();
  assertPublicAddressAndPrivacy();
});

it('updates the cue when a catalog label changes through the real reducer', () => {
  mockState.vaultGlobal.networks.ethereum[11155111] = network(
    11155111,
    'Distinct control'
  );
  const view = mount();
  expect(screen.queryByText(chainText(5))).not.toBeInTheDocument();
  mockState.vaultGlobal = vaultGlobalReducer(
    mockState.vaultGlobal,
    setNetwork({ network: network(11155111), isEdit: true })
  );
  redraw(view);
  expect(screen.getByText(chainText(5))).toBeVisible();
  mockState.vaultGlobal = vaultGlobalReducer(
    mockState.vaultGlobal,
    setNetwork({
      network: network(11155111, 'Distinct again'),
      isEdit: true,
    })
  );
  redraw(view);
  expect(screen.queryByText(chainText(5))).not.toBeInTheDocument();
  assertPublicAddressAndPrivacy();
});
