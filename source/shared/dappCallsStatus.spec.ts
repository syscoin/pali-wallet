import { buildSmartAccountUserOperation } from '../utils/smartAccount/account';
import {
  getPaliEntryPointAddress,
  paliEntryPointInterface,
} from '../utils/smartAccount/contracts';

import {
  assertSmartAccountCallsIdentity,
  captureSmartAccountCallsIdentity,
  getSmartAccountCallsOutcome,
  normalizeDappCallsReceipt,
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

describe('shared calls receipt normalization', () => {
  const hash = `0x${'11'.repeat(32)}`;
  const raw = {
    transactionHash: hash,
    status: '0x1',
    blockHash: `0x${'22'.repeat(32)}`,
    blockNumber: '0x20000000000001',
    gasUsed: '0x20000000000003',
    logs: [],
  };
  it('preserves raw quantities beyond Number precision', () => {
    expect(normalizeDappCallsReceipt(raw, hash)).toEqual({
      hash,
      status: 1,
      blockHash: raw.blockHash,
      blockNumber: raw.blockNumber,
      gasUsed: raw.gasUsed,
      logs: [],
    });
  });
  it('accepts the ethers receipt shape through the same exact validators', () => {
    expect(
      normalizeDappCallsReceipt(
        {
          ...raw,
          hash,
          transactionHash: undefined,
          status: 1,
          blockNumber: 12,
          gasUsed: BigInt(21000),
        },
        hash
      )
    ).toMatchObject({ blockNumber: '0xc', gasUsed: '0x5208' });
  });
  it.each([
    { transactionHash: `0x${'33'.repeat(32)}` },
    { status: '0x2' },
    { blockNumber: Number.MAX_SAFE_INTEGER + 1 },
    { gasUsed: '-1' },
    { blockHash: '0x1234' },
    { logs: [{ address: sender, topics: ['0x1'], data: '0x' }] },
  ])('rejects malformed or unbound receipts', (changes) => {
    expect(() =>
      normalizeDappCallsReceipt({ ...raw, ...changes }, hash)
    ).toThrow();
  });
});

it('canonicalizes byte-padded BigNumber quantities while raw RPC quantities remain strict', () => {
  const hash = `0x${'11'.repeat(32)}`;
  const receipt = {
    hash,
    status: 1,
    blockHash: `0x${'22'.repeat(32)}`,
    logs: [],
    blockNumber: { toHexString: () => '0x00' },
    gasUsed: { toHexString: () => '0x05208' },
  };
  expect(normalizeDappCallsReceipt(receipt, hash)).toMatchObject({
    blockNumber: '0x0',
    gasUsed: '0x5208',
  });
  expect(() =>
    normalizeDappCallsReceipt({ ...receipt, gasUsed: '0x05208' }, hash)
  ).toThrow();
});
