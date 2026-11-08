import { buildSmartAccountUserOperation } from '../utils/smartAccount/account';
import {
  getPaliEntryPointAddress,
  paliEntryPointInterface,
} from '../utils/smartAccount/contracts';

import {
  assertSmartAccountCallsIdentity,
  captureSmartAccountCallsIdentity,
  getSmartAccountCallsOutcome,
} from './dappCallsStatus';

const sender = `0x${'11'.repeat(20)}`;
const operation = buildSmartAccountUserOperation({
  sender,
  nonce: '0',
  callData: '0x',
});
const identity = captureSmartAccountCallsIdentity(operation, 1);
const event = (success = true, overrides: Record<string, string> = {}) => ({
  address: identity.entryPoint,
  ...paliEntryPointInterface.encodeEventLog(
    paliEntryPointInterface.getEvent('UserOperationEvent')!,
    [
      overrides.userOpHash ?? identity.userOpHash,
      overrides.sender ?? identity.sender,
      `0x${'00'.repeat(20)}`,
      0,
      success,
      1,
      1,
    ]
  ),
});
const receipt = (logs = [event()]) => ({ status: 1, logs });

describe('shared smart-account batch outcome', () => {
  it('captures the locally prepared operation and immutable chain identity', () => {
    expect(identity).toMatchObject({
      chainId: 1,
      sender,
      entryPoint: getPaliEntryPointAddress(1).toLowerCase(),
    });
    expect(Object.isFrozen(identity)).toBe(true);
    expect(
      captureSmartAccountCallsIdentity({ ...operation, nonce: '1' }, 1)
    ).not.toEqual(identity);
  });

  it.each([true, false])(
    'reports only the matching operation success %p',
    (success) => {
      expect(
        getSmartAccountCallsOutcome(identity, 1, [receipt([event(success)])])
      ).toBe(success);
    }
  );

  it.each([
    [
      'unrelated operation',
      () => event(true, { userOpHash: `0x${'22'.repeat(32)}` }),
    ],
    ['another sender', () => event(true, { sender: `0x${'33'.repeat(20)}` })],
    [
      'another emitter',
      () => ({ ...event(), address: `0x${'44'.repeat(20)}` }),
    ],
    ['malformed matching data', () => ({ ...event(), data: '0x1234' })],
  ])('does not infer success from %s', (_name, makeEvent) => {
    expect(
      getSmartAccountCallsOutcome(identity, 1, [receipt([makeEvent()])])
    ).toBeUndefined();
  });

  it('ignores unrelated events alongside the one matching operation', () => {
    expect(
      getSmartAccountCallsOutcome(identity, 1, [
        receipt([
          event(false, { userOpHash: `0x${'22'.repeat(32)}` }),
          event(),
        ]),
      ])
    ).toBe(true);
  });

  it('rejects duplicate matches', () => {
    expect(
      getSmartAccountCallsOutcome(identity, 1, [receipt([event(), event()])])
    ).toBeUndefined();
  });

  it('reports a single reverted outer transaction without requiring impossible logs', () => {
    expect(
      getSmartAccountCallsOutcome(identity, 1, [{ status: 0, logs: [] }])
    ).toBe(false);
    expect(
      getSmartAccountCallsOutcome(identity, 1, [{ status: 0, logs: [] }, null])
    ).toBeUndefined();
    expect(
      getSmartAccountCallsOutcome(identity, 1, [
        { status: 0, logs: [] },
        receipt(),
      ])
    ).toBe(true);
  });

  it('keeps old records without operation identity inconclusive', () => {
    expect(
      getSmartAccountCallsOutcome(undefined, 1, [receipt()])
    ).toBeUndefined();
    expect(
      getSmartAccountCallsOutcome(identity, 1, [receipt([])])
    ).toBeUndefined();
  });

  it.each([
    { ...identity, sender: 'invalid' },
    { ...identity, userOpHash: undefined },
    { ...identity, chainId: 2 },
    { ...identity, entryPoint: `0x${'44'.repeat(20)}` },
  ])('rejects malformed or mismatched stored identity', (value) => {
    expect(() => assertSmartAccountCallsIdentity(value as any, 1)).toThrow();
    expect(
      getSmartAccountCallsOutcome(value as any, 1, [receipt()])
    ).toBeUndefined();
  });
});
