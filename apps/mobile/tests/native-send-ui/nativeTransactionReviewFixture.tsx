import React, { useLayoutEffect, useState } from 'react';
import type { NativeConnectionsView, NativeTransactionReview } from '../../src/connections/types';
import { NativeTransactionReviewScreen } from '../../src/screens/NativeTransactionReview';
import { Text } from '../../src/ui';
import { Interface } from 'ethers/abi';
import { getEffectiveApprovalData, summarizeApproval, type ApprovalContractMetadata } from '../../../../source/shared/approval';

const query = new URLSearchParams(window.location.search);
const approvalKind = query.get('approval');
const tokenContract = '0x3333333333333333333333333333333333333333';
const spender = '0x4444444444444444444444444444444444444444';
const approvalAbi = new Interface(['function approve(address spender,uint256 amount)', 'function setApprovalForAll(address operator,bool approved)']);
const approvalData = approvalKind === 'operator' ? approvalAbi.encodeFunctionData('setApprovalForAll', [spender, false])
  : approvalAbi.encodeFunctionData('approve', [spender, (1n << 256n) - 1n]);
const metadata: ApprovalContractMetadata | undefined = approvalKind === 'erc20'
  ? { standard: 'ERC-20', token: { contractAddress: tokenContract, name: 'Example token', symbol: 'TOK', decimals: 6 } }
  : approvalKind === 'nft' ? { standard: 'ERC-721' }
  : approvalKind === 'operator' ? { standard: 'ERC-1155' } : undefined;
const initialReview: NativeTransactionReview = {
  kind: 'transaction', method: 'eth_sendTransaction', id: 'transaction-1', revision: 7,
  appName: 'Example app', origin: 'https://example.invalid', accountLabel: 'Savings',
  address: '0x2222222222222222222222222222222222222222', networkLabel: 'Custom network',
  chainId: '743211', symbol: 'COIN', decimals: 18, expiresAt: Date.now() + 300000,
  transaction: query.has('preparing') ? null : {
    type: 2, from: '0x2222222222222222222222222222222222222222',
    to: query.has('deployment') ? null : '0x3333333333333333333333333333333333333333',
    chainId: '743211', value: '1234567890123456789012345', gasLimit: '25200',
    maxFeePerGas: '10', maxPriorityFeePerGas: '1', nonce: '3',
    data: approvalKind ? approvalData : query.has('large-data') ? '0x' + 'ab'.repeat(8192) + 'cd' : '0xabcdef',
    accessList: [{ address: '0x4444444444444444444444444444444444444444', storageKeys: ['0x' + '5'.repeat(64)] }],
  },
  maximumFeeUnits: query.has('preparing') ? null : '252000',
  maximumTotalUnits: query.has('preparing') ? null : '1234567890123456789264345',
  error: query.has('invalid-origin') ? 'SITE_MISMATCH' : query.has('uncertain') ? 'DELIVERY_UNCERTAIN' : null,
  verification: { validation: query.has('invalid-origin') ? 'INVALID' : 'VALID', isScam: false },
  busy: query.has('preparing') || query.has('broadcasting'), needsAccountSwitch: query.has('switch'),
  dispatched: query.has('uncertain'),
  broadcastHash: query.has('uncertain') || query.has('broadcasting') ? '0x' + '6'.repeat(64) : null,
  advisories: query.has('warning') ? [{ address: '0x3333333333333333333333333333333333333333', field: 'spender', severity: 'high', reason: 'Known unsafe recipient' }] : [],
  requiresWarningAcknowledgement: query.has('warning'),
  approval: approvalKind ? summarizeApproval(approvalData, tokenContract, metadata) : null,
};
const calls: { method: string; args: unknown[] }[] = [];

declare global {
  interface Window {
    __nativeTransactionReviewFixture: { calls(): typeof calls; revise(): void };
  }
}

export function NativeTransactionReviewFixture() {
  const [review, setReview] = useState<NativeTransactionReview | null>(initialReview);
  useLayoutEffect(() => {
    window.__nativeTransactionReviewFixture = {
      calls: () => calls,
      revise: () => setReview((current) => current && { ...current, revision: current.revision + 1 }),
    };
  }, []);
  const unavailable = () => { throw new Error('Outside transaction review fixture'); };
  const controller: NativeConnectionsView = {
    async editApprovalAmount(...args) {
      calls.push({ method: 'editApprovalAmount', args });
      const current = review, summary = current?.approval;
      if (!current?.transaction || !summary?.token) throw new Error('Missing approval');
      const edited = getEffectiveApprovalData({ tokenStandard: summary.tokenStandard, approvalType: summary.approvalType, customAmount: args[2],
        data: current.transaction.data, decimals: summary.token.decimals, isCustom: true,
        decodedTx: { method: summary.method, inputs: [summary.authority, summary.amountUnits], names: ['spender', 'amount'], types: ['address', 'uint256'] } });
      if (!edited) throw new Error('Invalid allowance');
      setReview({ ...current, revision: current.revision + 1, transaction: { ...current.transaction, data: edited.data },
        approval: summarizeApproval(edited.data, tokenContract, metadata) });
    },
    getSnapshot: unavailable, subscribe: unavailable, pair: unavailable, approve: unavailable,
    reject: unavailable, disconnect: unavailable, cancel: unavailable,
    async activateRequestAccount(...args) {
      calls.push({ method: 'activateRequestAccount', args });
      setReview((current) => current && { ...current, revision: current.revision + 1, needsAccountSwitch: false });
    },
    async approveRequest(...args) {
      calls.push({ method: 'approveRequest', args });
      setReview(null);
    },
    async rejectRequest(...args) {
      calls.push({ method: 'rejectRequest', args });
      setReview(null);
    },
  };
  return review ? <NativeTransactionReviewScreen key={review.id} review={review} controller={controller} /> : <Text>Request completed</Text>;
}
