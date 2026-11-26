import { Wallet } from 'ethers/wallet';

import { SMART_ACCOUNT_REGISTRATION_CANNOT_BE_CANCELLED } from '../shared/smartAccountFeeQuote';
import {
  buildSmartAccountUserOperation,
  encodeERC7579Executions,
} from '../utils/smartAccount/account';
import {
  getPaliEntryPointAddress,
  paliEntryPointInterface,
  paliSmartAccountInterface,
} from '../utils/smartAccount/contracts';
import { getSmartAccountUserOpHash } from '../utils/smartAccount/userOperationHash';

import type {
  EvmRetainedSignedRecord,
  SmartAccountPendingRecords,
} from './evmSignedRecords';
import { captureSmartAccountAuthorization } from './smartAccountAuthorization';
import {
  assertSmartAccountCancellationOperation,
  captureSmartAccountCancellation,
  inspectSmartAccountCancellationPayer,
  smartAccountCancellationPendingRecords,
} from './smartAccountCancellation';

const chainId = 1;
const account = '0x' + '11'.repeat(20),
  validator = '0x' + '22'.repeat(20);
const payer = new Wallet('0x' + '33'.repeat(32));
const nonce = ((BigInt(validator) << BigInt(96)) + BigInt(7)).toString();
const executions = encodeERC7579Executions([
  { target: account, value: '0x0', data: '0x' },
]);
const original = {
  ...buildSmartAccountUserOperation({
    sender: account,
    nonce,
    initCode: '0x',
    callData: '0x1234',
    accountGasLimits: '0x' + '01'.repeat(32),
    gasFees: '0x' + '01'.repeat(32),
    preVerificationGas: '100',
  }),
  signature: '0x22',
};
const noop = {
  ...original,
  callData: paliSmartAccountInterface.encodeFunctionData('execute', [
    executions.mode,
    executions.executionCalldata,
  ]),
};
const observedAt = { number: '12', hash: '0x' + '44'.repeat(32) };
const authorization = captureSmartAccountAuthorization({
  chainId,
  createdAt: 123,
  payer: payer.address,
  observedAt,
  userOperation: original,
});
const input = {
  account,
  chainId,
  authorization,
  observedAt,
  referenceHash: authorization.operationHash,
};

it('captures an authorization without inventing an outer transaction and preserves the full nonce', () => {
  const cap = captureSmartAccountCancellation(input);
  expect(cap.originalKind).toBe('authorization');
  expect(cap.outer).toBeUndefined();
  expect(cap.nonceKey).toBe((BigInt(nonce) >> BigInt(64)).toString());
  expect(() =>
    assertSmartAccountCancellationOperation(cap, noop, validator)
  ).not.toThrow();
  for (const changed of [
    { ...noop, nonce: (BigInt(nonce) + BigInt(1)).toString() },
    { ...noop, callData: original.callData },
    { ...noop, paymasterAndData: '0x12' },
    { ...noop, sender: payer.address },
  ])
    expect(() =>
      assertSmartAccountCancellationOperation(cap, changed, validator)
    ).toThrow();
  expect(() =>
    assertSmartAccountCancellationOperation({ ...cap }, noop, validator)
  ).toThrow();
  expect(() =>
    assertSmartAccountCancellationOperation(cap, noop, payer.address)
  ).toThrow();
});

const initCode = '0x' + '66'.repeat(20) + '1234';
const registration = { ...noop, initCode };

function captureAuthorizationCancellation(userOperation: typeof original) {
  const retained = captureSmartAccountAuthorization({
    chainId,
    createdAt: 123,
    payer: payer.address,
    observedAt,
    userOperation,
  });
  return captureSmartAccountCancellation({
    ...input,
    authorization: retained,
    referenceHash: retained.operationHash,
  });
}

it.each([
  { label: 'the same hash', preVerificationGas: '100', sameHash: true },
  { label: 'a different hash', preVerificationGas: '101', sameHash: false },
])(
  'rejects a replacement that would register the account with $label',
  ({ preVerificationGas, sameHash }) => {
    const cap = captureAuthorizationCancellation(registration);
    const replacement = {
      ...registration,
      preVerificationGas,
      signature: '0x',
    };
    expect(
      getSmartAccountUserOpHash(replacement, chainId) ===
        cap.authorization.operationHash
    ).toBe(sameHash);
    expect(() =>
      assertSmartAccountCancellationOperation(cap, replacement, validator)
    ).toThrow(
      expect.objectContaining({
        message: SMART_ACCOUNT_REGISTRATION_CANNOT_BE_CANCELLED,
        transactionNotBroadcast: true,
      })
    );
  }
);

it('allows a no-op with deployment initCode to revoke a counterfactual transfer', () => {
  const transfer = encodeERC7579Executions([
    { target: payer.address, value: '0x1', data: '0x' },
  ]);
  const cap = captureAuthorizationCancellation({
    ...original,
    initCode,
    callData: paliSmartAccountInterface.encodeFunctionData('execute', [
      transfer.mode,
      transfer.executionCalldata,
    ]),
  });
  expect(() =>
    assertSmartAccountCancellationOperation(
      cap,
      { ...registration, signature: '0x' },
      validator
    )
  ).not.toThrow();
});

it('allows revoking a registration once the replacement no longer deploys the account', () => {
  const cap = captureAuthorizationCancellation(registration);
  expect(() =>
    assertSmartAccountCancellationOperation(
      cap,
      { ...noop, signature: '0x' },
      validator
    )
  ).not.toThrow();
});

it('can retry from a retired original outer only with the exact retained original authorization', () => {
  const retiredHash = '0x' + '55'.repeat(32);
  const retry = captureSmartAccountCancellation({
    ...input,
    referenceHash: retiredHash,
    operationHash: authorization.operationHash,
  });
  expect(retry.originalKind).toBe('authorization');
  expect(retry.originalHash).toBe(authorization.operationHash);
  expect(retry.referenceHash).toBe(retiredHash);
  expect(() =>
    captureSmartAccountCancellation({ ...input, referenceHash: retiredHash })
  ).toThrow();
  expect(() =>
    captureSmartAccountCancellation({
      ...input,
      referenceHash: retiredHash,
      operationHash: retiredHash,
    })
  ).toThrow();
});

it('isolates only the exact account, chain and full nonce in all pending views', async () => {
  const cap = captureSmartAccountCancellation(input);
  const own = {
    account,
    chainId: '1',
    operationNonce: nonce,
    operationHash: authorization.operationHash,
  };
  const others = [
    { ...own, chainId: '2' },
    { ...own, account: payer.address },
    { ...own, operationNonce: (BigInt(nonce) + BigInt(1)).toString() },
  ];
  let current = true;
  const entries = [own, ...others];
  const source = {
    profileId: observedAt.hash,
    read: async () => entries,
    readAuthorizations: async () => entries,
    filterPendingAuthorizations: (values) => values,
    filterPendingOperations: (values) => values,
    forAuthorization: () => source,
  } as unknown as SmartAccountPendingRecords;
  const scoped = smartAccountCancellationPendingRecords(source, cap, () => {
    if (!current) throw Error('retired');
  });
  expect(await scoped.readAuthorizations!(true)).toEqual(others);
  expect(await scoped.read(true)).toEqual(others);
  expect(scoped.filterPendingAuthorizations!(entries)).toEqual(others);
  expect(
    await scoped.forAuthorization!({
      operationHash: authorization.operationHash,
    }).readAuthorizations!(true)
  ).toEqual(others);
  current = false;
  await expect(scoped.read(true)).rejects.toThrow('retired');
});

it.each([0, 2])(
  'targets the ready retained outer nonce without an RPC transaction body, type%s',
  async (type) => {
    const raw = await payer.signTransaction({
      chainId,
      type,
      nonce: 5,
      to: getPaliEntryPointAddress(chainId),
      value: 0,
      data: paliEntryPointInterface.encodeFunctionData('handleOps', [
        [original],
        payer.address,
      ]),
      gasLimit: 500000,
      ...(type === 0
        ? { gasPrice: 10 }
        : { maxFeePerGas: 10, maxPriorityFeePerGas: 3 }),
    });
    const { Transaction } = await import('ethers/transaction');
    const tx = Transaction.from(raw);
    const outer = {
      rawTransaction: raw,
      hash: tx.hash!,
      chainId: '1',
      from: payer.address.toLowerCase(),
      nonce: 5,
      createdAt: 123,
      phase: 'attempted',
      operation: 'send',
      signer: { id: 0, type: 'HDAccount' },
    } as EvmRetainedSignedRecord;
    const cap = captureSmartAccountCancellation({
      ...input,
      referenceHash: outer.hash,
      outer,
    });
    let latest = '0x5';
    let reportedChainId = '0x1';
    let receipt: unknown = null;
    const provider = {
      send: jest.fn(async (method: string, params: unknown[]) => {
        if (method === 'eth_chainId') return reportedChainId;
        if (method === 'eth_getTransactionReceipt') {
          expect(params).toEqual([outer.hash]);
          return receipt;
        }
        if (method === 'eth_getTransactionCount') {
          expect(params).toEqual([payer.address, 'latest']);
          return latest;
        }
        if (method === 'eth_getBlockByNumber') {
          expect(params).toEqual(['0xc', false]);
          return { hash: observedAt.hash, number: '0xc', gasLimit: '0xabcdef' };
        }
        throw new Error(`Unexpected RPC method ${method}`);
      }),
      getFeeData: jest.fn(async () => ({
        gasPrice: 8,
        maxFeePerGas: 8,
        maxPriorityFeePerGas: 2,
      })),
    };
    const choice = await inspectSmartAccountCancellationPayer(
      cap,
      provider,
      () => undefined
    );
    expect(provider.send).not.toHaveBeenCalledWith(
      'eth_getTransactionByHash',
      expect.anything()
    );
    expect(choice.replaceOuter).toBe(true);
    if (!choice.replaceOuter) throw Error('Missing replacement');
    expect(choice.feeOverrides).toEqual(
      type === 0
        ? { gasPrice: '12' }
        : { maxFeePerGas: '12', maxPriorityFeePerGas: '4' }
    );
    latest = '0x6';
    expect(
      await inspectSmartAccountCancellationPayer(cap, provider, () => undefined)
    ).toEqual({ replaceOuter: false });
    latest = '0x4';
    await expect(
      inspectSmartAccountCancellationPayer(cap, provider, () => undefined)
    ).rejects.toThrow();
    latest = '0x5';
    reportedChainId = '0x2';
    await expect(
      inspectSmartAccountCancellationPayer(cap, provider, () => undefined)
    ).rejects.toThrow('CONTEXT_CHANGED');
    reportedChainId = '0x1';
    receipt = {};
    await expect(
      inspectSmartAccountCancellationPayer(cap, provider, () => undefined)
    ).rejects.toThrow('INVALID_RESPONSE');
    receipt = {
      transactionHash: outer.hash,
      from: payer.address,
      to: tx.to,
      status: '0x0',
      blockHash: observedAt.hash,
      blockNumber: '0xc',
    };
    await expect(
      inspectSmartAccountCancellationPayer(cap, provider, () => undefined)
    ).rejects.toMatchObject({ transactionNotBroadcast: true });
    latest = '0x6';
    expect(
      await inspectSmartAccountCancellationPayer(cap, provider, () => undefined)
    ).toEqual({ replaceOuter: false });
    expect(() =>
      captureSmartAccountCancellation({
        ...input,
        referenceHash: outer.hash,
        outer: { ...outer, nonce: 6 },
      })
    ).toThrow();
    expect(() =>
      captureSmartAccountCancellation({
        ...input,
        outer,
        referenceHash: outer.hash,
        operationHash: observedAt.hash,
      })
    ).toThrow();
  }
);
