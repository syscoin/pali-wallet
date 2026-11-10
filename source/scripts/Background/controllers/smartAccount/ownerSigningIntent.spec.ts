jest.mock('../..', () => ({
  getController: jest.fn(),
  notificationManager: {},
}));
import { buildSmartAccountUserOperation } from '../../../../utils/smartAccount/account';
import { buildSmartAccountUserOpSigningIntent } from '../../../../utils/smartAccount/userOperationHash';

import SmartAccountController from './index';

const userOperation = buildSmartAccountUserOperation({
  sender: '0x' + '11'.repeat(20),
  nonce: '1',
  initCode: '0x',
  callData: '0x1234',
  accountGasLimits: '0x' + '00'.repeat(32),
  preVerificationGas: '1',
  gasFees: '0x' + '00'.repeat(32),
});
const intent = buildSmartAccountUserOpSigningIntent(userOperation, 1);
function capture(change: Record<string, unknown> = {}) {
  const controller = Object.create(SmartAccountController.prototype) as any;
  controller.assertInfrastructureContext = jest.fn();
  controller.executionContexts = new Map([
    [
      'private-context',
      {
        purpose: 'user-operation',
        userOperation: { ...userOperation },
        actionHash: intent.actionHash,
        accountId: 9,
        expiresAt: Date.now() + 300000,
        snapshot: { chainId: 1 },
        ...change,
      },
    ],
  ]);
  return controller;
}
it('derives only from the original private prepared UserOperation', () => {
  const controller = capture();
  expect(
    controller.captureOwnerSigningIntent('private-context').intent
  ).toEqual(intent);
  expect(controller.assertInfrastructureContext).toHaveBeenCalledWith({
    chainId: 1,
  });
  expect(() =>
    controller.captureOwnerSigningIntent('another-context')
  ).toThrow();
});
it.each([
  { purpose: undefined },
  { purpose: 'unknown' },
  { purpose: 'user-operation', userOperation: undefined },
  { purpose: 'recovery-digest' },
  { actionHash: '0x' + '22'.repeat(32) },
  { expiresAt: 0 },
])('rejects missing/mismatched/expired private context %j', (change) => {
  expect(() =>
    capture(change).captureOwnerSigningIntent('private-context')
  ).toThrow();
});
it('recognizes an existing explicit recovery digest without manufacturing a typed preimage', () => {
  const captured = capture({
    purpose: 'recovery-digest',
    userOperation: undefined,
  }).captureOwnerSigningIntent('private-context');
  expect(captured.intent).toEqual({
    actionHash: intent.actionHash,
    purpose: 'recovery',
    representation: 'raw-only',
    reason: 'recovery-digest',
  });
  expect(captured.expiresAt).toBeGreaterThan(Date.now());
});
