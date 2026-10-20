/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';

import { AddToken } from './AddToken';

const mockEmitter = jest.fn();
const mockAlert = { success: jest.fn(), error: jest.fn() };
let mockState: any;
jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { symbol?: string }) =>
      key === 'tokens.importNamedToken'
        ? `Import ${values?.symbol} token`
        : key,
  }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({ navigate: jest.fn(), alert: mockAlert }),
}));
jest.mock('components/Icon/Icon', () => ({
  TbFileImport: () => null,
  LoadingOutlined: () => <span data-testid="validating" />,
  CheckCircleOutlined: () => null,
  CloseCircleOutlined: () => null,
  FiDownload: () => null,
  RiShareForward2Line: () => null,
}));
jest.mock('components/TokenIcon', () => ({ TokenIcon: () => null }));
jest.mock('components/Tooltip', () => ({
  Tooltip: ({ children }: any) => children,
}));
jest.mock('components/index', () => ({
  ImportableAssetsList: jest.requireActual('components/ImportableAssetsList')
    .ImportableAssetsList,
  IconButton: ({ children, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
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

const A = '123457';
const B = '765432';
const details = (assetGuid: string, symbol = `SPT${assetGuid}`) => ({
  assetGuid,
  symbol,
  name: symbol,
  balance: 2,
  decimals: 8,
});
const deferred = () => {
  let resolve!: (value: any) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise((accept, refuse) => {
    resolve = accept;
    reject = refuse;
  });
  return { promise, resolve, reject };
};
const tree = () => (
  <MemoryRouter initialEntries={['/tokens/add?tab=custom']}>
    <Link to="/home">Home</Link>
    <Routes>
      <Route path="/tokens/add" element={<AddToken />} />
      <Route path="/home" element={<p>Wallet home</p>} />
    </Routes>
  </MemoryRouter>
);
const input = () => screen.getByLabelText('tokens.assetGuid');
const edit = (guid: string) =>
  fireEvent.change(input(), { target: { value: guid } });
const advance = (time = 500) =>
  act(async () => jest.advanceTimersByTimeAsync(time));
const validations = () =>
  mockEmitter.mock.calls.filter(([[, method]]) => method === 'validateSPTOnly');
const coalescedUndo = async () => {
  const set = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value'
  )!.set!;
  await act(async () => {
    set.call(input(), B);
    input().dispatchEvent(new Event('input', { bubbles: true }));
    set.call(input(), A);
    input().dispatchEvent(new Event('input', { bubbles: true }));
  });
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockState = {
    vault: {
      isBitcoinBased: true,
      activeAccount: { type: 'HDAccount', id: 0 },
      accounts: {
        HDAccount: {
          0: { address: 'public-a', xpub: 'public-xpub-a' },
          1: { address: 'public-b', xpub: 'public-xpub-b' },
        },
      },
      activeNetwork: {
        kind: 'syscoin',
        chainId: 5700,
        url: 'https://blockbook.synthetic.invalid',
      },
      accountAssets: {},
    },
  };
  mockEmitter.mockReset().mockImplementation(([, method], args) => {
    if (method === 'getUserOwnedTokens') return Promise.resolve([]);
    if (method === 'validateSPTOnly') return Promise.resolve(details(args[0]));
    throw new Error(`Unexpected controller call: ${method}`);
  });
});
afterEach(() => jest.useRealTimers());

it('preserves the 500ms debounce and validates an ordinary new GUID', async () => {
  render(tree());
  edit(A);
  await advance(499);
  expect(validations()).toHaveLength(0);
  await advance(1);
  expect(
    screen.getByRole('button', { name: `Import SPT${A} token` })
  ).toBeVisible();
  edit(B);
  expect(
    screen.queryByRole('button', { name: `Import SPT${A} token` })
  ).toBeNull();
  await advance();
  expect(
    screen.getByRole('button', { name: `Import SPT${B} token` })
  ).toBeVisible();
});

it('restores a validated GUID after coalesced A-B-A native input events', async () => {
  render(tree());
  edit(A);
  await advance();
  await coalescedUndo();
  await advance();
  expect(input()).toHaveValue(A);
  expect(validations()).toHaveLength(2);
  expect(
    screen.getByRole('button', { name: `Import SPT${A} token` })
  ).toBeVisible();
});

it('rejects the old pending A result after A-B-A and admits the new A response', async () => {
  const old = deferred(),
    fresh = deferred();
  mockEmitter.mockImplementation(([, method]) =>
    method === 'getUserOwnedTokens'
      ? Promise.resolve([])
      : validations().length === 1
      ? old.promise
      : fresh.promise
  );
  render(tree());
  edit(A);
  await advance();
  await coalescedUndo();
  await act(async () => old.resolve(details(A, 'OLD')));
  expect(screen.queryByRole('button', { name: 'Import OLD token' })).toBeNull();
  await advance();
  expect(validations()).toHaveLength(2);
  await act(async () => fresh.resolve(details(A, 'CURRENT')));
  expect(
    screen.getByRole('button', { name: 'Import CURRENT token' })
  ).toBeVisible();
});

it.each(['', 'invalid'])(
  'clears blank or invalid input %s without a backend validation',
  async (guid) => {
    render(tree());
    edit(A);
    await advance();
    edit(guid);
    await advance();
    expect(validations()).toHaveLength(1);
    expect(
      screen.queryByRole('button', { name: `Import SPT${A} token` })
    ).toBeNull();
    expect(screen.queryByTestId('validating')).toBeNull();
  }
);

it('keeps current B when the older A request rejects late', async () => {
  const old = deferred();
  mockEmitter.mockImplementation(([, method], args) =>
    method === 'getUserOwnedTokens'
      ? Promise.resolve([])
      : args[0] === A
      ? old.promise
      : Promise.resolve(details(B))
  );
  render(tree());
  edit(A);
  await advance();
  edit(B);
  await advance();
  await act(async () => old.reject(new Error('Old read failed')));
  expect(
    screen.getByRole('button', { name: `Import SPT${B} token` })
  ).toBeVisible();
  expect(screen.queryByTestId('validating')).toBeNull();
});

it.each(['account', 'network', 'unmount'])(
  'does not publish a pending GUID after %s departure',
  async (departure) => {
    const old = deferred();
    mockEmitter.mockImplementation(([, method]) =>
      method === 'getUserOwnedTokens' ? Promise.resolve([]) : old.promise
    );
    const view = render(tree());
    edit(A);
    await advance();
    if (departure === 'unmount')
      fireEvent.click(screen.getByRole('link', { name: 'Home' }));
    else {
      if (departure === 'account')
        mockState.vault.activeAccount = { type: 'HDAccount', id: 1 };
      else
        mockState.vault.activeNetwork = {
          ...mockState.vault.activeNetwork,
          url: 'https://other-blockbook.synthetic.invalid',
        };
      view.rerender(tree());
    }
    await act(async () => old.resolve(details(A)));
    expect(
      screen.queryByRole('button', { name: `Import SPT${A} token` })
    ).toBeNull();
    expect(validations()).toHaveLength(1);
  }
);
