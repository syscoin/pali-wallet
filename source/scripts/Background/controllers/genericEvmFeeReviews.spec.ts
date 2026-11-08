import {
  snapshotPreparedEvmTransaction,
  serializePreparedEvmTransaction,
} from '@sidhujag/sysweb3-keyring/cjs/transactions/evm-envelope.js';
import { Transaction } from 'ethers/transaction';
import { Wallet } from 'ethers/wallet';

import {
  bindGenericEvmFeeDispatch,
  captureGenericEvmFeeDispatch,
  captureGenericEvmFeeSdkEntryState,
  markGenericEvmFeeSdkEntered,
  consumeGenericEvmFeeReview,
  issueGenericEvmFeeReview,
} from './nativeEvmFeeReviews';
import type { IEvmTransactionResponse } from './transactions/types';
import type { EvmDappReview } from '../../../shared/evmDappReview';
import type { IEvmTransactionContext } from '../../../utils/evmTransactionContext';

const wallet = new Wallet(`0x${'11'.repeat(32)}`);
const transaction = snapshotPreparedEvmTransaction({
  from: wallet.address,
  to: `0x${'22'.repeat(20)}`,
  chainId: '57',
  nonce: '0',
  value: '0',
  data: '0x1234',
  type: 2,
  gasLimit: '60000',
  accessList: [],
  maxFeePerGas: '3',
  maxPriorityFeePerGas: '1',
});
const context = {
  account: { address: wallet.address, id: 0, type: 'HDAccount' },
  chainId: 57,
  rpcUrl: 'https://rpc.invalid',
  slip44: 60,
  sessionGeneration: 7,
} as IEvmTransactionContext;
const nonce = { nonce: 0, source: 'automatic' as const };

function fixture(kind: 'dapp' | 'private-deposit' = 'dapp') {
  const owner = {},
    request = {};
  let live = true;
  const check = () => {
    if (!live) throw new Error('retired');
  };
  const review: EvmDappReview<IEvmTransactionResponse> = Object.freeze({
    transaction,
    maximumFeeUnits: '180000',
    maximumTotalUnits: '180000',
    coveredFeeUnits: '0',
    expiresAtMonotonicMilliseconds: Math.floor(performance.now()) + 90000,
    submit: jest.fn(),
  });
  const token = issueGenericEvmFeeReview(
    owner,
    review,
    context,
    nonce,
    check,
    Math.floor(performance.now()),
    { kind, request },
    () => 'review-one'
  );
  const consume = (next = context, authority = { kind, request }) =>
    consumeGenericEvmFeeReview(
      owner,
      token.id,
      next,
      check,
      Math.floor(performance.now()),
      authority
    );
  const submission = {
    operation: 'send' as const,
    account: context.account,
    network: { kind: 'ethereum', chainId: 57, url: context.rpcUrl, slip44: 60 },
    walletNonce: nonce,
    review: {
      id: token.id,
      unsignedHash: Transaction.from(
        serializePreparedEvmTransaction(transaction)
      ).unsignedHash,
    },
  };
  return {
    owner,
    request,
    check,
    token,
    consume,
    submission,
    retire() {
      live = false;
    },
  };
}

it('requires the same worker request identity even for identical account/network contexts', () => {
  const f = fixture();
  expect(() => f.consume(context, { kind: 'dapp', request: {} })).toThrow(
    'request changed'
  );
  expect(f.consume().review.transaction).toBe(transaction);
  expect(() => f.consume()).toThrow('unavailable');
});

it('does not allow a wallet-only token to stand in for a dapp approval', () => {
  const f = fixture();
  expect(() =>
    consumeGenericEvmFeeReview(
      f.owner,
      f.token.id,
      context,
      f.check,
      Math.floor(performance.now()),
      { kind: 'wallet' }
    )
  ).toThrow('request changed');
  expect(f.consume()).toBeDefined();
});

it('rejects a changed A-B-A wallet generation before consuming the old review', () => {
  const f = fixture();
  expect(() => f.consume({ ...context, sessionGeneration: 9 })).toThrow(
    'context changed'
  );
  expect(f.consume()).toBeDefined();
});

it('requires a consumed bound lease, exact ID, and exact approved unsigned hash', () => {
  const f = fixture();
  expect(() => captureGenericEvmFeeDispatch(f.owner, f.submission)).toThrow(
    'unavailable'
  );
  f.consume();
  const dispatch = jest.fn(async () => undefined);
  bindGenericEvmFeeDispatch(f.owner, f.token.id, context, dispatch);
  expect(captureGenericEvmFeeDispatch(f.owner, f.submission)).toEqual(
    expect.objectContaining({ preflight: expect.any(Function) })
  );
  expect(() =>
    captureGenericEvmFeeDispatch(f.owner, {
      ...f.submission,
      review: { ...f.submission.review, id: 'another' },
    })
  ).toThrow('unavailable');
  expect(() =>
    captureGenericEvmFeeDispatch(f.owner, {
      ...f.submission,
      review: { ...f.submission.review, unsignedHash: `0x${'00'.repeat(32)}` },
    })
  ).toThrow('context changed');
});

it('rechecks the held owner before and after final dispatch refresh', async () => {
  const f = fixture(),
    held = f.consume();
  bindGenericEvmFeeDispatch(f.owner, f.token.id, context, async () => {
    f.retire();
  });
  const refresh = captureGenericEvmFeeDispatch(f.owner, f.submission)!;
  const rawTransaction = await wallet.signTransaction(
    Transaction.from(serializePreparedEvmTransaction(transaction))
  );
  await expect(
    refresh.preflight(
      {
        context: f.submission,
        rawTransaction,
        hash: Transaction.from(rawTransaction).hash!,
        from: wallet.address,
        chainId: '57',
        nonce: 0,
        type: 2,
      },
      () => undefined,
      {} as any
    )
  ).rejects.toThrow('retired');
  held.close();
  expect(() => captureGenericEvmFeeDispatch(f.owner, f.submission)).toThrow(
    'unavailable'
  );
});

it('requires the exact private deposit owner and rejects public dapp substitution', () => {
  const f = fixture('private-deposit');
  expect(() =>
    f.consume(context, { kind: 'private-deposit', request: {} })
  ).toThrow('request changed');
  expect(() =>
    f.consume(context, { kind: 'dapp', request: f.request })
  ).toThrow('request changed');
  expect(f.consume().review.transaction).toBe(transaction);
  expect(JSON.stringify(f.token)).not.toContain('private-deposit');
  expect(f.token).not.toHaveProperty('request');
  expect(f.token).not.toHaveProperty('submit');
});

it('retains private pre-SDK stage evidence after a review is removed', () => {
  const f = fixture();
  const entered = captureGenericEvmFeeSdkEntryState(f.owner, f.token.id);
  const held = f.consume();
  held.close();
  expect(entered()).toBe(false);
});

it('records actual SDK entry independently of later review removal', () => {
  const f = fixture();
  const entered = captureGenericEvmFeeSdkEntryState(f.owner, f.token.id);
  const held = f.consume();
  bindGenericEvmFeeDispatch(
    f.owner,
    f.token.id,
    context,
    async () => undefined
  );
  markGenericEvmFeeSdkEntered(f.owner, f.token.id);
  held.close();
  expect(entered()).toBe(true);
});
