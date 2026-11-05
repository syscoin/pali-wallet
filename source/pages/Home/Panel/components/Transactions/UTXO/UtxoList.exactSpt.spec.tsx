/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import React from 'react';

import { UtxoTransactionsListComponent } from './UtxoList';

const mockNavigate = jest.fn();
const mockEmitter = jest.fn();
const mockTokenIcon = jest.fn();
let mockActiveAssets: { syscoin: any[] };
let mockScope: { account: string; network: string };
let mockUrl: string;
let mockSequence = 0;
jest.mock('react-redux', () => ({
  useSelector: (selector: any) =>
    selector({
      vault: {
        activeNetwork: { currency: 'tsys', chainId: 5700, url: mockUrl },
      },
    }),
}));
jest.mock('utils/navigationState', () => ({
  getWalletNavigationScope: () => mockScope,
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (copyKey: string, copyValues?: any) =>
      jest
        .requireActual('../../../../../../../tests/helpers/localizedUiCopy')
        .localizedUiCopy(copyKey, copyValues) ??
      (
        ((key: string) =>
          key === 'notifications.clickToView' ? 'Details' : key) as any
      )(copyKey, copyValues),
  }),
}));
jest.mock('state/vault/selectors', () => ({
  selectActiveAccountAssets: () => mockActiveAssets,
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
jest.mock('@ant-design/icons', () => ({}));
jest.mock('components/Tooltip', () => ({
  Tooltip: ({ children }: any) => children,
}));
jest.mock('components/TokenIcon', () => ({
  TokenIcon: (props: unknown) => {
    mockTokenIcon(props);
    return null;
  },
}));
jest.mock('utils/index', () => ({
  getTokenLogo: () => undefined,
  ellipsis: (value: string) => value,
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockScope = { account: 'account-a', network: `network-${++mockSequence}` };
  mockUrl = 'https://blockbook.example';
  mockActiveAssets = { syscoin: [] };
});

const rawQuantity = '9007199254740993';
const utilities = jest.requireActual('utils/syscoinTransactionUtils');
const baseTx = () => ({
  txid: 'ab'.repeat(32),
  blockHash: 'cd'.repeat(32),
  blockHeight: 100,
  blockTime: 1700000000,
  confirmations: 1,
  fees: '0',
  hex: '',
  value: '0',
  valueIn: '0',
  version: 2,
  vin: [],
  vout: [],
  tokenType: 'SPTAssetAllocationSend',
});
it.each(['SPTAssetAllocationSend', 'SPTAssetAllocationBurnToNEVM'])(
  'keeps a greater-than-safe-integer compact quantity exact in the real %s Activity row',
  (tokenType) => {
    const tx = {
      ...baseTx(),
      tokenType,
      accountAssetTransfers: [
        {
          assetGuid: '123456',
          value: rawQuantity,
          decimals: 0,
          symbol: 'BIG',
          direction: 'received',
        },
      ],
    };
    expect(utilities.getSyscoinActivityOperationAmount(tx)).toMatchObject({
      amount: rawQuantity,
    });
    render(<UtxoTransactionsListComponent tx={tx as any} />);
    expect(screen.getByText(`${rawQuantity} BIG`)).toBeTruthy();
    expect(screen.queryByText('9007199254740992 BIG')).toBeNull();
    expect(mockEmitter).not.toHaveBeenCalled();
  }
);
it('keeps a one-atom net received between adjacent large owned values', () => {
  const tx = {
    ...baseTx(),
    tokenTransfers: [{ token: '123456', decimals: 0, symbol: 'BIG' }],
    vin: [
      {
        isOwn: true,
        assetInfo: { assetGuid: '123456', value: '9007199254740992' },
      },
    ],
    vout: [
      {
        isOwn: true,
        addresses: ['owned'],
        assetInfo: { assetGuid: '123456', value: rawQuantity },
      },
    ],
  };
  expect(utilities.getSyscoinActivityOperationAmount(tx)).toMatchObject({
    amount: '1',
    direction: 'received',
  });
  render(<UtxoTransactionsListComponent tx={tx as any} />);
  expect(screen.getByText('1 BIG')).toBeTruthy();
  expect(mockEmitter).not.toHaveBeenCalled();
});
