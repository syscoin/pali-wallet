/** @jest-environment jsdom */
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import { EvmAssetDetails } from './EvmDetails';

let mockState: any;
const mockEmitter = jest.fn();
const mockAlert = { info: jest.fn(), error: jest.fn() };
jest.mock('react-redux', () => ({
  useSelector: (selector: any) => selector(mockState),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: '/home/details', state: null }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({
    useCopyClipboard: () => [false, jest.fn()],
    alert: mockAlert,
    navigate: jest.fn(),
  }),
  useAdjustedExplorer: () => 'https://synthetic.example/',
}));
jest.mock('components/TokenIcon', () => ({ TokenIcon: () => null }));
jest.mock('components/index', () => ({
  Button: ({ children }: any) => <button>{children}</button>,
  Icon: () => null,
}));
jest.mock('components/Icon/Icon', () => ({
  FiExternalLink: () => null,
  RiFileCopyLine: () => null,
}));
jest.mock('utils/index', () => ({
  ellipsis: (value: string) => value,
  formatCurrency: (value: string) => value,
  formatFullPrecisionBalance: (value: string) => value,
}));
jest.mock('utils/tokens', () => ({ getTokenTypeBadgeColor: () => '' }));
jest.mock('utils/navigationState', () => ({
  createBrowsingNavigationContext: jest.fn(),
  navigateWithContext: jest.fn(),
  navigateBack: jest.fn(),
}));

const tokens = ['11', '22'].map((byte) => ({
  id: `0x${byte.repeat(20)}-57057`,
  contractAddress: `0x${byte.repeat(20)}`,
  chainId: 57057,
  tokenSymbol: `TOKEN${byte}`,
  name: `Token ${byte}`,
  balance: 4,
  decimals: 18,
  tokenStandard: 'ERC-20',
}));
const pending = new Map<string, (value: any) => void>();
const market = (price: number) => ({
  // eslint-disable-next-line camelcase
  market_data: {
    // eslint-disable-next-line camelcase
    current_price: { usd: price },
    // eslint-disable-next-line camelcase
    price_change_percentage_24h: 0,
  },
});
const finish = async (index: number, price: number) => {
  expect(pending.has(tokens[index].contractAddress)).toBe(true);
  await act(async () =>
    pending.get(tokens[index].contractAddress)!(market(price))
  );
};
beforeEach(() => {
  jest.clearAllMocks();
  pending.clear();
  mockState = {
    vault: {
      activeNetwork: { chainId: 57057, explorer: 'https://synthetic.example/' },
      activeAccount: { type: 'HDAccount', id: 0 },
      accounts: { HDAccount: { 0: { address: `0x${'33'.repeat(20)}` } } },
      accountAssets: { HDAccount: { 0: { ethereum: tokens } } },
    },
    price: { fiat: { asset: 'usd' } },
  };
  mockEmitter.mockImplementation(([, method], args) => {
    if (method === 'getOnlyMarketData')
      return new Promise((resolve) => pending.set(args[0], resolve));
    throw new Error(`Unexpected ${method}`);
  });
});

it('loads the next asset after the previous asset already completed its market read', async () => {
  const view = render(<EvmAssetDetails id={tokens[0].id} />);
  await finish(0, 111);
  expect(screen.getByText('$111')).toBeTruthy();
  view.rerender(<EvmAssetDetails id={tokens[1].id} />);
  await finish(1, 222);
  expect(screen.queryByText('$111')).toBeNull();
  expect(screen.getByText('$222')).toBeTruthy();
});

it('does not put an earlier asset market reply on a later asset', async () => {
  const view = render(<EvmAssetDetails id={tokens[0].id} />);
  view.rerender(<EvmAssetDetails id={tokens[1].id} />);
  await finish(1, 222);
  await finish(0, 111);
  expect(screen.queryByText('$111')).toBeNull();
  expect(screen.getByText('$222')).toBeTruthy();
});

it('keeps the price readable when optional 24-hour change data is absent', async () => {
  render(<EvmAssetDetails id={tokens[0].id} />);
  await act(async () =>
    pending.get(tokens[0].contractAddress)!({
      // eslint-disable-next-line camelcase
      market_data: { current_price: { usd: 55 } },
    })
  );
  expect(screen.getByText('$55')).toBeTruthy();
  expect(screen.queryByText(/\(24h\)/)).toBeNull();
});

it('copies the public contract from the keyboard and reports clipboard refusal without success', async () => {
  const user = userEvent.setup();
  const write = jest
    .spyOn(navigator.clipboard, 'writeText')
    .mockRejectedValue(new Error('denied'));
  render(<EvmAssetDetails id={tokens[0].id} />);
  const copy = screen.getByRole('button', { name: 'send.copyContractAddress' });
  copy.focus();
  await user.keyboard('{Enter}');
  expect(write).toHaveBeenCalledWith(tokens[0].contractAddress);
  expect(mockAlert.error).toHaveBeenCalledWith('transactions.copyFailed');
  expect(mockAlert.info).not.toHaveBeenCalled();
  write.mockRestore();
});

it('does not announce a delayed contract copy after navigating to another asset', async () => {
  const user = userEvent.setup();
  let finishCopy!: () => void;
  const write = jest.spyOn(navigator.clipboard, 'writeText').mockImplementation(
    () =>
      new Promise((resolve) => {
        finishCopy = resolve;
      })
  );
  const view = render(<EvmAssetDetails id={tokens[0].id} />);
  await user.click(
    screen.getByRole('button', { name: 'send.copyContractAddress' })
  );
  view.rerender(<EvmAssetDetails id={tokens[1].id} />);
  await act(async () => finishCopy());
  expect(mockAlert.info).not.toHaveBeenCalled();
  expect(mockAlert.error).not.toHaveBeenCalled();
  write.mockRestore();
});
