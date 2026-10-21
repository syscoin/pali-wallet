/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';

import { AddToken } from './AddToken';

const mockEmitter = jest.fn();
let mockState: any;
let mockRead: (identifier: string) => Promise<any>;
let mockUtxo = false;
let mockNft = false;

jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { symbol?: string }) =>
      key === 'tokens.importNamedToken'
        ? `Import ${values?.symbol} token`
        : key,
    i18n: { language: 'en' },
  }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({
    navigate: jest.fn(),
    alert: { success: jest.fn(), error: jest.fn() },
  }),
}));
jest.mock('components/Icon/Icon', () => ({
  TbFileImport: () => null,
  FiDownload: () => null,
  RiShareForward2Line: () => null,
  LoadingOutlined: () => null,
  CheckCircleOutlined: () => null,
  CloseCircleOutlined: () => null,
}));
jest.mock('components/TokenIcon', () => ({ TokenIcon: () => null }));
jest.mock('components/Tooltip', () => ({
  Tooltip: ({ children }: any) => children,
}));
jest.mock('components/index', () => ({
  ImportableAssetsList: jest.requireActual('components/ImportableAssetsList')
    .ImportableAssetsList,
  IconButton: jest.requireActual('components/IconButton/IconButton').IconButton,
}));
jest.mock('utils/index', () => ({
  getCurrentTab: (params: URLSearchParams, _state: unknown, fallback: string) =>
    params.get('tab') || fallback,
  createBrowsingNavigationContext: jest.fn(),
  navigateWithContext: jest.fn(),
  truncate: (value: unknown) => String(value),
  ellipsis: (value: unknown) => String(value),
  formatFullPrecisionBalance:
    jest.requireActual('utils/format').formatFullPrecisionBalance,
}));

const CONTRACT = `0x${'33'.repeat(20)}`;
const OTHER_CONTRACT = `0x${'44'.repeat(20)}`;
const GUID = '123457';
const OTHER_GUID = '765432';
const details = (identifier: string) =>
  mockUtxo
    ? {
        assetGuid: identifier,
        symbol: 'SPT',
        name: 'SPT token',
        balance: 3,
        decimals: 8,
      }
    : {
        contractAddress: identifier,
        chainId: 1,
        symbol: 'EVM',
        name: 'EVM token',
        tokenStandard: mockNft ? 'ERC-1155' : 'ERC-20',
        isNft: mockNft,
        decimals: mockNft ? 0 : 18,
        balance: 3,
        image: 'https://assets.synthetic.invalid/evm.png',
      };
const Location = () => {
  const location = useLocation();
  return (
    <output data-testid="location">
      {JSON.stringify({ search: location.search, state: location.state })}
    </output>
  );
};
const locationState = () =>
  JSON.parse(screen.getByTestId('location').textContent!);
const advanceValidation = () =>
  act(async () => jest.advanceTimersByTimeAsync(500));
const headerTab = (name: string) =>
  screen
    .getAllByRole('button', { name })
    .find(
      (button) => !button.closest('[data-navigation-scroll="token-import"]')
    )!;
const validations = () =>
  mockEmitter.mock.calls.filter(([[, method]]) =>
    ['getTokenDetailsWithMarketData', 'validateSPTOnly'].includes(method)
  );
const expectNoSave = () =>
  expect(
    mockEmitter.mock.calls.some(([[, method]]) => method === 'saveTokenInfo')
  ).toBe(false);

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockUtxo = false;
  mockNft = false;
  mockRead = async (identifier) => details(identifier);
  mockEmitter.mockImplementation(([, method], args) => {
    if (method === 'getUserOwnedTokens') return Promise.resolve([]);
    if (['getTokenDetailsWithMarketData', 'validateSPTOnly'].includes(method))
      return mockRead(args[0]);
    if (method === 'verifyERC1155Ownership')
      return Promise.resolve([
        { tokenId: args[2][0], balance: 2, rawBalance: '2', verified: true },
      ]);
    throw new Error(`Unexpected controller call: ${method}`);
  });
});
afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

const startCustom = async (utxo: boolean, withApi = true) => {
  mockUtxo = utxo;
  mockState = {
    vault: {
      isBitcoinBased: utxo,
      activeAccount: { type: 'HDAccount', id: 0 },
      accounts: {
        HDAccount: {
          0: {
            address: `0x${'11'.repeat(20)}`,
            xpub: 'public-xpub',
          },
        },
      },
      activeNetwork: {
        kind: utxo ? 'syscoin' : 'ethereum',
        chainId: utxo ? 5700 : 1,
        url: 'https://rpc.synthetic.invalid',
        ...(withApi && { apiUrl: 'https://explorer.synthetic.invalid/api' }),
      },
      accountAssets: {},
    },
  };
  const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
  render(
    <MemoryRouter initialEntries={['/tokens/add']}>
      <AddToken />
      <Location />
    </MemoryRouter>
  );
  await act(async () => undefined);
  if (utxo || withApi) await user.click(headerTab('tokens.addCustomTab'));
  const input = screen.getByLabelText(
    utxo ? 'tokens.assetGuid' : 'settings.contractAddress'
  ) as HTMLInputElement;
  const identifier = utxo ? GUID : CONTRACT;
  const importName = `Import ${utxo ? 'SPT' : 'EVM'} token`;
  return { user, input, identifier, importName };
};
const validatedCustom = async (utxo: boolean) => {
  const context = await startCustom(utxo);
  await context.user.type(context.input, context.identifier);
  await advanceValidation();
  expect(
    screen.getByRole('button', { name: context.importName })
  ).toBeEnabled();
  return context;
};
const activate = async (
  user: ReturnType<typeof userEvent.setup>,
  control: HTMLElement,
  action: string
) => {
  if (action === 'pointer') return user.click(control);
  for (
    let presses = 0;
    presses < 12 && document.activeElement !== control;
    presses += 1
  )
    await user.tab();
  expect(control).toHaveFocus();
  await user.keyboard(action === 'Enter' ? '{Enter}' : ' ');
};

describe.each([false, true])('custom token draft (UTXO %s)', (utxo) => {
  it.each(['pointer', 'Enter', 'Space'])(
    'keeps validated input and preview on %s reactivation of the active tab',
    async (action) => {
      const { user, input, identifier, importName } = await validatedCustom(
        utxo
      );
      const before = locationState();
      await activate(user, headerTab('tokens.addCustomTab'), action);
      expect(input).toHaveValue(identifier);
      expect(screen.getByRole('button', { name: importName })).toBeEnabled();
      expect(locationState()).toEqual(before);
      expect(validations()).toHaveLength(1);
      expectNoSave();
    }
  );

  it('keeps the current draft while focusing its fields', async () => {
    const { user, input, identifier, importName } = await validatedCustom(utxo);
    await user.click(input);
    await user.tab();
    expect(input).toHaveValue(identifier);
    expect(screen.getByRole('button', { name: importName })).toBeEnabled();
    expectNoSave();
  });

  it('retains the existing reset behavior on a genuine owned-to-custom tab change', async () => {
    const { user, input, importName } = await validatedCustom(utxo);
    await user.click(headerTab('tokens.yourTokens'));
    expect(locationState().search).toBe('?tab=owned');
    expect(input).not.toBeInTheDocument();
    await user.click(headerTab('tokens.addCustomTab'));
    const fresh = screen.getByLabelText(
      utxo ? 'tokens.assetGuid' : 'settings.contractAddress'
    );
    expect(fresh).toHaveValue('');
    expect(locationState().search).toBe('?tab=custom');
    expect(screen.queryByRole('button', { name: importName })).toBeNull();
    await user.type(fresh, utxo ? OTHER_GUID : OTHER_CONTRACT);
    await advanceValidation();
    expect(screen.getByRole('button', { name: importName })).toBeEnabled();
    expectNoSave();
  });

  it('keeps a pending validation current when its active tab is reselected', async () => {
    let resolve!: (value: any) => void;
    mockRead = () => new Promise((accept) => (resolve = accept));
    const { user, input, identifier, importName } = await startCustom(utxo);
    await user.type(input, identifier);
    await advanceValidation();
    expect(validations()).toHaveLength(1);
    await user.click(headerTab('tokens.addCustomTab'));
    expect(input).toHaveValue(identifier);
    await act(async () => resolve(details(identifier)));
    expect(screen.getByRole('button', { name: importName })).toBeEnabled();
    expect(validations()).toHaveLength(1);
    expectNoSave();
  });
});

it('keeps the verified ERC1155 token ID and preview on active-tab reactivation', async () => {
  mockNft = true;
  const { user, input, identifier, importName } = await startCustom(false);
  await user.type(input, identifier);
  await advanceValidation();
  const tokenId = screen.getByLabelText('send.tokenId');
  await user.type(tokenId, '7');
  await waitFor(() =>
    expect(screen.getByRole('button', { name: importName })).toBeEnabled()
  );
  const before = locationState();
  await user.click(headerTab('tokens.addCustomTab'));
  expect(input).toHaveValue(identifier);
  expect(tokenId).toHaveValue('7');
  expect(screen.getByRole('button', { name: importName })).toBeEnabled();
  expect(locationState()).toEqual(before);
  expectNoSave();
});

it('keeps manual-only EVM import available without an explorer API or tab selector', async () => {
  const { user, input, identifier, importName } = await startCustom(
    false,
    false
  );
  expect(
    screen.queryByRole('button', { name: 'tokens.addCustomTab' })
  ).toBeNull();
  await user.type(input, identifier);
  await advanceValidation();
  expect(input).toHaveValue(identifier);
  expect(screen.getByRole('button', { name: importName })).toBeEnabled();
  expect(
    mockEmitter.mock.calls.some(
      ([[, method]]) => method === 'getUserOwnedTokens'
    )
  ).toBe(false);
  expectNoSave();
});
