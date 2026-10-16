/** @jest-environment jsdom */
import { fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';

import {
  compactBridgeNativeOffset,
  compactBridgeWithAccountAsset,
} from './history.fixtures';
import { UtxoTransactionsListComponent } from './UtxoList';

const mockNavigate = jest.fn();
const mockEmitter = jest.fn();
jest.mock('react-redux', () => ({
  useSelector: (selector: any) =>
    selector({ vault: { activeNetwork: { currency: 'tsys', chainId: 5700 } } }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('state/vault/selectors', () => ({
  selectActiveAccountAssets: () => ({ syscoin: [] }),
}));
jest.mock('hooks/useUtils', () => ({
  useUtils: () => ({
    navigate: mockNavigate,
    useCopyClipboard: () => [false, jest.fn()],
    alert: { success: jest.fn() },
  }),
}));
jest.mock('../utils/useTransactionsInfos', () => ({
  useTransactionsListConfig: () => ({
    getTxStatus: () => null,
    formatTimeStampUtxo: () => null,
    blocktime: 'blockTime',
  }),
}));
jest.mock('../../../../useHomeBrowsingState', () => ({}));
jest.mock('../useHistoryBrowsingState', () => ({}));
jest.mock('scripts/Background/controllers/controllerEmitter', () => ({
  controllerEmitter: (...args: any[]) => mockEmitter(...args),
}));
jest.mock('components/Icon', () => ({ Icon: () => null }));
jest.mock('components/Icon/Icon', () => ({
  DetailArrowSvg: ({ onClick }: any) => (
    <button onClick={onClick}>Details</button>
  ),
}));
jest.mock('components/Tooltip', () => ({
  Tooltip: ({ children }: any) => children,
}));
jest.mock('components/TokenIcon', () => ({ TokenIcon: () => null }));
jest.mock('utils/index', () => ({
  getTokenLogo: () => undefined,
  ellipsis: (value: string) => value,
}));

beforeEach(() => jest.clearAllMocks());

it('labels a compact bridge without inventing an account asset movement', () => {
  render(<UtxoTransactionsListComponent tx={compactBridgeNativeOffset} />);

  expect(screen.getByText('Bridge to NEVM')).toBeTruthy();
  const amount = screen.getByText('29.5985 TSYS');
  expect(within(amount.parentElement!).getByText('-')).toBeTruthy();
  expect(screen.queryByText(/SYSX/)).toBeNull();
  expect(mockEmitter).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Details' }));
  expect(mockNavigate).toHaveBeenCalledWith('/home/details', {
    state: {
      id: null,
      hash: compactBridgeNativeOffset.txid,
      tx: compactBridgeNativeOffset,
    },
  });
});

it('keeps the compact bridge account asset amount and precision', () => {
  render(<UtxoTransactionsListComponent tx={compactBridgeWithAccountAsset} />);

  expect(screen.getByText('Bridge to NEVM')).toBeTruthy();
  const amount = screen.getByText('0.100000 SYSX');
  expect(within(amount.parentElement!).getByText('-')).toBeTruthy();
  expect(screen.queryByText(/TSYS/)).toBeNull();
  expect(mockEmitter).not.toHaveBeenCalled();
});

it('keeps a zero account delta instead of displaying an unrelated output', () => {
  render(
    <UtxoTransactionsListComponent
      tx={{
        ...compactBridgeNativeOffset,
        addressValueIn: '100000000',
        addressValueOut: '100000000',
        tokenType: undefined,
        vout: [{ value: '900000000', isOwn: true }] as any,
      }}
    />
  );
  expect(screen.getByText('0.0000 TSYS')).toBeTruthy();
  expect(screen.queryByText('9.0000 TSYS')).toBeNull();
  expect(screen.queryByText('Bridge to NEVM')).toBeNull();
});
