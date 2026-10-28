/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createInstance } from 'i18next';
import React from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import de from 'assets/locales/de.json';
import en from 'assets/locales/en.json';
import fr from 'assets/locales/fr.json';

import { SendConfirm } from './Confirm';

const FROM = '0x1111111111111111111111111111111111111111';
const TO = '0x2222222222222222222222222222222222222222';
const CONTRACT = '0x3333333333333333333333333333333333333333';
const GUID = '123456789';
const resources = { en, de, fr };
const mockEmitter = jest.fn();
const mockNavigate = jest.fn();
const mockAlert = { error: jest.fn(), success: jest.fn(), info: jest.fn() };
const mockAuth = {
  isUnlocked: true,
  isLoading: false,
  connectionUnavailable: false,
};
const mockScope = { account: 'public-copy-account', network: 'copy-network' };
let mockLocation: any;
let mockState: any;
let entry = 0;

jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('react-router-dom', () => ({ useLocation: () => mockLocation }));
jest.mock('hooks/useSafeNavigate', () => ({
  useSafeNavigate: () => mockNavigate,
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({
    ...jest.requireActual('hooks/useUtils').useUtils(),
    alert: mockAlert,
    navigate: mockNavigate,
  }),
  usePrice: () => ({ getFiatAmount: () => null }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter, ...mockAuth }),
}));
jest.mock('hooks/controllerStatus', () => ({
  getControllerStatus: () => mockAuth,
}));
jest.mock('hooks/useEIP1559', () => ({
  useEIP1559: () => ({ isEIP1559Compatible: true, forceRecheck: jest.fn() }),
}));
jest.mock('state/vault/selectors', () => ({
  selectEnsNameToAddress: () => ({}),
  selectValidEnsCache: () => ({}),
}));
// Jest needs the package's actual CJS colors, not its ESM-only entry. Keep
// production Icon (including its SVG-image alt), native buttons and Tooltip.
jest.mock('@ant-design/colors', () =>
  jest.requireActual('@ant-design/colors/lib')
);
jest.mock('@ant-design/colors/es/generate', () =>
  jest.requireActual('@ant-design/colors/lib/generate')
);
jest.mock('components/index', () => ({
  Button: jest.requireActual('components/Button/Button').Button,
  Icon: jest.requireActual('components/Icon/Icon').Icon,
  IconButton: jest.requireActual('components/IconButton/IconButton').IconButton,
  Tooltip: jest.requireActual('components/Tooltip/Tooltip').Tooltip,
  DeviceWaitingBanner: () => null,
}));
jest.mock('components/Loading', () => ({ PqSigningOverlay: () => null }));
// These non-copy review surfaces are outside this presentation regression.
jest.mock('components/TransactionDetails', () => ({
  SyscoinTransactionDetailsFromPSBT: () => null,
}));
jest.mock('./EditPriority', () => ({ EditPriorityModal: () => null }));
jest.mock('utils/index', () => ({
  ...jest.requireActual('utils/format'),
  ...jest.requireActual('utils/removeScientificNotation'),
  logError: jest.fn(),
  omitTransactionObjectData: (value: any) => value,
  INITIAL_FEE: {
    baseFee: 0,
    gasPrice: 0,
    maxFeePerGas: 0,
    maxPriorityFeePerGas: 0,
  },
  SYSCOIN_PSBT_VERIFICATION_TIMEOUT_MS: 60000,
}));
jest.mock('utils/navigationState', () => ({
  clearTransactionNavigationState: jest.fn(),
  getTransactionReturnContext: () => mockLocation.state.returnContext,
  getWalletNavigationScope: () => mockScope,
  navigateBack: jest.fn(),
}));
jest.mock('utils/errorHandling', () => ({
  handleTransactionError: () => false,
}));
jest.mock('utils/smartAccount', () => ({
  getSmartAccountLocalOwnerContexts: () => [],
  prepareSmartAccountFeeQuote: jest.fn(),
  signAndSubmitSmartAccountExecutions: jest.fn(),
}));
jest.mock('utils/validations', () => ({
  getErc20Abi: jest.fn(),
  getErc721Abi: jest.fn(),
  getErc1155Abi: jest.fn(),
}));

const originalResizeObserver = globalThis.ResizeObserver;
const originalMessageChannel = globalThis.MessageChannel;
const originalMatchMedia = window.matchMedia;
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {
      // JSDOM has no layout.
    }
    unobserve() {
      // JSDOM has no layout.
    }
    disconnect() {
      // JSDOM has no layout.
    }
  } as typeof ResizeObserver;
  (globalThis as any).MessageChannel = class {
    port1 = { onmessage: undefined as (() => void) | undefined };
    port2 = {
      postMessage: () => queueMicrotask(() => this.port1.onmessage?.()),
    };
  };
  window.matchMedia = jest.fn().mockImplementation(() => ({
    matches: false,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  }));
});
afterAll(() => {
  globalThis.ResizeObserver = originalResizeObserver;
  globalThis.MessageChannel = originalMessageChannel;
  window.matchMedia = originalMatchMedia;
});
beforeEach(() => {
  jest.clearAllMocks();
  window.history.replaceState(null, '', '/');
  mockEmitter.mockImplementation(async (path: string[]) => {
    const method = path.at(-1);
    if (method === 'getFeeDataWithDynamicMaxPriorityFeePerGas')
      return { maxFeePerGas: '3000000000', maxPriorityFeePerGas: '0' };
    if (method === 'getTxGasLimit') return 21000;
    throw new Error(`Unexpected controller call: ${path.join('.')}`);
  });
});
afterEach(() => {
  cleanup();
  // No signing, broadcast, persistence, balance mutation or navigation.
  expect(
    mockEmitter.mock.calls.every(([path]) =>
      ['getFeeDataWithDynamicMaxPriorityFeePerGas', 'getTxGasLimit'].includes(
        path.at(-1)
      )
    )
  ).toBe(true);
  expect(mockNavigate).not.toHaveBeenCalled();
  expect(mockAlert.error).not.toHaveBeenCalled();
});

type Review = 'native' | 'erc20' | 'spt' | 'nft';
async function prepare(
  locale: keyof typeof resources,
  review: Review,
  nftTokenId = '42',
  nftStandard: 'ERC-721' | 'ERC-1155' = 'ERC-1155'
) {
  const isSyscoin = review === 'spt';
  const sender = isSyscoin ? 'tsys1qpublicsenderfixture' : FROM;
  const recipient = isSyscoin ? 'tsys1qpublicrecipientfixture' : TO;
  const token =
    review === 'native'
      ? undefined
      : {
          name: 'Synthetic public asset',
          symbol: 'QA',
          contractAddress: CONTRACT,
          guid: GUID,
          assetGuid: GUID,
          decimals: review === 'nft' ? 0 : 6,
          isNft: review === 'nft',
          tokenStandard: review === 'nft' ? nftStandard : 'ERC-20',
          tokenId: nftTokenId,
        };
  mockState = {
    vault: {
      activeNetwork: {
        kind: isSyscoin ? 'syscoin' : 'ethereum',
        chainId: 5700,
        currency: 'TSYS',
        label: 'Synthetic public test network',
        url: 'https://public-copy.invalid',
      },
      isBitcoinBased: isSyscoin,
      activeAccount: { type: 'HDAccount', id: 0 },
      accounts: {
        HDAccount: {
          0: {
            id: 0,
            address: sender,
            balances: { ethereum: '100', syscoin: '100' },
          },
        },
      },
      accountTransactions: {},
    },
    price: { fiat: { asset: 'USD' } },
  };
  mockLocation = {
    key: `copy-review-${++entry}`,
    pathname: '/send/confirm',
    state: {
      submissionStarted: false,
      walletScope: mockScope,
      tx: {
        sender,
        receivingAddress: recipient,
        amount: '1',
        transactionType: {
          native: 'NATIVE_ETH',
          erc20: 'ERC20',
          spt: 'UTXO',
          nft: nftStandard === 'ERC-721' ? 'ERC721' : 'ERC1155',
        }[review],
        defaultGasLimit: review === 'native' ? 21000 : 100000,
        ...(isSyscoin ? { fee: 0.00000344, psbt: 'synthetic-unsigned' } : {}),
        ...(token ? { token } : {}),
      },
      returnContext: { returnRoute: '/send/eth', walletScope: mockScope },
    },
  };
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
  const user = userEvent.setup();
  const writeText = jest
    .spyOn(navigator.clipboard, 'writeText')
    .mockResolvedValue(undefined);
  render(
    <I18nextProvider i18n={instance}>
      <SendConfirm />
    </I18nextProvider>
  );
  return {
    instance,
    user,
    writeText,
    targets: [
      ...(review === 'native' ? [] : [isSyscoin ? GUID : CONTRACT]),
      sender,
      recipient,
    ],
  };
}

describe.each(['en', 'de', 'fr'] as const)(
  'Confirm public copy actions in %s',
  (locale) => {
    it.each(['native', 'erc20', 'spt', 'nft'] as const)(
      'names actual %s buttons with localized Copy while preserving exact public clipboard bytes',
      async (review) => {
        const { instance, user, writeText, targets } = await prepare(
          locale,
          review
        );
        const before = JSON.stringify({
          tx: mockLocation.state.tx,
          account: mockState.vault.activeAccount,
          network: mockState.vault.activeNetwork,
        });
        // Adjacent labels prove this is the selected real locale, not fallback.
        expect(screen.getByText(resources[locale].send.from)).toBeVisible();
        expect(screen.getByText(resources[locale].send.to)).toBeVisible();
        const icons = screen.getAllByRole('img', { name: 'Copy' });
        expect(icons).toHaveLength(targets.length);
        const buttons = icons.map((icon) => icon.closest('button')!);
        for (const [index, button] of buttons.entries()) {
          expect(button).toBeInstanceOf(HTMLButtonElement);
          expect(button).toBeEnabled();
          button.focus();
          expect(button).toHaveFocus();
          if (index === buttons.length - 1) await user.keyboard('{Enter}');
          else await user.click(button);
        }
        // Healthy behavior is checked independently before the name assertion.
        expect(writeText.mock.calls).toEqual(targets.map((value) => [value]));
        expect(
          JSON.stringify({
            tx: mockLocation.state.tx,
            account: mockState.vault.activeAccount,
            network: mockState.vault.activeNetwork,
          })
        ).toBe(before);
        expect(instance.language).toBe(locale);
        for (const button of buttons)
          expect(button).toHaveAccessibleName(resources[locale].buttons.copy);
      }
    );
  }
);

it.each(['ERC-721', 'ERC-1155'] as const)(
  'reveals the complete long %s token ID through keyboard focus',
  async (standard) => {
    const tokenId =
      '115792089237316195423570985008687907853269984665640564039457584007913129639935';
    const { user } = await prepare('en', 'nft', tokenId, standard);
    const reference = screen.getByText(
      `#${tokenId.slice(0, 8)}...${tokenId.slice(-8)}`
    );

    for (
      let step = 0;
      step < 20 && document.activeElement !== reference;
      step++
    )
      await user.tab();

    expect(reference).toHaveFocus();
    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip).toHaveTextContent(tokenId);
    expect(reference).toHaveAccessibleDescription(tokenId);
  }
);

it.each(['ERC-721', 'ERC-1155'] as const)(
  'allows the complete 20-digit %s token ID to wrap without a tooltip tab stop',
  async (standard) => {
    const tokenId = '12345678901234567890';
    const { user } = await prepare('en', 'nft', tokenId, standard);
    const reference = screen.getByText(`#${tokenId}`);
    expect(reference).toHaveTextContent(`#${tokenId}`);
    expect(reference).toHaveClass('break-all');
    expect(reference).not.toHaveAttribute('tabindex');
    for (let step = 0; step < 20; step++) {
      await user.tab();
      expect(reference).not.toHaveFocus();
    }
  }
);
