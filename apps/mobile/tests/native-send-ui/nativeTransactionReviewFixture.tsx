import { unsupportedDappViews } from '../unsupportedDappPorts';
import React, { useLayoutEffect, useRef, useState } from 'react';
import type { NativeConnectionsView, NativeTransactionReview } from '../../src/connections/types';
import { NativeTransactionReviewScreen } from '../../src/screens/NativeTransactionReview';
import { Text } from '../../src/ui';
import { Interface } from 'ethers/abi';
import { getEffectiveApprovalData, summarizeApproval, type ApprovalContractMetadata } from '../../../../source/shared/approval';
import { decodeAssetTransfer } from '../../../../source/shared/assetTransfer';

const query = new URLSearchParams(window.location.search);
const approvalKind = query.get('approval');
const knownUsdc = query.get('known-icon') === 'usdc';
const transferKind = query.get('transfer-kind') ?? (knownUsdc ? 'erc20' : null);
const tokenContract = knownUsdc ? '0xd501e86b1fc5823403b2ba995e2b8b78179236a6' : '0x3333333333333333333333333333333333333333';
const chainId = knownUsdc ? '57057' : '743211';
const spender = '0x4444444444444444444444444444444444444444';
const approvalAbi = new Interface(['function approve(address spender,uint256 amount)', 'function setApprovalForAll(address operator,bool approved)']);
const approvalData = approvalKind === 'operator' ? approvalAbi.encodeFunctionData('setApprovalForAll', [spender, false])
  : approvalAbi.encodeFunctionData('approve', [spender, (1n << 256n) - 1n]);
const metadata: ApprovalContractMetadata | undefined = approvalKind === 'erc20'
  ? { standard: 'ERC-20', token: { contractAddress: tokenContract, name: 'Example token', symbol: 'TOK', decimals: 6 } }
  : approvalKind === 'nft' ? { standard: 'ERC-721' }
  : approvalKind === 'operator' ? { standard: 'ERC-1155' } : undefined;
const transferAbi = new Interface(['function transfer(address to,uint256 amount)',
  'function safeTransferFrom(address from,address to,uint256 tokenId)',
  'function safeBatchTransferFrom(address from,address to,uint256[] ids,uint256[] amounts,bytes data)']);
const transferMetadata: ApprovalContractMetadata | undefined = transferKind === 'erc20'
  ? { standard: 'ERC-20', token: { contractAddress: tokenContract, name: knownUsdc ? 'USD Coin' : 'Example token', symbol: knownUsdc ? 'USDC' : 'TOK', decimals: 6 } }
  : transferKind === 'erc721' ? { standard: 'ERC-721' } : transferKind === 'erc1155' ? { standard: 'ERC-1155' } : undefined;
const transferData = transferKind === 'erc20' ? transferAbi.encodeFunctionData('transfer', [spender, '123456789'])
  : transferKind === 'erc721' ? transferAbi.encodeFunctionData('safeTransferFrom', ['0x2222222222222222222222222222222222222222', spender, '42'])
  : transferKind === 'erc1155' ? transferAbi.encodeFunctionData('safeBatchTransferFrom', ['0x2222222222222222222222222222222222222222', spender, ['7', '42'], ['2', '3'], '0x']) : '0xabcdef';
const transferValue = transferKind === 'unknown' ? '1234567890000000' : transferKind ? '0' : '1234567890123456789012345';
const initialReview: NativeTransactionReview = {
  feeComparison: query.has('fees')
    ? {
        maxFeePerGas: { requested: '10', recommended: '20' },
        ...(query.get('fees') === 'adjusted'
          ? { gasLimit: { requested: '21000', recommended: '25200' } }
          : {}),
        recommendationOnly: query.get('fees') !== 'adjusted',
      }
    : null,
  feeChoice: null,
  kind: 'transaction', method: 'eth_sendTransaction', id: 'transaction-1', revision: 7,
  appName: 'Example app', origin: 'https://example.invalid', accountLabel: 'Savings',
  address: '0x2222222222222222222222222222222222222222', networkLabel: knownUsdc ? 'zkSYS Tanenbaum Testnet' : 'Custom network',
  chainId, symbol: knownUsdc ? 'TSYS' : 'COIN', decimals: 18, expiresAt: Date.now() + 300000,
  transaction: query.has('preparing') ? null : {
    type: 2, from: '0x2222222222222222222222222222222222222222',
    to: query.has('deployment') ? null : tokenContract,
    chainId, value: transferValue, gasLimit: '25200',
    maxFeePerGas: '10', maxPriorityFeePerGas: '1', nonce: '3',
    data: transferKind ? transferData : approvalKind ? approvalData : query.has('large-data') ? '0x' + 'ab'.repeat(8192) + 'cd' : '0xabcdef',
    accessList: [{ address: '0x4444444444444444444444444444444444444444', storageKeys: ['0x' + '5'.repeat(64)] }],
  },
  maximumFeeUnits: query.has('preparing') ? null : '252000',
  maximumTotalUnits: query.has('preparing') ? null : (BigInt(transferValue) + 252000n).toString(),
  ...(transferKind ? { assetTransfer: decodeAssetTransfer(transferData, tokenContract, transferMetadata) } : {}),
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
    __nativeTransactionReviewFixture: { calls(): typeof calls; revise(): void; expire(): void; releaseFeeChoice(): void };
  }
}

export function NativeTransactionReviewFixture() {
  const releaseFeeChoice = useRef<(() => void) | null>(null);
  const [review, setReview] = useState<NativeTransactionReview | null>(initialReview);
  useLayoutEffect(() => {
    window.__nativeTransactionReviewFixture = {
      calls: () => calls,
      releaseFeeChoice: () => releaseFeeChoice.current?.(),
      expire: () => setReview((current) => current && { ...current, revision: current.revision + 1, expiresAt: Date.now() - 1, error: 'TRANSACTION_UNAVAILABLE' }),
      revise: () => setReview((current) => current && { ...current, revision: current.revision + 1 }),
    };
  }, []);
  const unavailable = () => { throw new Error('Outside transaction review fixture'); };
  const controller: NativeConnectionsView = {
    isRequestAuthenticating: () => false,
  ...unsupportedDappViews,
    async callsStatusShown() { throw new Error('Calls status is outside this fixture'); },
    dismissCallsStatus() { throw new Error('Calls status is outside this fixture'); },
    async retrySmartMetadata() { throw new Error('Smart metadata refresh is outside this fixture'); },
    async confirmSmartPayer() { throw new Error('No Smart payer review in this fixture'); },
    async chooseTransactionFee(...args) {
      calls.push({ method: 'chooseTransactionFee', args });
      setReview(
        (current) =>
          current && { ...current, revision: current.revision + 1, busy: true }
      );
      if (query.has('hold-fee'))
        await new Promise<void>((resolve) => {
          releaseFeeChoice.current = resolve;
        });
      setReview((current) =>
        current && current.error === null
          ? {
              ...current,
              revision: current.revision + 1,
              busy: false,
              feeChoice: query.has('raise-after-choice') ? null : args[2],
              feeComparison: query.has('raise-after-choice')
                ? {
                    gasLimit: { requested: '25200', recommended: '30000' },
                    recommendationOnly: false,
                  }
                : current.feeComparison,
              maximumFeeUnits: query.has('raise-after-choice')
                ? '600000'
                : args[2] === 'network'
                ? '504000'
                : '252000',
              maximumTotalUnits: query.has('raise-after-choice')
                ? '1234567890123456789612345'
                : args[2] === 'network'
                ? '1234567890123456789516345'
                : '1234567890123456789264345',
              transaction: current.transaction && {
                ...current.transaction,
                gasLimit: query.has('raise-after-choice')
                  ? '30000'
                  : current.transaction.gasLimit,
                maxFeePerGas: args[2] === 'network' ? '20' : '10',
              },
            }
          : current
      );
    },
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
    getSnapshot: () => ({ revision: review?.revision ?? 0, status: 'ready', pairingExpiresAt: null, accounts: [], selectedAccountId: null,
      network: null, proposals: [], sessions: [], preparationReview: null, controlReview: null, sentryReview: null, psbtReview: null, signingReview: review, callsStatus: null, error: null }),
    subscribe: unavailable, pair: unavailable, approve: unavailable,
    reject: unavailable, disconnect: unavailable, retry: unavailable, cancel: unavailable,
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
