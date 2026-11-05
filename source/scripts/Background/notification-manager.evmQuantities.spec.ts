import store from 'state/store';
import { Interface } from 'utils/ethersV6Compat';
import { showTransactionNotification } from 'utils/notifications';

import { notificationManager } from './notification-manager';

jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: jest.fn() },
}));
jest.mock('utils/notifications', () => ({
  setupNotificationListeners: jest.fn(),
  showTransactionNotification: jest.fn(),
}));

const OWNER = `0x${'11'.repeat(20)}`;
const RECIPIENT = `0x${'22'.repeat(20)}`;
const TOKEN = `0x${'33'.repeat(20)}`;
const iface = new Interface([
  'function safeTransferFrom(address from,address to,uint256 tokenId,uint256 amount,bytes data)',
]);

beforeEach(() => {
  jest.clearAllMocks();
  (store.getState as jest.Mock).mockReturnValue({
    vault: {
      activeNetwork: { chainId: 1, url: 'https://rpc.invalid' },
      activeAccount: { id: 0, type: 'HDAccount' },
      accounts: { HDAccount: { 0: { address: OWNER } } },
      accountAssets: { HDAccount: { 0: { ethereum: [] } } },
    },
  });
});

it.each(['2', '9007199254740993'])(
  'preserves ERC1155 quantity %s in the browser notification payload',
  async (quantity) => {
    notificationManager.notifyTransaction({
      account: { address: OWNER },
      isEvm: true,
      network: { chainId: 1, currency: 'ETH', label: 'Ethereum' } as any,
      transaction: {
        chainId: 1,
        hash: `0x${'aa'.repeat(32)}`,
        from: OWNER,
        to: TOKEN,
        value: '0',
        input: iface.encodeFunctionData('safeTransferFrom', [
          OWNER,
          RECIPIENT,
          '5',
          quantity,
          '0x',
        ]),
      },
      type: 'confirmed',
    });
    await Promise.resolve();
    expect(showTransactionNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        value: quantity,
        tokenSymbol: 'NFT',
        to: RECIPIENT,
        type: 'confirmed',
      })
    );
  }
);

it.each(['SPTAssetAllocationSend', 'SPTAssetAllocationBurnToNEVM'])(
  'preserves an exact large SPT %s quantity in its notification payload',
  (tokenType) => {
    const value = '9007199254740993';
    notificationManager.notifyTransaction({
      account: { address: 'public-syscoin-address' },
      isEvm: false,
      network: { chainId: 57, currency: 'SYS', label: 'Syscoin' } as any,
      transaction: {
        txid: 'ab'.repeat(32),
        tokenType,
        accountAssetTransfers: [
          { assetGuid: '123456', value, decimals: 0, symbol: 'BIG' },
        ],
      },
      type: 'confirmed',
    });
    expect(showTransactionNotification).toHaveBeenCalledWith(
      expect.objectContaining({ value, tokenSymbol: 'BIG' })
    );
  }
);

it.each([Number.MAX_SAFE_INTEGER + 1, '9'.repeat(79)])(
  'does not report native funding as an unavailable SPT quantity %s',
  (value) => {
    notificationManager.notifyTransaction({
      account: { address: 'public-syscoin-address' },
      isEvm: false,
      network: { chainId: 57, currency: 'SYS', label: 'Syscoin' } as any,
      transaction: {
        txid: 'ab'.repeat(32),
        tokenType: 'SPTAssetAllocationSend',
        symbol: 'BIG',
        decimals: 0,
        accountAssetTransfers: [
          { assetGuid: '123456', value, decimals: 0, symbol: 'BIG' },
        ],
        addressValueIn: '100000000',
        addressValueOut: '0',
        value: '100000000',
      },
      type: 'confirmed',
    });
    expect(showTransactionNotification).toHaveBeenCalledWith(
      expect.objectContaining({ value: undefined, tokenSymbol: 'BIG' })
    );
  }
);
it('keeps an ordinary native notification amount', () => {
  notificationManager.notifyTransaction({
    account: { address: 'public-syscoin-address' },
    isEvm: false,
    network: { chainId: 57, currency: 'SYS', label: 'Syscoin' } as any,
    transaction: {
      txid: 'ab'.repeat(32),
      addressValueIn: '100000000',
      addressValueOut: '0',
    },
    type: 'confirmed',
  });
  expect(showTransactionNotification).toHaveBeenCalledWith(
    expect.objectContaining({ value: '1.0000', tokenSymbol: 'SYS' })
  );
});
it('recognizes a metadata-only exact SPT quantity without a tokenType tag', () => {
  notificationManager.notifyTransaction({
    account: { address: 'public-syscoin-address' },
    isEvm: false,
    network: { chainId: 57, currency: 'SYS', label: 'Syscoin' } as any,
    transaction: {
      txid: 'ab'.repeat(32),
      accountAssetTransfers: [
        {
          assetGuid: '123456',
          value: '9007199254740993',
          decimals: 0,
          symbol: 'BIG',
        },
      ],
      addressValueIn: '100000000',
      addressValueOut: '0',
    },
    type: 'confirmed',
  });
  expect(showTransactionNotification).toHaveBeenCalledWith(
    expect.objectContaining({ value: '9007199254740993', tokenSymbol: 'BIG' })
  );
});
it('does not substitute native funding when SPT metadata has no amount', () => {
  notificationManager.notifyTransaction({
    account: { address: 'public-syscoin-address' },
    isEvm: false,
    network: { chainId: 57, currency: 'SYS', label: 'Syscoin' } as any,
    transaction: {
      txid: 'ab'.repeat(32),
      tokenTransfers: [{ token: '123456', decimals: 0, symbol: 'BIG' }],
      symbol: 'BIG',
      decimals: 0,
      addressValueIn: '100000000',
      addressValueOut: '0',
    },
    type: 'confirmed',
  });
  expect(showTransactionNotification).toHaveBeenCalledWith(
    expect.objectContaining({ value: undefined, tokenSymbol: 'BIG' })
  );
});
