import { Wallet } from 'ethers/wallet';

import { EVM_SIGNED_RECORD_LIMITS } from '../shared/evmSignedRecordLimits';
import {
  buildSmartAccountUserOperation,
  encodeERC7579Executions,
  encodeSmartAccountValidatorNonceKey,
} from '../utils/smartAccount/account';
import { paliSmartAccountInterface } from '../utils/smartAccount/contracts';
import { getSmartAccountUserOpHash } from '../utils/smartAccount/userOperationHash';

import {
  captureSmartAccountAuthorization,
  captureSmartAccountAuthorizationSummary,
  decodeSmartAccountAuthorization,
  encodeSmartAccountAuthorization,
  smartAccountAuthorizationSummary,
} from './smartAccountAuthorization';

const owner = new Wallet('0x' + '71'.repeat(32));
const account = '0x' + '72'.repeat(20),
  validator = '0x' + '73'.repeat(20);
function fixture() {
  const userOperation = buildSmartAccountUserOperation({
    sender: account,
    nonce: (
      BigInt(encodeSmartAccountValidatorNonceKey(validator)) << BigInt(64)
    ).toString(),
    callData: '0x1234',
  });
  userOperation.signature = owner.signingKey.sign(
    getSmartAccountUserOpHash(userOperation, 1)
  ).serialized;
  return {
    chainId: 1,
    createdAt: 10,
    observedAt: { number: '100', hash: '0x' + '74'.repeat(32) },
    payer: owner.address,
    userOperation,
  };
}

it('retains an exact signed instruction independently of any outer transaction identity', () => {
  const input = fixture(),
    captured = captureSmartAccountAuthorization(input);
  const summary = smartAccountAuthorizationSummary(captured);
  expect(summary).not.toHaveProperty('hash');
  expect(summary).not.toHaveProperty('payerNonce');
  expect(summary).not.toHaveProperty('rawTransaction');
  expect(summary.operationHash).toBe(
    getSmartAccountUserOpHash(input.userOperation, 1)
  );
  expect(
    decodeSmartAccountAuthorization(
      summary,
      encodeSmartAccountAuthorization(captured)
    )
  ).toEqual(captured);
  input.userOperation.signature = '0x00';
  input.observedAt.number = '101';
  expect(captured.userOperation.signature).not.toBe('0x00');
  expect(captured.observedAt.number).toBe('100');
  expect(Object.isFrozen(captured.userOperation)).toBe(true);
});

it.each(['account', 'chainId', 'operationHash', 'operationNonce'])(
  'refuses a payload whose authenticated %s disagrees',
  (field) => {
    const captured = captureSmartAccountAuthorization(fixture()),
      summary = smartAccountAuthorizationSummary(captured);
    const changes: Record<string, string> = {
      account: owner.address,
      chainId: '2',
      operationHash: '0x' + '75'.repeat(32),
      operationNonce: '1',
    };
    expect(() =>
      decodeSmartAccountAuthorization(
        { ...summary, [field]: changes[field] },
        encodeSmartAccountAuthorization(captured)
      )
    ).toThrow();
  }
);

it('preserves a canonical cancellation relationship without inventing a transaction hash', () => {
  const original = '0x' + '76'.repeat(32);
  const input = fixture(),
    noop = encodeERC7579Executions([
      { target: account, value: '0x0', data: '0x' },
    ]);
  input.userOperation.callData = paliSmartAccountInterface.encodeFunctionData(
    'execute',
    [noop.mode, noop.executionCalldata]
  );
  input.userOperation.signature = owner.signingKey.sign(
    getSmartAccountUserOpHash(input.userOperation, 1)
  ).serialized;
  const captured = captureSmartAccountAuthorization({
    ...input,
    replacesOperationHash: original,
  });
  expect(
    captureSmartAccountAuthorizationSummary(
      smartAccountAuthorizationSummary(captured)
    ).replacesOperationHash
  ).toBe(original);
  expect(() =>
    captureSmartAccountAuthorization({
      ...input,
      replacesOperationHash: captured.operationHash,
    })
  ).toThrow();
});

it.each([
  (input: ReturnType<typeof fixture>) => {
    input.userOperation.signature = '0x';
  },
  (input: ReturnType<typeof fixture>) => {
    input.userOperation.nonce = '01';
  },
  (input: ReturnType<typeof fixture>) => {
    input.userOperation.callData = '0x1';
  },
  (input: ReturnType<typeof fixture>) => {
    input.userOperation.gasFees = '0x00';
  },
  (input: ReturnType<typeof fixture>) => {
    input.userOperation.paymasterAndData = '0x01';
  },
  (input: ReturnType<typeof fixture>) => {
    input.userOperation.sender = '0x' + '00'.repeat(20);
  },
  (input: ReturnType<typeof fixture>) => {
    input.chainId = Number.MAX_SAFE_INTEGER + 1;
  },
  (input: ReturnType<typeof fixture>) => {
    input.createdAt = -1;
  },
  (input: ReturnType<typeof fixture>) => {
    Object.assign(input.userOperation, { rawTransaction: '0x' });
  },
])('rejects malformed or unsigned authorization before encoding', (mutate) => {
  const input = fixture();
  mutate(input);
  expect(() => captureSmartAccountAuthorization(input)).toThrow();
});

it('rejects oversized signing bytes before constructing encrypted chunks', () => {
  const input = fixture();
  input.userOperation.signature =
    '0x' + '11'.repeat(EVM_SIGNED_RECORD_LIMITS.bytes / 2);
  expect(() => captureSmartAccountAuthorization(input)).toThrow();
});

it('requires canonical payload bytes and fatal UTF-8 while allowing chunk-sized signatures', () => {
  const input = fixture();
  input.userOperation.signature = '0x' + '22'.repeat(49 * 1024);
  const captured = captureSmartAccountAuthorization(input),
    summary = smartAccountAuthorizationSummary(captured);
  const payload = encodeSmartAccountAuthorization(captured);
  expect(payload.length).toBeGreaterThan(EVM_SIGNED_RECORD_LIMITS.chunkBytes);
  expect(decodeSmartAccountAuthorization(summary, payload)).toEqual(captured);
  expect(() =>
    decodeSmartAccountAuthorization(summary, new Uint8Array([0xff]))
  ).toThrow();
  expect(() =>
    decodeSmartAccountAuthorization(
      summary,
      new TextEncoder().encode(' ' + new TextDecoder().decode(payload))
    )
  ).toThrow();
});
