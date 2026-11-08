jest.mock('..', () => ({ getController: jest.fn(), notificationManager: {} }));
jest.mock('./providers/patchFetchWithPaliHeaders', () => ({
  patchFetchWithPaliHeaders: jest.fn(),
}));
jest.mock('@sidhujag/sysweb3-keyring', () => ({
  KeyringManager: jest.fn(),
  CustomJsonRpcProvider: jest.fn(),
  PsbtUtils: {},
}));
jest.mock('./message-handler/sendCallsBundles', () => ({
  recordSendCallsBundle: jest.fn(async () => undefined),
}));

import MainController from './MainController';
import { recordSendCallsBundle } from './message-handler/sendCallsBundles';

const identity = Object.freeze({
  chainId: 1,
  entryPoint: `0x${'11'.repeat(20)}`,
  sender: `0x${'22'.repeat(20)}`,
  userOpHash: `0x${'33'.repeat(32)}`,
});
const record = {
  atomic: true,
  chainId: 1,
  reservationId: 'reservation',
  smartAccount: true,
  smartAccountExecutionContextId: 'issued-context',
  submissionId: 'attempt',
  submissionStarted: true,
  txHashes: [],
};
let wallet: any;
let getIdentity: jest.Mock;
beforeEach(() => {
  jest.clearAllMocks();
  wallet = Object.create(MainController.prototype);
  getIdentity = jest.fn(() => identity);
  wallet.smartAccount = { getPreparedCallsIdentity: getIdentity };
});

it('persists the background operation identity instead of supplied page metadata', async () => {
  await wallet.recordSendCallsBundle('https://app.invalid', 'bundle', {
    ...record,
    smartAccountIdentity: { ...identity, userOpHash: 'forged' },
  });
  expect(getIdentity).toHaveBeenCalledWith('issued-context');
  expect(recordSendCallsBundle).toHaveBeenCalledWith(
    'https://app.invalid',
    'bundle',
    expect.objectContaining({ smartAccountIdentity: identity })
  );
  expect(
    jest.mocked(recordSendCallsBundle).mock.calls[0][2]
  ).not.toHaveProperty('smartAccountExecutionContextId');
});

it('does not write an unissued or stale smart operation', async () => {
  getIdentity.mockImplementation(() => {
    throw new Error('context changed');
  });
  await expect(
    wallet.recordSendCallsBundle('host', 'id', record)
  ).rejects.toThrow('context changed');
  expect(recordSendCallsBundle).not.toHaveBeenCalled();
});

it('keeps progress writes free of caller-selected operation identity', async () => {
  await wallet.recordSendCallsBundle('host', 'id', {
    ...record,
    submissionStarted: false,
    submissionCompleted: true,
    smartAccountIdentity: { ...identity, userOpHash: 'forged' },
  });
  expect(getIdentity).not.toHaveBeenCalled();
  expect(
    jest.mocked(recordSendCallsBundle).mock.calls[0][2].smartAccountIdentity
  ).toBeUndefined();
});
