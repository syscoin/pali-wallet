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
