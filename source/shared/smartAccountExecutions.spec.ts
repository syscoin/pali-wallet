import { encodeERC7579Executions } from '../utils/smartAccount/account';
import { paliSmartAccountInterface } from '../utils/smartAccount/contracts';

import {
  projectSmartAccountNativePayment,
  sumSmartAccountNativePayments,
} from './smartAccountExecutions';

const RECIPIENT = '0x1111111111111111111111111111111111111111';
const OTHER = '0x2222222222222222222222222222222222222222';
const operation = (
  calls: { data?: string; target: string; value: string }[]
) => {
  const { mode, executionCalldata } = encodeERC7579Executions(calls);
  return {
    callData: paliSmartAccountInterface.encodeFunctionData('execute', [
      mode,
      executionCalldata,
    ]),
  };
};

it('sums every matching native payment in a batch and across operations', () => {
  expect(
    sumSmartAccountNativePayments(
      [
        operation([
          { target: RECIPIENT, value: '1000000000000000000', data: '0x1234' },
          { target: OTHER, value: '77000000000000000000' },
          { target: RECIPIENT, value: '2000000000000000000' },
        ]),
        operation([{ target: RECIPIENT, value: '9007199254740993' }]),
      ],
      RECIPIENT
    )
  ).toBe('3009007199254740993');
});

it('preserves integer precision and does not impose a per-call limit on the total', () => {
  const maximum = (BigInt(1) << BigInt(256)) - BigInt(1);
  expect(
    sumSmartAccountNativePayments(
      [
        operation([{ target: RECIPIENT, value: maximum.toString() }]),
        operation([{ target: RECIPIENT, value: maximum.toString() }]),
      ],
      RECIPIENT
    )
  ).toBe((maximum * BigInt(2)).toString());
});

it('does not report a partial amount for an undecodable operation', () => {
  expect(
    sumSmartAccountNativePayments(
      [operation([{ target: RECIPIENT, value: '9' }]), { callData: '0x1234' }],
      RECIPIENT
    )
  ).toBeUndefined();
  expect(
    sumSmartAccountNativePayments(
      [
        operation([
          { target: OTHER, value: '9' },
          { target: RECIPIENT, value: '0' },
        ]),
      ],
      RECIPIENT
    )
  ).toBeUndefined();
});

it('projects only native display fields while leaving caller calldata intact', () => {
  const calls = [
    operation([{ target: RECIPIENT, value: '3', data: '0x1234' }]),
  ];
  const before = calls[0].callData;
  expect(
    projectSmartAccountNativePayment(calls, {
      chainId: 1,
      recipient: RECIPIENT,
      sender: OTHER,
    })
  ).toEqual({
    chainId: 1,
    from: OTHER,
    to: RECIPIENT,
    value: '3',
    input: '0x',
    data: '0x',
  });
  expect(calls[0].callData).toBe(before);
});
