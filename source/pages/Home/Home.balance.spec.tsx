import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { Home } from './Home';

let mockState: any;
jest.mock('react-redux', () => ({
  useSelector: (selector: any) => selector(mockState),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('react-router-dom', () => ({ useLocation: () => ({ state: null }) }));
jest.mock('hooks/index', () => ({
  usePrice: () => ({ getFiatAmount: () => '$0.00' }),
  useUtils: () => ({ navigate: jest.fn() }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: jest.fn(), isUnlocked: true }),
}));
jest.mock('state/vault/selectors', () => ({
  selectActiveAccount: (state: any) => state.account,
  selectActiveAccountRef: (state: any) => state.accountRef,
}));
jest.mock('components/Icon/Icon', () => ({
  ArrowUpSvg: () => null,
  ArrowDownLoadSvg: () => null,
}));
jest.mock('components/index', () => ({
  Button: ({ children, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
  FaucetAccessModal: () => null,
  FaucetFirstAccessModal: () => null,
}));
jest.mock(
  'components/Loader/SkeletonLoader',
  () =>
    function SkeletonLoaderMock() {
      return <span data-skeleton="true" />;
    }
);
jest.mock('components/Modal/StatusModal', () => ({ StatusModal: () => null }));
jest.mock('components/Modal/WalletProviderDafault', () => ({
  WalletProviderDefaultModal: () => null,
}));
jest.mock('components/Modal/WarningBaseModal', () => ({
  ConnectHardwareWallet: () => null,
}));
jest.mock('./TxsPanel', () => ({ TxsPanel: () => null }));
jest.mock('utils/index', () => ({
  formatMillionNumber: String,
  formatFullPrecisionBalance: String,
  ONE_MILLION: 1000000,
}));

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: () => 'true' },
  });
  mockState = {
    account: {
      address: '0xunknown-balance-test',
      balances: { ethereum: '-1' },
    },
    accountRef: { type: 'HDAccount', id: 5432 },
    price: { fiat: { asset: 'usd' } },
    vault: {
      activeNetwork: {
        chainId: 1,
        url: 'https://rpc.example',
        currency: 'ETH',
      },
      isBitcoinBased: false,
    },
    vaultGlobal: {},
  };
});

describe('Home unknown balance', () => {
  it('keeps unknown balance explicit, disables Send, and leaves Receive usable', () => {
    const markup = renderToStaticMarkup(<Home />);
    expect(markup).toContain('id="home-balance-pending"');
    expect(markup).not.toContain('id="home-balance"');
    expect(markup).toMatch(/<button[^>]*id="send-btn"[^>]*disabled/);
    const receive = markup.match(/<button[^>]*id="receive-btn"[^>]*>/)?.[0];
    expect(receive).toBeDefined();
    expect(receive).not.toContain('disabled');
  });

  it('renders a known zero as a loaded balance', () => {
    mockState.account.balances.ethereum = '0';
    const markup = renderToStaticMarkup(<Home />);
    expect(markup).toContain('id="home-balance"');
    expect(markup).not.toContain('id="home-balance-pending"');
    const send = markup.match(/<button[^>]*id="send-btn"[^>]*>/)?.[0];
    expect(send).not.toContain('disabled');
  });
});
