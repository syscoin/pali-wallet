jest.mock('utils/notifications', () => ({
  setupNotificationListeners: jest.fn(),
  showActivityNotification: jest.fn().mockResolvedValue('activity'),
  showTransactionNotification: jest.fn().mockResolvedValue('transaction'),
}));

import {
  showActivityNotification,
  showTransactionNotification,
} from 'utils/notifications';

import { notificationManager } from './notification-manager';

const address = `0x${'11'.repeat(20)}`;
const network = {
  chainId: 57,
  url: 'https://blockbook.example',
  currency: 'SYS',
  label: 'Syscoin',
} as any;
const transaction = { txid: 'ab'.repeat(32), value: '1000' };
const fact = {
  key: 'scope:hash:transaction-pending',
  kind: 'transaction-pending' as const,
  direction: 'outgoing' as const,
  evidence: 'pending-intent' as const,
  transactionHash: transaction.txid,
  scope: {
    accountAddress: address,
    accountId: '0',
    accountType: 'HDAccount',
    chainId: '57',
    networkKey: network.url,
    networkType: 'utxo' as const,
  },
};
const params = {
  account: { address },
  network,
  transaction,
  type: 'pending' as const,
  isEvm: false,
};

beforeEach(() => {
  jest.clearAllMocks();
  notificationManager.cleanup();
});

it('deduplicates local submission followed by discovery of the same pending transaction', () => {
  notificationManager.notifyTransaction(params);
  notificationManager.notifyTransaction({ ...params, fact });
  expect(showTransactionNotification).toHaveBeenCalledTimes(1);
  expect(showActivityNotification).not.toHaveBeenCalled();
});

it('deduplicates discovery followed by the existing local notification path', () => {
  notificationManager.notifyTransaction({ ...params, fact });
  notificationManager.notifyTransaction(params);
  expect(showTransactionNotification).not.toHaveBeenCalled();
  expect(showActivityNotification).toHaveBeenCalledTimes(1);
});

it('suppresses repeated guardian facts and refuses stale delivery', async () => {
  const recovery = {
    ...fact,
    key: 'scope:operation:recovery-completed',
    kind: 'recovery-completed' as const,
    evidence: 'observed-state' as const,
  };
  await notificationManager.notifyActivity(recovery, () => false);
  expect(showActivityNotification).not.toHaveBeenCalled();
  await notificationManager.notifyActivity(recovery);
  await notificationManager.notifyActivity(recovery);
  expect(showActivityNotification).toHaveBeenCalledTimes(1);
});
