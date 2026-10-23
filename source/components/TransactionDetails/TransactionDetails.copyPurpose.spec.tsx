/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createInstance } from 'i18next';
import React from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import de from 'assets/locales/de.json';
import en from 'assets/locales/en.json';
import es from 'assets/locales/es.json';
import fr from 'assets/locales/fr.json';
import ja from 'assets/locales/ja.json';
import ko from 'assets/locales/ko.json';
import pt from 'assets/locales/pt.json';
import ru from 'assets/locales/ru.json';
import zh from 'assets/locales/zh.json';
import { TransactionDetailsList } from 'components/TransactionDetails/TransactionDetailsList';
import { EvmTransactionDetailsEnhanced } from 'pages/Home/Panel/components/Transactions/EVM/EvmDetailsEnhanced';
import { SyscoinTransactionDetails } from 'pages/Home/Panel/components/Transactions/UTXO/SyscoinDetails';
import vaultGlobalReducer, { setEnsName } from 'state/vaultGlobal';
import { Interface } from 'utils/ethersV6Compat';
import { EVM_TRANSACTION_HISTORY_SOURCE } from 'utils/evmNonce';

// Actual Activity detail components, formatting, selectors, copy handlers,
// IconButton and Tippy. Only public controller replies/navigation decoration
// are synthetic. No private material, signing or broadcast calls.
let mockState: any;
let mockTx: any;
let sequence = 0;
const mockEmitter = jest.fn();
const mockClipboard = jest.fn();
const mockAlert = { info: jest.fn(), error: jest.fn(), warning: jest.fn() };
const FROM_EVM = '0x1111111111111111111111111111111111111111';
const TO_EVM = '0x2222222222222222222222222222222222222222';
const CONTRACT = '0x3333333333333333333333333333333333333333';
const FROM_UTXO = 'tsys1qqyqszqgpqyqszqgpqyqszqgpqyqszqgpmtdx9f';
const TO_UTXO = 'tsys1qqvpsxqcrqvpsxqcrqvpsxqcrqvpsxqcrtl2zy7';
const GUID = '123456';
const FROM_ENS = 'sender.eth';
const TO_ENS = 'receiver.eth';
const originalClipboard = Object.getOwnPropertyDescriptor(
  navigator,
  'clipboard'
);
const resources = { en, es, pt, fr, de, zh, ja, ko, ru };
type Locale = keyof typeof resources;
const locales = Object.keys(resources) as Locale[];

jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockState },
}));
jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('hooks/index', () => ({
  useTransactionsListConfig: jest.requireActual(
    'pages/Home/Panel/components/Transactions/utils/useTransactionsInfos'
  ).useTransactionsListConfig,
  useUtils: () => ({ alert: mockAlert }),
}));
jest.mock('utils/navigationState', () => ({
  getWalletNavigationScope: () => mockState.scope,
}));
jest.mock('components/Icon', () => ({
  Icon: () => <span aria-hidden="true" />,
}));
jest.mock('components/Icon/Icon', () => ({
  ArrowUpSvg: () => null,
  ReceivedArrowSvg: () => null,
  NftFallbackSvg: () => null,
}));
jest.mock('utils/index', () => jest.requireActual('utils/format'));

const scenarios = [
  { kind: 'evm-native', locale: 'en' },
  { kind: 'evm-token', locale: 'es' },
  { kind: 'utxo-native', locale: 'en' },
  { kind: 'utxo-token', locale: 'es' },
] as const;

function configure(kind: string, withEns = false) {
  sequence += 1;
  const utxo = kind.startsWith('utxo');
  const token = kind.endsWith('token');
  const hash = `${utxo ? '' : '0x'}${sequence.toString(16).padStart(64, 'a')}`;
  const chainId = utxo ? 5700 : 1;
  mockTx = utxo
    ? {
        txid: hash,
        blockHash: 'b'.repeat(64),
        blockHeight: 100,
        blockTime: 1700000000,
        confirmations: 3,
        fees: '1000',
        direction: 'sent',
        value: '99999000',
        valueIn: '100000000',
        addressValueIn: '100000000',
        addressValueOut: '0',
        version: 2,
        vin: [
          {
            txid: 'c'.repeat(64),
            vout: 0,
            n: 0,
            sequence: 0xffffffff,
            isOwn: true,
            isAddress: true,
            addresses: [FROM_UTXO],
            value: '100000000',
          },
        ],
        vout: [
          {
            n: 0,
            isOwn: false,
            isAddress: true,
            addresses: [TO_UTXO],
            value: '99999000',
            ...(token
              ? { assetInfo: { assetGuid: GUID, value: '100000000' } }
              : {}),
          },
        ],
        ...(token
          ? {
              tokenType: 'SPTAssetAllocationSend',
              tokenTransfers: [
                { token: GUID, symbol: 'TST', decimals: 8, value: '100000000' },
              ],
              accountAssetTransfers: [
                {
                  assetGuid: GUID,
                  symbol: 'TST',
                  decimals: 8,
                  value: '100000000',
                },
              ],
            }
          : {}),
      }
    : {
        hash,
        chainId,
        from: FROM_EVM,
        to: token ? CONTRACT : TO_EVM,
        input: token
          ? new Interface([
              'function transfer(address to, uint256 amount)',
            ]).encodeFunctionData('transfer', [TO_EVM, '1000000'])
          : '0x',
        value: token ? '0' : '1000000000000000000',
        confirmations: 3,
        blockNumber: 100,
        blockHash: '0x' + 'b'.repeat(64),
        timestamp: 1700000000,
        txreceipt_status: '1',
        status: '1',
        isError: '0',
        historySource: EVM_TRANSACTION_HISTORY_SOURCE.ExplorerTransaction,
        nonce: 1,
        type: 0,
        gasLimit: '21000',
        gasPrice: '1000000000',
        logs: [],
      };
  mockState = {
    scope: {
      account: `public-copy-account-${sequence}`,
      network: `public-copy-network-${sequence}`,
    },
    vaultGlobal: withEns
      ? vaultGlobalReducer(
          vaultGlobalReducer(
            undefined,
            setEnsName({ address: FROM_EVM, name: FROM_ENS })
          ),
          setEnsName({ address: TO_EVM, name: TO_ENS })
        )
      : { ensCache: {} },
    vault: {
      isBitcoinBased: utxo,
      activeNetwork: {
        chainId,
        kind: utxo ? 'syscoin' : 'ethereum',
        currency: utxo ? 'tsys' : 'eth',
        url: 'https://synthetic.invalid',
      },
      activeAccount: { id: 0, type: 'HDAccount' },
      accounts: {
        HDAccount: {
          0: {
            id: 0,
            address: utxo ? FROM_UTXO : FROM_EVM,
            label: 'Synthetic public account',
            xpub: 'public-xpub',
          },
        },
      },
      accountAssets: {
        HDAccount: {
          0: {
            syscoin: [],
            ethereum: [
              {
                chainId: 1,
                contractAddress: CONTRACT,
                decimals: 6,
                tokenSymbol: 'TST',
                isNft: false,
              },
            ],
          },
        },
      },
      accountTransactions: {
        HDAccount: {
          0: {
            syscoin: { [chainId]: utxo ? [mockTx] : [] },
            ethereum: { [chainId]: utxo ? [] : [mockTx] },
          },
        },
      },
    },
  };
  mockEmitter.mockImplementation(async ([, method]) => {
    if (
      method === 'getSysTransactionFromBlockbook' ||
      method === 'getEvmTransactionFromProvider'
    )
      return mockTx;
    if (method === 'decodeEvmTransactionData')
      return {
        method: 'transfer',
        names: ['to', 'amount'],
        types: ['address', 'uint256'],
        inputs: [TO_EVM, '1000000'],
      };
    throw new Error(`Unexpected public read: ${method}`);
  });
  return { utxo, token, hash };
}

async function createLocale(locale: Locale) {
  const instance = createInstance();
  await instance.use(initReactI18next).init({
    initImmediate: false,
    lng: locale,
    fallbackLng: 'en',
    react: { useSuspense: false },
    resources: Object.fromEntries(
      Object.entries(resources).map(([language, translation]) => [
        language,
        { translation },
      ])
    ),
  });
  expect(instance.resolvedLanguage).toBe(locale);
  return instance;
}

async function mount(kind: string, locale: Locale, withEns = false) {
  const result = configure(kind, withEns);
  const instance = await createLocale(locale);
  render(
    <I18nextProvider i18n={instance}>
      {result.utxo ? (
        <SyscoinTransactionDetails hash={result.hash} tx={mockTx} />
      ) : (
        <EvmTransactionDetailsEnhanced hash={result.hash} tx={mockTx} />
      )}
    </I18nextProvider>
  );
  await waitFor(() => expect(mockEmitter).toHaveBeenCalled());
  await act(async () => undefined);
  return result;
}
const buttonFor = (label: string) =>
  within(screen.getByText(label, { exact: true }).parentElement!).getByRole(
    'button'
  );
const purposes = (locale: Locale, token: boolean, utxo: boolean) => [
  resources[locale].send.transactionId,
  resources[locale].send.from,
  resources[locale].send.to,
  ...(token && utxo ? [resources[locale].send.assetGuid] : []),
];
const copyName = (locale: Locale, label: string) =>
  `${resources[locale].buttons.copy}: ${label}`;
async function tabTo(
  user: ReturnType<typeof userEvent.setup>,
  target: HTMLElement
) {
  for (let i = 0; i < 30 && document.activeElement !== target; i += 1)
    await user.tab();
  expect(target).toHaveFocus();
}
function contextEvidence(button: HTMLElement) {
  const refs = (attribute: string) =>
    (button.getAttribute(attribute) || '')
      .split(/\s+/)
      .filter(Boolean)
      .map((id) => ({
        id,
        text: document.getElementById(id)?.textContent ?? null,
      }));
  const ancestors: any[] = [];
  for (
    let node = button.parentElement;
    node && node !== document.body;
    node = node.parentElement
  )
    ancestors.push({
      tag: node.tagName,
      role: node.getAttribute('role'),
      title: node.getAttribute('title'),
      label: node.getAttribute('aria-label'),
      labelledby: node.getAttribute('aria-labelledby'),
      describedby: node.getAttribute('aria-describedby'),
    });
  return {
    ariaLabel: button.getAttribute('aria-label'),
    title: button.getAttribute('title'),
    labelledby: refs('aria-labelledby'),
    describedby: refs('aria-describedby'),
    ancestors,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockClipboard.mockResolvedValue(undefined);
});
afterEach(cleanup);
afterAll(() => {
  if (originalClipboard)
    Object.defineProperty(navigator, 'clipboard', originalClipboard);
  else delete (navigator as any).clipboard;
});

it.each(scenarios)(
  '$kind healthy exact-copy pointer and keyboard control',
  async ({ kind, locale }) => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: mockClipboard },
    });
    const strings = resources[locale];
    const { utxo, token, hash } = await mount(kind, locale);
    await user.click(buttonFor(strings.send.from));
    const to = buttonFor(strings.send.to);
    await tabTo(user, to);
    await user.keyboard('{Enter}');
    await user.click(buttonFor(strings.send.transactionId));
    const expected = [
      utxo ? FROM_UTXO : FROM_EVM,
      utxo ? TO_UTXO : TO_EVM,
      hash,
    ];
    if (utxo && token) {
      const guid = buttonFor(strings.send.assetGuid);
      await user.click(guid);
      await user.tab();
      await tabTo(user, guid);
      await user.keyboard('{Enter}');
      expected.push(GUID, GUID);
    }
    expect(mockClipboard.mock.calls.map(([value]) => value)).toEqual(expected);
    expect(mockAlert.error).not.toHaveBeenCalled();
  }
);

it.each(scenarios)(
  '$kind copy controls identify the actual field purpose to assistive technology',
  async ({ kind, locale }) => {
    const { token, utxo } = await mount(kind, locale);
    const labels = purposes(locale, token, utxo);
    const evidence = labels.map((label) => ({
      purpose: label,
      ...contextEvidence(buttonFor(label)),
    }));
    console.info(
      'activity_copy_purpose_evidence=' + JSON.stringify({ kind, evidence })
    );
    for (const label of labels) {
      expect(buttonFor(label)).toHaveAccessibleName(copyName(locale, label));
    }
  }
);

it.each(locales)(
  '%s uses localized field purposes in actual EVM short-ENS and UTXO/SPT details without changing exact copy bytes',
  async (locale) => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: mockClipboard },
    });
    const strings = resources[locale];
    const evm = await mount('evm-token', locale, true);
    for (const label of purposes(locale, true, false)) {
      expect(buttonFor(label)).toHaveAccessibleName(copyName(locale, label));
    }
    const fromRow = screen.getByText(strings.send.from, { exact: true })
      .parentElement!;
    const toRow = screen.getByText(strings.send.to, { exact: true })
      .parentElement!;
    expect(FROM_ENS.length).toBeLessThan(20);
    expect(TO_ENS.length).toBeLessThan(20);
    expect(within(fromRow).getByText(FROM_ENS, { exact: true })).toBeVisible();
    expect(within(toRow).getByText(TO_ENS, { exact: true })).toBeVisible();
    expect(within(fromRow).queryByText(FROM_EVM, { exact: true })).toBeNull();
    expect(within(toRow).queryByText(TO_EVM, { exact: true })).toBeNull();
    await user.click(buttonFor(strings.send.from));
    await tabTo(user, buttonFor(strings.send.to));
    await user.keyboard('{Enter}');
    await user.click(buttonFor(strings.send.transactionId));
    expect(mockClipboard.mock.calls.map(([value]) => value)).toEqual([
      FROM_EVM,
      TO_EVM,
      evm.hash,
    ]);
    expect(mockAlert.error).not.toHaveBeenCalled();

    cleanup();
    mockClipboard.mockClear();
    const utxo = await mount('utxo-token', locale);
    for (const label of purposes(locale, true, true)) {
      expect(buttonFor(label)).toHaveAccessibleName(copyName(locale, label));
    }
    await user.click(buttonFor(strings.send.from));
    await tabTo(user, buttonFor(strings.send.to));
    await user.keyboard('{Enter}');
    await user.click(buttonFor(strings.send.transactionId));
    const guid = buttonFor(strings.send.assetGuid);
    await user.click(guid);
    await user.tab();
    await tabTo(user, guid);
    await user.keyboard('{Enter}');
    expect(mockClipboard.mock.calls.map(([value]) => value)).toEqual([
      FROM_UTXO,
      TO_UTXO,
      utxo.hash,
      GUID,
      GUID,
    ]);
    expect(mockAlert.error).not.toHaveBeenCalled();
  }
);

it.each(locales)(
  '%s preserves an unknown provider field label and raw value in the real shared renderer',
  async (locale) => {
    const instance = await createLocale(locale);
    const onCopy = jest.fn();
    const label = 'providerABIField';
    const value = '0x' + 'abcdef'.repeat(16);
    const details = [{ label, value, canCopy: true }];
    const before = JSON.stringify(details);
    const user = userEvent.setup();
    render(
      <I18nextProvider i18n={instance}>
        <TransactionDetailsList details={details} onCopy={onCopy} />
      </I18nextProvider>
    );
    expect(screen.getByText(label, { exact: true })).toBeVisible();
    const button = buttonFor(label);
    expect(button).toHaveAccessibleName(copyName(locale, label));
    await user.click(button);
    await user.tab();
    await tabTo(user, button);
    await user.keyboard('{Enter}');
    expect(onCopy.mock.calls).toEqual([
      [value, label],
      [value, label],
    ]);
    expect(JSON.stringify(details)).toBe(before);
  }
);
