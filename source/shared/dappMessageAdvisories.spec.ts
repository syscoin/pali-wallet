import {
  reviewDappMessageAdvisories,
  type DappAddressAdvisory,
} from './dappMessageAdvisories';
import type { IBlacklistCheckResult } from '../types/security';

const ADDRESS = '0xAbCd';
const ZERO = '0x0000000000000000000000000000000000000000';
const flagged: IBlacklistCheckResult = {
  isBlacklisted: true,
  reason: 'Reported address',
  severity: 'high',
};

const review = (
  primaryType: string,
  message: unknown,
  checkAddress: (address: string) => Promise<IBlacklistCheckResult> = jest.fn(
    async () => flagged
  ),
  assertCurrent: () => void = jest.fn(),
  method = 'eth_signTypedData_v4',
  onWarning: (warning: DappAddressAdvisory) => void = jest.fn()
) =>
  reviewDappMessageAdvisories({
    method,
    typedData: { primaryType, message },
    checkAddress,
    assertCurrent,
    onWarning,
  });

it.each(['eth_signTypedData_v3', 'eth_signTypedData_v4'])(
  '%s preserves Permit and generic field order, spelling and repeated addresses',
  async (method) => {
    const checkAddress = jest.fn<Promise<IBlacklistCheckResult>, [string]>(
      async () => flagged
    );
    const message = {
      spender: ADDRESS,
      to: ZERO,
      recipient: ADDRESS,
      operator: '0XabCd',
      approved: ADDRESS,
      delegate: ADDRESS,
    };
    const result = await review(
      'Permit',
      message,
      checkAddress,
      jest.fn(),
      method
    );
    expect(result.addresses.map(({ field }) => field)).toEqual([
      'spender',
      'to',
      'recipient',
      'approved',
      'delegate',
    ]);
    expect(checkAddress.mock.calls.map(([address]) => address)).toEqual([
      ADDRESS,
      ZERO,
      ADDRESS,
      ADDRESS,
      ADDRESS,
    ]);
    expect(result.warning).toBe(result.addresses[0]);
  }
);

it('preserves ERC721Order maker, nonzero taker, fee recipients and generic fields', async () => {
  const result = await review('ERC721Order', {
    maker: ADDRESS,
    taker: ADDRESS,
    fees: [null, { recipient: ADDRESS }, { recipient: ZERO }, { recipient: 4 }],
    to: ADDRESS,
  });
  expect(result.addresses.map(({ field }) => field)).toEqual([
    'maker',
    'taker',
    'fees[1].recipient',
    'fees[2].recipient',
    'to',
  ]);
  const zeroTaker = await review('ERC721Order', { maker: ZERO, taker: ZERO });
  expect(zeroTaker.addresses.map(({ field }) => field)).toEqual(['maker']);
});

it('preserves OrderComponents offerer, nonzero zone and consideration recipients', async () => {
  const result = await review('OrderComponents', {
    offerer: ADDRESS,
    zone: ADDRESS,
    consideration: [{ recipient: ADDRESS }, null, { recipient: ZERO }],
    delegate: ADDRESS,
  });
  expect(result.addresses.map(({ field }) => field)).toEqual([
    'offerer',
    'zone',
    'consideration[0].recipient',
    'consideration[2].recipient',
    'delegate',
  ]);
  const zeroZone = await review('OrderComponents', {
    offerer: ZERO,
    zone: ZERO,
  });
  expect(zeroZone.addresses.map(({ field }) => field)).toEqual(['offerer']);
});

it('keeps every flagged result and selects the first high or critical warning', async () => {
  const onWarning = jest.fn();
  const checkAddress = jest
    .fn<Promise<IBlacklistCheckResult>, [string]>()
    .mockResolvedValueOnce({
      isBlacklisted: true,
      severity: 'medium',
      reason: 'medium',
    })
    .mockResolvedValueOnce({
      isBlacklisted: true,
      severity: 'high',
      reason: 'first',
    })
    .mockResolvedValueOnce({
      isBlacklisted: true,
      severity: 'critical',
      reason: 'later',
    })
    .mockResolvedValueOnce({ isBlacklisted: false, severity: 'low' });
  const result = await review(
    'Message',
    {
      to: ADDRESS,
      recipient: ADDRESS,
      operator: ADDRESS,
      approved: ADDRESS,
    },
    checkAddress,
    jest.fn(),
    'eth_signTypedData_v4',
    onWarning
  );
  expect(result.addresses.map(({ reason }) => reason)).toEqual([
    'medium',
    'first',
    'later',
  ]);
  expect(result.warning).toBe(result.addresses[1]);
  expect(onWarning).toHaveBeenCalledTimes(1);
  expect(onWarning).toHaveBeenCalledWith(result.addresses[1]);
});

it('keeps low and medium matches without a high-risk warning', async () => {
  const result = await review(
    'Permit',
    { spender: ADDRESS },
    jest.fn(async () => ({
      isBlacklisted: true,
      severity: 'medium' as const,
    }))
  );
  expect(result.addresses).toHaveLength(1);
  expect(result.warning).toBeUndefined();
});

it('publishes the first high-risk warning before a later lookup fails', async () => {
  const unavailable = new Error('lookup unavailable');
  const onWarning = jest.fn();
  const checkAddress = jest
    .fn<Promise<IBlacklistCheckResult>, [string]>()
    .mockResolvedValueOnce(flagged)
    .mockImplementationOnce(async () => {
      expect(onWarning).toHaveBeenCalledTimes(1);
      expect(onWarning).toHaveBeenCalledWith({
        address: ADDRESS,
        field: 'spender',
        reason: flagged.reason,
        severity: 'high',
      });
      throw unavailable;
    });
  await expect(
    review(
      'Permit',
      { spender: ADDRESS, to: ADDRESS },
      checkAddress,
      jest.fn(),
      'eth_signTypedData_v4',
      onWarning
    )
  ).rejects.toBe(unavailable);
  expect(onWarning).toHaveBeenCalledTimes(1);
});

it.each(['personal_sign', 'eth_signTypedData', 'eth_sign'])(
  '%s performs no typed-address lookup',
  async (method) => {
    const checkAddress = jest.fn(async () => flagged);
    const result = await review(
      'Permit',
      { spender: ADDRESS },
      checkAddress,
      jest.fn(),
      method
    );
    expect(result).toEqual({ addresses: [] });
    expect(checkAddress).not.toHaveBeenCalled();
  }
);

it('checks current authority before starting a lookup', async () => {
  const checkAddress = jest.fn(async () => flagged);
  const cancelled = new Error('cancelled');
  await expect(
    review('Permit', { spender: ADDRESS }, checkAddress, () => {
      throw cancelled;
    })
  ).rejects.toBe(cancelled);
  expect(checkAddress).not.toHaveBeenCalled();
});

it('discards a held result after cancellation and stops further lookups', async () => {
  let finish!: (result: IBlacklistCheckResult) => void;
  let current = true;
  const checkAddress = jest.fn(
    () =>
      new Promise<IBlacklistCheckResult>((resolve) => {
        finish = resolve;
      })
  );
  const cancelled = new Error('cancelled');
  const onWarning = jest.fn();
  const pending = review(
    'Permit',
    { spender: ADDRESS, to: ADDRESS },
    checkAddress,
    () => {
      if (!current) throw cancelled;
    },
    'eth_signTypedData_v4',
    onWarning
  );
  expect(checkAddress).toHaveBeenCalledTimes(1);
  current = false;
  finish(flagged);
  await expect(pending).rejects.toBe(cancelled);
  expect(checkAddress).toHaveBeenCalledTimes(1);
  expect(onWarning).not.toHaveBeenCalled();
});
