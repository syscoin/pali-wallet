/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions":["node","node-addons"]}
 */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { smartAccountAddressFixture } from 'tests/fixtures/smartAccountAddress';

import { dispatchBackgroundEvent } from 'utils/browser';

import { ChangeConnectedAccount } from './ChangeConnectedAccount';

const mockEmitter = jest.fn();
const mockCopy = jest.fn();
let mockState: any;

jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockState },
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('hooks/index', () => ({
  useQueryData: jest.requireActual('hooks/useQuery').useQueryData,
  useUtils: () => ({
    alert: { info: jest.fn(), error: jest.fn() },
    useCopyClipboard: () => [false, mockCopy],
  }),
}));
jest.mock('state/vault/selectors', () => ({
  selectActiveAccountRef: (state: any) => state.vault.activeAccount,
  selectActiveAccount: (state: any) => state.vault.accounts.HDAccount[1],
  selectAccountAssets: () => ({}),
}));
jest.mock('components/AccountBalance', () => ({
  LazyAccountBalance: () => <span>Balance</span>,
}));
jest.mock('components/AccountIdenticon', () => ({
  AccountIdenticon: () => <span>Icon</span>,
}));
jest.mock('components/TokenIcon', () => ({
  getAccountReviewTokens: () => [],
  TokenIconStack: () => null,
}));
jest.mock('components/index', () => ({
  Button: ({ children, disabled, onClick, type }: any) => (
    <button disabled={disabled} onClick={onClick} type={type}>
      {children}
    </button>
  ),
  PageActionFooter: ({ children, error }: any) => (
    <div>
      {error && <div role="alert">{error}</div>}
      {children}
    </div>
  ),
  Icon: () => <span />,
  Tooltip: ({ children }: any) => <>{children}</>,
}));
jest.mock('utils/browser', () => ({ dispatchBackgroundEvent: jest.fn() }));
jest.mock('utils/index', () => ({ ellipsis: (value: string) => value }));

const account = {
  ...smartAccountAddressFixture().account,
  id: 0,
  label: 'Required smart account',
  isSmartAccount: true,
};
const query = {
  host: 'https://fixture.invalid',
  eventName: 'changeActiveConnected',
  accountType: 'SmartAccount',
  // This is the exact public shape sent by promptAccountSwitch. It intentionally
  // contains no descriptor, smartAccount metadata, xpub or private data.
  connectedAccount: {
    id: account.id,
    address: account.address,
    label: account.label,
  },
};
const mount = () =>
  render(
    <MemoryRouter
      initialEntries={[
        '/external/change-active-connected-account?data=' +
          encodeURIComponent(JSON.stringify(query)),
      ]}
    >
      <ChangeConnectedAccount />
    </MemoryRouter>
  );
const switchButton = () =>
  screen.getByRole('button', { name: 'connections.switchAccount' });

beforeEach(() => {
  jest.clearAllMocks();
  mockEmitter.mockResolvedValue(undefined);
  jest.spyOn(window, 'close').mockImplementation(() => undefined);
  mockState = {
    vault: {
      activeAccount: { id: 1, type: 'HDAccount' },
      activeNetwork: { kind: 'ethereum', chainId: 1 },
      isBitcoinBased: false,
      accounts: {
        HDAccount: {
          1: {
            id: 1,
            address: `0x${'1'.repeat(40)}`,
            label: 'Current account',
          },
        },
        SmartAccount: { 0: account },
      },
    },
  };
});
afterEach(() => jest.restoreAllMocks());

it('displays and switches to the verified full vault record for a minimal smart-account query', async () => {
  mount();
  expect(screen.getByText(account.address)).toBeVisible();
  expect(switchButton()).toBeEnabled();
  expect(screen.getAllByText('Balance')).toHaveLength(2);
  fireEvent.click(switchButton());
  await waitFor(() =>
    expect(mockEmitter).toHaveBeenCalledWith(
      ['wallet', 'setAccount'],
      [account.id, 'SmartAccount', true, account.address]
    )
  );
  await waitFor(() =>
    expect(dispatchBackgroundEvent).toHaveBeenCalledWith(
      'changeActiveConnected.https://fixture.invalid',
      null
    )
  );
  expect(window.close).toHaveBeenCalled();
});

it.each(['missing', 'changed', 'wrong-chain', 'wrong-kind'])(
  'does not display or switch a %s smart-account record',
  (condition) => {
    if (condition === 'missing')
      delete mockState.vault.accounts.SmartAccount[0];
    if (condition === 'changed')
      mockState.vault.accounts.SmartAccount[0] = {
        ...account,
        address: `0x${'2'.repeat(40)}`,
      };
    if (condition === 'wrong-chain')
      mockState.vault.activeNetwork.chainId = 5700;
    if (condition === 'wrong-kind')
      mockState.vault.activeNetwork.kind = 'syscoin';
    mount();
    expect(screen.queryByText(account.address)).toBeNull();
    expect(screen.getByText('receive.addressUnavailable')).toBeVisible();
    expect(switchButton()).toBeDisabled();
    expect(screen.getAllByText('Balance')).toHaveLength(1);
    expect(mockEmitter).not.toHaveBeenCalled();
  }
);

it.each(['address', 'missing', 'wrong-chain', 'wrong-kind', 'descriptor'])(
  'revalidates the full record after a late %s change',
  (condition) => {
    mount();
    expect(switchButton()).toBeEnabled();
    if (condition === 'address')
      mockState.vault.accounts.SmartAccount[0] = {
        ...account,
        address: `0x${'2'.repeat(40)}`,
      };
    if (condition === 'missing')
      delete mockState.vault.accounts.SmartAccount[0];
    if (condition === 'wrong-chain')
      mockState.vault.activeNetwork.chainId = 5700;
    if (condition === 'wrong-kind')
      mockState.vault.activeNetwork.kind = 'syscoin';
    if (condition === 'descriptor')
      mockState.vault.accounts.SmartAccount[0] = {
        ...account,
        smartAccount: { ...account.smartAccount, descriptor: undefined },
      };
    fireEvent.click(switchButton());
    expect(screen.getByRole('alert')).toHaveTextContent(
      'receive.addressUnavailable'
    );
    expect(mockEmitter).not.toHaveBeenCalled();
    expect(dispatchBackgroundEvent).not.toHaveBeenCalled();
    expect(window.close).not.toHaveBeenCalled();
  }
);
