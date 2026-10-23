/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import {
  act,
  fireEvent,
  render,
  screen,
  cleanup,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import de from 'assets/locales/de.json';
import en from 'assets/locales/en.json';
import es from 'assets/locales/es.json';
import fr from 'assets/locales/fr.json';
import ja from 'assets/locales/ja.json';
import ko from 'assets/locales/ko.json';
import pt from 'assets/locales/pt.json';
import ru from 'assets/locales/ru.json';
import zh from 'assets/locales/zh.json';
import { SendEth } from 'pages/Send/SendEth';
import vaultReducer, {
  createAccount,
  setAccountLabel,
  setAccountTransactions,
  setActiveNetwork,
  setIsBitcoinBased,
} from 'state/vault';
import { TransactionsType } from 'state/vault/types';
import globalReducer, { setEnsName } from 'state/vaultGlobal';
import {
  initialActiveHdAccountState,
  INetworkType,
  KeyringAccountType,
} from 'types/network';
import { EVM_TRANSACTION_HISTORY_SOURCE } from 'utils/evmNonce';
import { ellipsis } from 'utils/format';

// This native regression uses the real SendEth form, Ant Design inputs,
// account reducers, compatibility/recipient selectors and locale resources.
// Only the controller transport, navigation and unrelated chrome are replaced.
// It never opens a browser, creates a secret, signs or broadcasts.
const mockEmitter = jest.fn();
const mockSave = jest.fn();
const mockNavigate = jest.fn();
const mockNavigateWithContext = jest.fn();
const mockStatus = {
  isUnlocked: true,
  isLoading: false,
  connectionUnavailable: false,
};
let mockState: any;
let mockLocale: any = en;
const mockLocation = {
  key: 'recipient',
  pathname: '/send/eth',
  state: undefined,
};
const FIRST = '0x1111111111111111111111111111111111111111';
const SECOND = '0x2222222222222222222222222222222222222222';
const RECENT = '0x3333333333333333333333333333333333333333';
const locales = [
  ['en', en],
  ['de', de],
  ['es', es],
  ['fr', fr],
  ['ja', ja],
  ['ko', ko],
  ['pt', pt],
  ['ru', ru],
  ['zh', zh],
] as const;
const originalResizeObserver = globalThis.ResizeObserver;
const originalMessageChannel = globalThis.MessageChannel;
const originalMatchMedia = window.matchMedia;

jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockState },
}));
jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('react-router-dom', () => ({ useLocation: () => mockLocation }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      key.split('.').reduce((value: any, part) => value?.[part], mockLocale) ??
      key,
  }),
}));
jest.mock('hooks/controllerStatus', () => ({
  getControllerStatus: () => mockStatus,
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ ...mockStatus, controllerEmitter: mockEmitter }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({
    navigate: mockNavigate,
    alert: { error: jest.fn(), info: jest.fn() },
  }),
}));
jest.mock('hooks/useAdjustedExplorer', () => ({
  useAdjustedExplorer: () => 'https://explorer.invalid',
}));
jest.mock('utils/navigationState', () => ({
  ...jest.requireActual('utils/navigationState'),
  saveNavigationState: (...args: any[]) => mockSave(...args),
}));
jest.mock('utils/index', () => ({
  getWalletNavigationScope: (...args: any[]) =>
    jest
      .requireActual('utils/navigationState')
      .getWalletNavigationScope(...args),
  getAssetBalance: () => '0',
  ellipsis: (...args: any[]) =>
    jest.requireActual('utils/format').ellipsis(...args),
  adjustUrl: (value: string) => value,
  formatFullPrecisionBalance: (value: any) => String(value),
  createNavigationContext: jest.fn(),
  navigateWithContext: (...args: any[]) => mockNavigateWithContext(...args),
  getTokenTypeBadgeColor: () => '',
  truncateToDecimals: (value: string) => value,
}));
jest.mock('components/Icon/Icon', () => ({
  PaliWhiteSmallIconSvg: () => null,
  ArrowDownSvg: () => null,
  LoadingSvg: () => null,
}));
jest.mock('components/index', () => ({
  Button: ({ children, variant, fullWidth, loading, icon, ...props }: any) => {
    void variant;
    void fullWidth;
    return (
      <button {...props} disabled={props.disabled || loading}>
        {children}
        {icon}
      </button>
    );
  },
  Tooltip: ({ children }: any) => <>{children}</>,
  Icon: () => null,
}));
jest.mock('components/ToastActionFooter', () => ({
  ToastActionFooter: ({ children }: any) => <footer>{children}</footer>,
}));
jest.mock('@headlessui/react', () => {
  const Pass = ({ children }: any) => (
    <>{typeof children === 'function' ? children({ open: false }) : children}</>
  );
  return {
    Menu: Object.assign(Pass, { Button: Pass, Items: Pass, Item: Pass }),
  };
});

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {
      return undefined;
    }
    unobserve() {
      return undefined;
    }
    disconnect() {
      return undefined;
    }
  } as typeof ResizeObserver;
  globalThis.MessageChannel = class {
    port1 = { onmessage: undefined as (() => void) | undefined };
    port2 = {
      postMessage: () => queueMicrotask(() => this.port1.onmessage?.()),
    };
  } as unknown as typeof MessageChannel;
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
afterEach(cleanup);

beforeEach(() => {
  jest.clearAllMocks();
  mockLocale = en;
  window.history.replaceState(null, '', '/app.html');
  const network = {
    kind: INetworkType.Ethereum,
    chainId: 1,
    slip44: 60,
    url: 'https://rpc.invalid',
    currency: 'eth',
    label: 'Ethereum',
    explorer: 'https://explorer.invalid',
  };
  let vault = vaultReducer(undefined, { type: 'test/init' });
  vault = vaultReducer(vault, setActiveNetwork(network));
  vault = vaultReducer(vault, setIsBitcoinBased(false));
  for (const [id, address, label] of [
    [0, FIRST, 'Daily recipient'],
    [1, SECOND, 'Savings recipient'],
  ] as const) {
    vault = vaultReducer(
      vault,
      createAccount({
        account: {
          ...initialActiveHdAccountState,
          id,
          address,
          label,
          xpub: `public-${id}`,
        },
        accountType: KeyringAccountType.HDAccount,
      })
    );
  }
  mockState = {
    vault,
    vaultGlobal: { activeSlip44: 60, isBitcoinBased: false, ensCache: {} },
  };
  mockEmitter.mockImplementation(async (path) =>
    path[1] === 'getFeeDataWithDynamicMaxPriorityFeePerGas'
      ? { maxFeePerGas: '1000000000', maxPriorityFeePerGas: '100000000' }
      : undefined
  );
  mockSave.mockResolvedValue(undefined);
});

const receiver = () =>
  screen.getByPlaceholderText(mockLocale.send.receiver) as HTMLInputElement;
const rows = () =>
  Array.from(
    document.querySelectorAll<HTMLButtonElement>('.sender-custom-input button')
  );
const open = async (count = 2) => {
  render(<SendEth />);
  await act(async () => {
    fireEvent.focus(receiver());
  });
  await waitFor(() => expect(rows()).toHaveLength(count));
};
const nameBothTheSame = () => {
  for (const accountId of [0, 1]) {
    mockState = {
      ...mockState,
      vault: vaultReducer(
        mockState.vault,
        setAccountLabel({
          accountId,
          accountType: KeyringAccountType.HDAccount,
          label: 'Shared recipient',
        })
      ),
    };
  }
};
const rowEvidence = () =>
  rows().map((row) => ({
    text: row.textContent,
    title: row.getAttribute('title'),
    ariaLabel: row.getAttribute('aria-label'),
    ariaDescription: row.getAttribute('aria-description'),
    describedBy: row.getAttribute('aria-describedby'),
  }));
const addRecent = () => {
  mockState = {
    ...mockState,
    vault: vaultReducer(
      mockState.vault,
      setAccountTransactions({
        accountId: 0,
        accountType: KeyringAccountType.HDAccount,
        chainId: 1,
        networkType: TransactionsType.Ethereum,
        transactions: [
          {
            hash: `0x${'aa'.repeat(32)}`,
            from: FIRST,
            to: RECENT,
            input: '0x',
            historySource: EVM_TRANSACTION_HISTORY_SOURCE.ExplorerTransaction,
            txreceipt_status: '1',
            blockNumber: 1,
            confirmations: 1,
          } as any,
        ],
      })
    ),
  };
};
const expectDestinationIdentity = (
  row: HTMLButtonElement,
  label: string,
  address: string,
  source: string
) => {
  expect(row).toHaveAttribute('title', address);
  expect(row).toHaveAccessibleName(`${label}, ${address}, ${source}`);
  expect(
    screen.getByRole('button', {
      name: `${label}, ${address}, ${source}`,
    })
  ).toBe(row);
};

it('healthy control: distinct labels identify choices and Enter writes the exact chosen address', async () => {
  await open();
  expect(rows()[0]).toHaveAccessibleName(/Daily recipient/);
  expect(rows()[1]).toHaveAccessibleName(/Savings recipient/);
  expectDestinationIdentity(
    rows()[0],
    'Daily recipient',
    FIRST,
    en.transactions.account
  );
  expectDestinationIdentity(
    rows()[1],
    'Savings recipient',
    SECOND,
    en.transactions.account
  );
  rows()[1].focus();
  await userEvent.keyboard('{Enter}');
  expect(receiver()).toHaveValue(SECOND);
  expect(rows()).toHaveLength(0);
  expect(mockNavigateWithContext).not.toHaveBeenCalled();
});

it('behavior control: duplicate labels select two different exact addresses without submission', async () => {
  nameBothTheSame();
  await open();
  rows()[0].focus();
  await userEvent.keyboard(' ');
  expect(receiver()).toHaveValue(FIRST);
  fireEvent.change(receiver(), { target: { value: '' } });
  fireEvent.focus(receiver());
  await waitFor(() => expect(rows()).toHaveLength(2));
  rows()[1].focus();
  await userEvent.keyboard('{Enter}');
  expect(receiver()).toHaveValue(SECOND);
  expect(mockNavigateWithContext).not.toHaveBeenCalled();
});

it('regression: duplicate editable labels must retain distinct recipient identity before activation', async () => {
  nameBothTheSame();
  await open();
  const evidence = rowEvidence();
  console.info('recipient_identity_evidence=' + JSON.stringify(evidence));
  for (const [index, address] of [FIRST, SECOND].entries()) {
    expectDestinationIdentity(
      rows()[index],
      'Shared recipient',
      address,
      en.transactions.account
    );
    expect(rows()[index]).toHaveTextContent(ellipsis(address, 8, 6));
  }
});

it.each(locales)(
  'regression: %s account suggestion badge uses the current locale',
  async (_language, resource) => {
    mockLocale = resource;
    await open();
    expect(receiver()).toHaveAttribute('placeholder', resource.send.receiver);
    const badge = rows()[0].querySelector(':scope > span:last-child');
    console.info(
      'recipient_locale_evidence=' +
        JSON.stringify({
          language: _language,
          receiver: resource.send.receiver,
          expectedAccount: resource.transactions.account,
          badge: badge?.textContent,
          ariaLabel: rows()[0].getAttribute('aria-label'),
        })
    );
    expect(badge).toHaveTextContent(resource.transactions.account);
    for (const [index, address] of [FIRST, SECOND].entries()) {
      expectDestinationIdentity(
        rows()[index],
        index === 0 ? 'Daily recipient' : 'Savings recipient',
        address,
        resource.transactions.account
      );
      expect(rows()[index]).toHaveTextContent(ellipsis(address, 8, 6));
    }
  }
);

it.each(locales)(
  '%s confirmed outgoing recent-recipient choice retains full identity and localized source',
  async (_language, resource) => {
    mockLocale = resource;
    addRecent();
    await open(3);
    const recent = rows()[2];
    const recentLabel = (
      resource.send as typeof resource.send & { recentRecipient: string }
    ).recentRecipient;
    expect(typeof recentLabel).toBe('string');
    expectDestinationIdentity(recent, RECENT, RECENT, recentLabel);
    expect(recent.querySelector(':scope > span:last-child')).toHaveTextContent(
      recentLabel
    );
    // With no distinct display label, the full address is shown only once.
    expect(recent.textContent?.split(RECENT).length).toBe(2);
    recent.focus();
    await userEvent.keyboard('{Enter}');
    expect(receiver()).toHaveValue(RECENT);
    expect(mockNavigateWithContext).not.toHaveBeenCalled();
  }
);

it('named recent recipient shows both the ENS display name and shortened concrete destination', async () => {
  addRecent();
  mockState = {
    ...mockState,
    vaultGlobal: globalReducer(
      mockState.vaultGlobal,
      setEnsName({ address: RECENT, name: 'friend.eth' })
    ),
  };
  await open(3);
  const recent = rows()[2];
  expectDestinationIdentity(
    recent,
    'friend.eth',
    RECENT,
    (en.send as any).recentRecipient
  );
  expect(recent).toHaveTextContent(ellipsis(RECENT, 8, 6));
  recent.focus();
  await userEvent.keyboard(' ');
  expect(receiver()).toHaveValue(RECENT);
  expect(mockNavigateWithContext).not.toHaveBeenCalled();
});

it.each(locales)(
  '%s ENS choice preserves the typed name and ENS acronym',
  async (_language, resource) => {
    mockLocale = resource;
    mockEmitter.mockImplementation(async (path) => {
      if (path[1] === 'resolveEns') return RECENT;
      if (path[1] === 'getFeeDataWithDynamicMaxPriorityFeePerGas')
        return {
          maxFeePerGas: '1000000000',
          maxPriorityFeePerGas: '100000000',
        };
      return undefined;
    });
    await open();
    fireEvent.change(receiver(), { target: { value: 'destination.eth' } });
    await waitFor(() => expect(rows()).toHaveLength(1));
    const ens = rows()[0];
    expectDestinationIdentity(
      ens,
      'destination.eth (ENS)',
      'destination.eth',
      'ENS'
    );
    expect(ens.querySelector(':scope > span:last-child')).toHaveTextContent(
      /^ENS$/
    );
    // ENS input remains a name so later Next revalidates its intent.
    ens.focus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() =>
      expect(mockEmitter).toHaveBeenCalledWith(
        ['wallet', 'resolveEns'],
        ['destination.eth']
      )
    );
    expect(receiver()).toHaveValue('destination.eth');
    expect(mockNavigateWithContext).not.toHaveBeenCalled();
  }
);
