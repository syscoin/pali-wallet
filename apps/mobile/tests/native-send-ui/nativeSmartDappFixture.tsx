import { unsupportedDappViews } from '../unsupportedDappPorts';
import React, { useLayoutEffect, useRef, useState } from 'react';
import { Interface } from 'ethers/abi';
import {
  parseApprovalAmount,
  summarizeApproval,
} from '../../../../source/shared/approval';
import type {
  NativeConnectionsView,
  NativeSmartTransactionReview,
} from '../../src/connections/types';
import { getNativeNetwork } from '../../src/custody/networkContext';
import { NativeSmartTransactionReviewScreen } from '../../src/screens/NativeSmartTransactionReview';
import { Text } from '../../src/ui';

// Synthetic public review states only. This fixture cannot reach a signer or RPC.
const query = new URLSearchParams(window.location.search);
const account = '0x1111111111111111111111111111111111111111';
const payer = '0x2222222222222222222222222222222222222222';
const target = '0x3333333333333333333333333333333333333333';
const spender = '0x4444444444444444444444444444444444444444';
const hash = '0x' + 'ab'.repeat(32);
const approvalAbi = new Interface([
  'function approve(address spender,uint256 amount)',
]);
const metadata = {
  standard: 'ERC-20' as const,
  token: {
    contractAddress: target,
    name: 'Example token',
    symbol: 'TOK',
    decimals: 6,
  },
};
const data = query.has('allowance')
  ? approvalAbi.encodeFunctionData('approve', [spender, (1n << 256n) - 1n])
  : query.has('long-data')
  ? '0x' + 'ab'.repeat(8192) + 'cd'
  : '0x12345678';
const initial: NativeSmartTransactionReview = {
  kind: 'smart-transaction',
  method: 'eth_sendTransaction',
  id: 'smart-request-1',
  revision: 7,
  appName: 'Example swap',
  origin: 'https://swap.example.invalid',
  accountLabel: 'Smart savings',
  address: account,
  networkLabel: 'Ethereum',
  chainId: '1',
  verification: {
    validation: query.has('invalid-site') ? 'INVALID' : 'VALID',
    isScam: false,
  },
  expiresAt: Date.now() + 300000,
  error: query.has('invalid-site') ? 'SITE_MISMATCH' : null,
  needsAccountSwitch: query.has('switch'),
  busy: false,
  dispatched: false,
  advisories: query.has('warning')
    ? [
        {
          address: target,
          field: 'Recipient',
          severity: 'high',
          reason: 'Known unsafe recipient',
        },
      ]
    : [],
  requiresWarningAcknowledgement: query.has('warning'),
  approval: query.has('allowance')
    ? summarizeApproval(data, target, metadata)
    : null,
  operation: {
    phase: 'authorize',
    revision: 1,
    account,
    network: getNativeNetwork('ethereum'),
    intent: { kind: 'dapp-call', recipient: target, amountUnits: '9', data },
    maximumPrefundUnits: '210000000000000',
    userOperationHash: hash,
    authorization: {
      entryPoint: '0x5555555555555555555555555555555555555555',
      nonce: '7',
      initCode: '0x',
      callData: data,
    },
    payerReview: null,
    transactionHash: null,
    error: null,
  },
};
const calls: { method: string; args: unknown[] }[] = [];

declare global {
  interface Window {
    __nativeSmartDappFixture: { calls(): typeof calls; expire(): void };
  }
}

export function NativeSmartDappFixture() {
  const [review, setReview] = useState<NativeSmartTransactionReview | null>(
    initial
  );
  const latest = useRef(review);
  useLayoutEffect(() => {
    latest.current = review;
  }, [review]);
  useLayoutEffect(() => {
    window.__nativeSmartDappFixture = {
      calls: () => calls,
      expire: () =>
        setReview(
          (current) =>
            current && {
              ...current,
              error: 'TRANSACTION_UNAVAILABLE',
              operation: {
                ...current.operation,
                phase: 'failed',
                payerReview: null,
                error: 'The request expired. Request it again from the app.',
              },
            }
        ),
    };
  }, []);
  const unavailable = () => {
    throw new Error('Outside Smart review fixture');
  };
  const controller: NativeConnectionsView = {
  ...unsupportedDappViews,
    async callsStatusShown() { throw new Error('Calls status is outside this fixture'); },
    dismissCallsStatus() { throw new Error('Calls status is outside this fixture'); },
    getSnapshot: () => ({
      revision: latest.current?.revision ?? 0,
      status: 'ready',
      accounts: [],
      selectedAccountId: null,
      network: null,
      proposals: [],
      sessions: [],
      controlReview: null, sentryReview: null, signingReview: latest.current,
      callsStatus: null,
      error: null,
    }),
    subscribe: unavailable,
    pair: unavailable,
    approve: unavailable,
    reject: unavailable,
    disconnect: unavailable,
    retry: unavailable,
    cancel: unavailable,
    async activateRequestAccount(...args) {
      calls.push({ method: 'activateRequestAccount', args });
      setReview(
        (current) =>
          current && {
            ...current,
            needsAccountSwitch: false,
            revision: current.revision + 1,
          }
      );
    },
    async approveRequest(...args) {
      calls.push({ method: 'approveRequest', args });
      setReview(
        (current) =>
          current && {
            ...current,
            operation: {
              ...current.operation,
              phase: 'review-fee',
              payerReview: {
                id: 3,
                purpose: 'submit-operation',
                coveredFeeUnits: '0',
                maximumFeeUnits: '420000000000000',
                maximumTotalUnits: '420000000000000',
                transaction: {
                  type: 2,
                  chainId: '1',
                  from: payer,
                  to: '0x5555555555555555555555555555555555555555',
                  value: '0',
                  data: '0x1234',
                  nonce: '2',
                  gasLimit: '420000',
                  maxFeePerGas: '1000000000',
                  maxPriorityFeePerGas: '1000000000',
                  accessList: [],
                },
              },
            },
          }
      );
    },
    async confirmSmartPayer(...args) {
      calls.push({ method: 'confirmSmartPayer', args });
      setReview(
        (current) =>
          current && {
            ...current,
            dispatched: true,
            operation: {
              ...current.operation,
              phase: 'complete',
              payerReview: null,
              transactionHash: hash,
            },
          }
      );
    },
    async rejectRequest(...args) {
      calls.push({ method: 'rejectRequest', args });
      setReview(null);
    },
    async chooseTransactionFee() { throw new Error('Fee choices are unavailable for this fixture'); },
    async editApprovalAmount(...args) {
      calls.push({ method: 'editApprovalAmount', args });
      const units = parseApprovalAmount(args[2], metadata.token.decimals);
      if (units === null) throw new Error('Invalid fixture allowance');
      const edited = approvalAbi.encodeFunctionData('approve', [
        spender,
        units,
      ]);
      setReview(
        (current) =>
          current && {
            ...current,
            revision: current.revision + 1,
            approval: summarizeApproval(edited, target, metadata),
            operation: {
              ...current.operation,
              intent: {
                kind: 'dapp-call',
                recipient: target,
                amountUnits: '9',
                data: edited,
              },
              authorization: {
                ...current.operation.authorization!,
                callData: edited,
              },
            },
          }
      );
    },
  };
  return review ? (
    <NativeSmartTransactionReviewScreen
      review={review}
      controller={controller}
    />
  ) : (
    <Text>Request closed</Text>
  );
}
