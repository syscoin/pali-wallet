import { freshSmartOperationDeadline } from '../nonSuiteSigningHandoff.ts';
import { buildSmartAccountNftTransfer } from '../../../../source/utils/smartAccount/nftTransfer';
import { snapshotNftTransferIntent } from '../../../../source/shared/nftTransfer';
import type { SavedCollectible } from '../../src/portfolio/tokenRegistry';
import { buildSmartAccountErc20Transfer } from '../../../../source/utils/smartAccount/erc20Transfer';
import { parseTokenAmount } from '../../../../source/shared/erc20';
import type { NativeTokenSnapshot } from '../../src/portfolio/nativeTokens';
import { prepareSmartAccountNativeMaximum } from '../../../../source/utils/smartAccount/nativeMaximum';
import React, { useState } from 'react';
import { NativeSmartAccountSend } from '../../src/screens/NativeSmartAccountSend';
import { NativeSmartAccountOperation } from '../../src/smartAccount/operation';
import type {
  NativeSmartAccountAmount,
  PreparedSmartAccountOperation,
} from '../../src/smartAccount/operation';
import {
  getNativeNetwork,
  getNativeSendContext,
} from '../../src/custody/networkContext';
import { parseDecimalAmount } from '../../src/core/amounts';
import { normalizePublicAddress } from '../../src/core/addresses';
import type { PublicCustodySource } from '../../src/portfolio/nativePortfolio';
import type { BalanceReader } from '../../src/core/watchOnlyAuthority';
import { Text } from '../../src/ui';

const query = new URLSearchParams(window.location.search);
const account = '0x1111111111111111111111111111111111111111';
const payer = '0x2222222222222222222222222222222222222222';
const hash = '0x' + 'ab'.repeat(32);
const calls: { method: string; value?: string }[] = [];
const network = getNativeNetwork('ethereum');
const token = query.has('token')
  ? {
      contractAddress: '0x5555555555555555555555555555555555555555',
      name: 'Example token',
      symbol: 'TOK',
      decimals: query.has('max-token-dust') ? 255 : 6,
    }
  : undefined;
const collectible: SavedCollectible | undefined =
  query.get('nft') === '721'
    ? {
        contractAddress: '0x6666666666666666666666666666666666666666',
        tokenStandard: 'ERC-721',
      }
    : query.get('nft') === '1155'
    ? {
        contractAddress: '0x6666666666666666666666666666666666666666',
        tokenStandard: 'ERC-1155',
        tokenId: '7',
      }
    : undefined;
const tokenSnapshot: NativeTokenSnapshot = {
  account: { address: account, network: network.id, revision: 1 },
  status: 'ready',
  items: token
    ? [
        {
          metadata: token,
          status: 'available',
          units: query.has('max-token-dust') ? '1' : '100000000',
          updatedAt: 0,
        },
      ]
    : [],
  preview: null,
  previewStatus: 'idle',
  discovery: null,
  busy: false,
  error: null,
};
const tokenView = {
  getSnapshot: () => tokenSnapshot,
  subscribe: () => () => {},
  connect: () => () => {},
};

const source: PublicCustodySource = {
  getSnapshot: () => ({
    phase: 'ready',
    revision: 1,
    presence: 'existing',
    backup: 'confirmed',
    account: { address: account, network: network.id },
    error: null,
  }),
  getCatalogue: () => null,
  subscribe: () => () => {},
};
const reader: BalanceReader = {
  async readBalance() {
    if (query.has('balance-unavailable'))
      throw new Error('Fixture unavailable');
    return { chainId: 1, units: '5000000000000000000' };
  },
};
function open(
  recipient: string,
  amount: NativeSmartAccountAmount,
  assertCurrent: () => void
) {
  try {
    recipient = normalizePublicAddress(recipient, 'ethereum');
    const nft =
      amount.kind === 'nft'
        ? snapshotNftTransferIntent({
            kind: 'nft-transfer',
            chainId: network.chainId,
            from: account,
            contractAddress: amount.collectible.contractAddress,
            tokenStandard: amount.collectible.tokenStandard,
            recipient,
            tokenId: amount.tokenId,
            amountUnits: amount.amountUnits,
          })
        : undefined;
    const amountUnits = nft
      ? nft.amountUnits
      : amount.kind === 'exact'
      ? parseDecimalAmount(amount.amount, 18).toString()
      : amount.kind === 'erc20' && token
      ? parseTokenAmount(amount.amount, token.decimals)
      : null;
    calls.push({ method: 'open', value: amountUnits ?? 'maximum' });
    return Promise.resolve(
      new NativeSmartAccountOperation({ background() {}, authorizationExpiresAt: freshSmartOperationDeadline(),
        account,
        network,
        intent:
          nft ??
          (amount.kind === 'erc20' && token
            ? {
                kind: 'erc20-transfer',
                recipient,
                token,
                amountUnits: amountUnits!,
              }
            : amountUnits === null
            ? { kind: 'native-max', recipient }
            : { kind: 'native-transfer', recipient, amountUnits }),
        assertCurrent,
        async prepare() {
          if (query.has('prepare-unavailable'))
            throw new Error('Fixture unavailable');
          const maximum =
            amountUnits === null
              ? await prepareSmartAccountNativeMaximum({
                  target: recipient,
                  assertCurrent,
                  readBalance: async () => '5000000000000000000',
                  quote: async (execution) => ({
                    quote: execution.value,
                    maximumFeeUnits: '210000000000000',
                  }),
                })
              : null;
          const value = maximum
            ? BigInt(maximum.execution.value).toString()
            : amountUnits!;
          const execution = nft
            ? buildSmartAccountNftTransfer(nft)
            : amount.kind === 'erc20' && token
            ? buildSmartAccountErc20Transfer(
                token.contractAddress,
                recipient,
                value
              )
            : { target: recipient, data: '0x', value };
          return {
            kind: 'authorization',
            intent:
              nft ??
              (amount.kind === 'erc20' && token
                ? {
                    kind: 'erc20-transfer',
                    recipient,
                    token,
                    amountUnits: value,
                  }
                : { kind: 'native-transfer', recipient, amountUnits: value }),
            operation: {
              execution,
              executions: [execution],
              actionHash: hash,
              userOperation: {
                nonce: '7',
                initCode: '0x',
                callData: '0x1234',
                accountGasLimits:
                  '0x' +
                  ((100000n << 128n) | 100000n).toString(16).padStart(64, '0'),
                gasFees:
                  '0x' +
                  ((1000000000n << 128n) | 1000000000n)
                    .toString(16)
                    .padStart(64, '0'),
                preVerificationGas: '10000',
                paymasterAndData: '0x',
              },
            } as PreparedSmartAccountOperation,
          };
        },
        async sign() {
          calls.push({ method: 'authorize' });
          return '0x1234';
        },
        async submit(
          _prepared,
          _signature,
          _signal,
          guard,
          review,
          onBroadcast
        ) {
          guard();
          await review(
            {
              purpose: 'submit-operation',
              coveredFeeUnits: '0',
              maximumFeeUnits: '420000000000000',
              maximumTotalUnits: '420000000000000',
              transaction: {
                from: payer,
                to: '0x3333333333333333333333333333333333333333',
                chainId: '1',
                nonce: '8',
                value: '0',
                data: '0x1234',
                type: 2,
                gasLimit: '210000',
                maxFeePerGas: '2000000000',
                maxPriorityFeePerGas: '1000000000',
                accessList: [],
              },
            },
            guard
          );
          guard();
          calls.push({ method: 'submit' });
          onBroadcast(hash, 'submit-operation');
          return hash;
        },
      })
    );
  } catch {
    return Promise.reject(new Error('INVALID_INPUT'));
  }
}
window.__nativeSmartCurrencyFixture = {
  calls: () => calls.map((call) => ({ ...call })),
};
declare global {
  interface Window {
    __nativeSmartCurrencyFixture: { calls(): typeof calls };
  }
}
export function NativeSmartCurrencyFixture() {
  const [closed, setClosed] = useState(false);
  return closed ? (
    <Text>Smart transfer closed</Text>
  ) : (
    <NativeSmartAccountSend
      account={{ address: account, network: network.id, revision: 1 }}
      open={open}
      feeRecommendations={async () => ({ type: 2, maxFeePerGas: '2000000000', maxPriorityFeePerGas: '1000000000' })}
      token={token}
      collectible={collectible}
      tokenView={tokenView}
      source={source}
      reader={reader}
      context={getNativeSendContext(network)}
      accountLabel="Smart account"
      onBack={() => setClosed(true)}
    />
  );
}
