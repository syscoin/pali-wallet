/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createInstance } from 'i18next';
import React from 'react';
import { I18nextProvider } from 'react-i18next';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { createStore } from 'redux';

import de from 'assets/locales/de.json';
import en from 'assets/locales/en.json';
import fr from 'assets/locales/fr.json';

import { NftsDetails } from './NftsDetails';

// Mounted component, real localized copy and real contextual browsing state.
// Only controller transport and unrelated decorative icons are replaced.
// These tests assert native field semantics, not rendered pixel geometry.
const mockEmitter = jest.fn();
const mockAlert = { info: jest.fn(), error: jest.fn() };
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({ alert: mockAlert }),
}));
jest.mock('components/ChainIcon', () => ({ ChainIcon: () => null }));
jest.mock('components/TokenIcon', () => ({ TokenIcon: () => null }));
jest.mock('components/Icon/Icon', () => ({
  FiExternalLink: () => <svg aria-hidden="true" />,
  RiFileCopyLine: () => <svg aria-hidden="true" />,
  LoadingOutlined: () => <span data-testid="verification-pending" />,
  Icon: ({ name }: { name: string }) => (
    <svg aria-hidden="true" data-testid={name} />
  ),
}));
jest.mock('utils/index', () => jest.requireActual('utils/format'));

const OWNER = `0x${'11'.repeat(20)}`;
const OTHER = `0x${'22'.repeat(20)}`;
const CONTRACT = `0x${'ab'.repeat(20)}`;
const MAXIMUM =
  '115792089237316195423570985008687907853269984665640564039457584007913129639935';
const resources = { en, fr, de };
const collection = {
  contractAddress: CONTRACT,
  tokenStandard: 'ERC-721',
  name: 'Synthetic collection',
  chainId: 5700,
  balance: 1,
  isNft: true,
};
const deferred = () => {
  let resolve!: (value: any) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise((accept, refuse) => {
    resolve = accept;
    reject = refuse;
  });
  return { promise, resolve, reject };
};
let i18n: ReturnType<typeof createInstance>;
let store: ReturnType<typeof createStore>;
const requests: Array<{
  args: any[];
  reply: ReturnType<typeof deferred>;
}> = [];

beforeEach(async () => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation();
  requests.length = 0;
  const initial = {
    vault: {
      activeNetwork: {
        kind: 'ethereum',
        chainId: 5700,
        slip44: 60,
        url: 'https://rpc.synthetic.invalid',
        apiUrl: 'https://explorer.synthetic.invalid/api',
        explorer: 'https://explorer.synthetic.invalid',
      },
      activeAccount: { type: 'HDAccount', id: 0 },
      accounts: {
        HDAccount: {
          0: { type: 'HDAccount', id: 0, address: OWNER },
          1: { type: 'HDAccount', id: 1, address: OTHER },
        },
      },
      accountAssets: { HDAccount: { 0: { ethereum: [], syscoin: [] } } },
    },
  };
  store = createStore((state: any = initial, action: any) =>
    action.type === 'test/replace-scope' ? action.state : state
  );
  mockEmitter.mockImplementation(([family, method], args) => {
    expect(family).toBe('wallet');
    if (method === 'fetchNftTokenIds')
      return Promise.resolve([{ tokenId: '7', balance: 1 }]);
    if (method === 'verifyERC721Ownership') {
      const reply = deferred();
      requests.push({ args, reply });
      return reply.promise;
    }
    throw new Error(`Unexpected controller action: ${method}`);
  });
  i18n = createInstance();
  await i18n.init({
    lng: 'en',
    fallbackLng: 'en',
    resources: Object.fromEntries(
      Object.entries(resources).map(([locale, translation]) => [
        locale,
        { translation },
      ])
    ),
    initImmediate: false,
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
});

afterEach(() => {
  cleanup();
  expect(
    mockEmitter.mock.calls.every(
      ([[family, method]]) =>
        family === 'wallet' &&
        ['fetchNftTokenIds', 'verifyERC721Ownership'].includes(method)
    )
  ).toBe(true);
  expect(mockAlert.info).not.toHaveBeenCalled();
  expect(mockAlert.error).not.toHaveBeenCalled();
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const page = (nftData = collection) => (
  <I18nextProvider i18n={i18n}>
    <Provider store={store}>
      <MemoryRouter
        future={{
          ['v7_startTransition']: true,
          ['v7_relativeSplatPath']: true,
        }}
        initialEntries={['/home/details']}
      >
        <NftsDetails nftData={nftData} />
      </MemoryRouter>
    </Provider>
  </I18nextProvider>
);
const mount = async () => {
  const view = render(page());
  await act(async () => undefined);
  return view;
};
const input = () => screen.getByLabelText(i18n.t('send.tokenId') + ':');
const edit = (value: string) =>
  fireEvent.change(input(), { target: { value } });
const advance = async (milliseconds = 500) => {
  await act(async () => jest.advanceTimersByTimeAsync(milliseconds));
};
const complete = async (index: number, result: any) => {
  await act(async () => requests[index].reply.resolve(result));
};
const expectHelper = (key = 'send.selectTokenIdOrTryDifferent') => {
  const helper = document.getElementById('nft-details-token-id-help')!;
  expect(helper).toBeVisible();
  expect(helper).toHaveTextContent(i18n.t(key));
  expect(helper).toHaveClass(
    'text-brand-gray200',
    'text-[10px]',
    'mt-1',
    'text-center'
  );
  expect(input()).toHaveAttribute('aria-describedby', helper.id);
  expect(input()).toHaveAccessibleDescription(helper.textContent!.trim());
  expect(input()).not.toHaveAttribute('aria-invalid', 'true');
  expect(screen.queryByRole('alert')).toBeNull();
};
const expectError = (key: string, invalid: boolean) => {
  const helper = document.getElementById('nft-details-token-id-help')!;
  const alert = screen.getByRole('alert');
  expect(alert).toHaveTextContent(i18n.t(key));
  expect(alert).toHaveAttribute('id', 'nft-details-token-id-error');
  expect(alert).toHaveClass('text-xs', 'text-red-400', 'text-center');
  expect(input()).toHaveAttribute(
    'aria-describedby',
    `${helper.id} ${alert.id}`
  );
  expect(input()).toHaveAccessibleDescription(
    `${helper.textContent!.trim()} ${alert.textContent!.trim()}`
  );
  if (invalid) expect(input()).toHaveAttribute('aria-invalid', 'true');
  else expect(input()).not.toHaveAttribute('aria-invalid', 'true');
};

it('associates the current empty/discovered helper and preserves native chip-to-input keyboard order', async () => {
  const baseline = store.getState();
  const dispatch = jest.spyOn(store, 'dispatch');
  await mount();
  expect(input()).toHaveValue('');
  expect(input()).toHaveAccessibleName(en.send.tokenId + ':');
  expectHelper();
  const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
  await user.tab();
  expect(screen.getByRole('button', { name: '#7' })).toHaveFocus();
  await user.tab();
  expect(input()).toHaveFocus();
  await user.tab({ shift: true });
  expect(screen.getByRole('button', { name: '#7' })).toHaveFocus();
  expect(requests).toEqual([]);
  expect(store.getState()).toBe(baseline);
  expect(dispatch).not.toHaveBeenCalled();
});

it('waits for the existing debounce/current result, then associates malformed feedback and clears it immediately on correction', async () => {
  await mount();
  edit('abc');
  expectHelper('send.enterNftTokenId');
  await advance(499);
  expect(requests).toHaveLength(0);
  expectHelper('send.enterNftTokenId');
  await advance(1);
  expect(requests).toHaveLength(1);
  expect(requests[0].args).toEqual([CONTRACT, OWNER, ['abc']]);
  expect(screen.getByTestId('verification-pending')).toBeVisible();
  expectHelper('send.enterNftTokenId');
  await complete(0, [{ tokenId: 'abc', verified: false, balance: 0 }]);
  expectError('send.tokenVerificationFailed', true);
  edit('7');
  expectHelper('send.enterNftTokenId');
  expect(screen.queryByRole('alert')).toBeNull();
  await advance();
  await complete(1, [{ tokenId: '7', verified: true, balance: 1 }]);
  expectHelper();
  edit('');
  fireEvent.click(screen.getByRole('button', { name: '#7' }));
  expectHelper();
  expect(requests).toHaveLength(2);
});

it.each([
  'abc',
  '-1',
  '1.5',
  '1e3',
  '0x',
  '0xgg',
  (BigInt(MAXIMUM) + BigInt(1)).toString(),
  `0x1${'0'.repeat(64)}`,
  '9'.repeat(257),
])(
  'marks only a completed malformed or out-of-range identifier %s as format-invalid without changing its ownership request',
  async (value) => {
    await mount();
    edit(value);
    await advance();
    expect(requests).toHaveLength(1);
    expect(requests[0].args).toEqual([CONTRACT, OWNER, [value.trim()]]);
    expectHelper('send.enterNftTokenId');
    await complete(0, [{ tokenId: value.trim(), verified: false, balance: 0 }]);
    expectError('send.tokenVerificationFailed', true);
  }
);

it.each([
  '0',
  '7',
  '0007',
  '0x07',
  '0X07',
  MAXIMUM,
  `0x${'f'.repeat(64)}`,
  ' 7 ',
])(
  'keeps syntactically valid uint256 identifier %s distinct from an ownership/unsupported failure',
  async (value) => {
    await mount();
    edit(value);
    await advance();
    expect(requests[0].args).toEqual([CONTRACT, OWNER, [value.trim()]]);
    await complete(0, [{ tokenId: value.trim(), verified: false, balance: 0 }]);
    expect(input()).toHaveValue(value);
    expectError('send.tokenVerificationFailed', false);
  }
);

it.each([
  [
    'unowned',
    [{ tokenId: '7', verified: true, balance: 0 }],
    'send.youDontOwnThisToken',
  ],
  [
    'unsupported',
    [{ tokenId: '7', verified: false, balance: 0 }],
    'send.tokenVerificationFailed',
  ],
  ['missing result', [], 'send.tokenNotFound'],
] as const)(
  'associates %s feedback without announcing valid token 7 as format-invalid',
  async (_kind, result, key) => {
    await mount();
    edit('7');
    await advance();
    await complete(0, result);
    expectError(key, false);
  }
);

it('associates a transport rejection honestly without marking valid syntax invalid', async () => {
  await mount();
  edit('7');
  await advance();
  await act(async () =>
    requests[0].reply.reject(new Error('Synthetic read unavailable'))
  );
  expectError('send.verificationFailed', false);
  expect(
    screen.queryByText(new RegExp(en.send.youDontOwnThisToken))
  ).toBeNull();
});

it('ignores held A→B→A results until the newest matching request completes', async () => {
  await mount();
  for (const value of ['abc', '7', 'abc']) {
    edit(value);
    await advance();
  }
  expect(requests.map(({ args }) => args[2][0])).toEqual(['abc', '7', 'abc']);
  await complete(0, [{ tokenId: 'abc', verified: false, balance: 0 }]);
  expectHelper('send.enterNftTokenId');
  await complete(1, [{ tokenId: '7', verified: true, balance: 0 }]);
  expectHelper('send.enterNftTokenId');
  await complete(2, [{ tokenId: 'abc', verified: false, balance: 0 }]);
  expectError('send.tokenVerificationFailed', true);
});

it.each(['account', 'network endpoint', 'collection'] as const)(
  'does not attach a held previous %s result to the new contextual field',
  async (change) => {
    const view = await mount();
    edit('abc');
    await advance();
    if (change === 'collection') {
      view.rerender(
        page({ ...collection, contractAddress: `0x${'cd'.repeat(20)}` })
      );
    } else {
      const state = store.getState() as any;
      await act(async () => {
        store.dispatch({
          type: 'test/replace-scope',
          state: {
            ...state,
            vault: {
              ...state.vault,
              ...(change === 'account'
                ? { activeAccount: { type: 'HDAccount', id: 1 } }
                : {
                    activeNetwork: {
                      ...state.vault.activeNetwork,
                      url: 'https://next.synthetic.invalid',
                    },
                  }),
            },
          },
        } as any);
      });
    }
    await act(async () => undefined);
    expect(input()).toHaveValue('');
    expectHelper();
    await complete(0, [{ tokenId: 'abc', verified: false, balance: 0 }]);
    expectHelper();
    expect(requests).toHaveLength(1);
  }
);

it.each(['fr', 'de'] as const)(
  'links current %s helper/error copy without an English-only feedback replacement',
  async (locale) => {
    await i18n.changeLanguage(locale);
    await mount();
    expect(input()).toHaveAccessibleName(resources[locale].send.tokenId + ':');
    expectHelper();
    edit('abc');
    await advance();
    await complete(0, [{ tokenId: 'abc', verified: false, balance: 0 }]);
    expectError('send.tokenVerificationFailed', true);
    expect(screen.getByRole('alert')).toHaveTextContent(
      resources[locale].send.tokenVerificationFailed
    );
    expect(screen.queryByText(en.send.tokenVerificationFailed)).toBeNull();
  }
);

it('cancels an unmounted scheduled request and leaves the ERC1155 stored-ID view unchanged', async () => {
  const view = await mount();
  edit('abc');
  await advance(499);
  view.unmount();
  await advance(1);
  expect(requests).toEqual([]);
  render(page({ ...collection, tokenStandard: 'ERC-1155' }));
  await act(async () => undefined);
  expect(screen.queryByLabelText(en.send.tokenId + ':')).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(requests).toEqual([]);
});
