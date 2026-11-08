import React, { useState } from 'react';
import { NativeSmartAccountSend } from '../../src/screens/NativeSmartAccountSend';
import { NativeSmartAccountOperation } from '../../src/smartAccount/operation';
import type { PreparedSmartAccountOperation } from '../../src/smartAccount/operation';
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
function open(recipient: string, amount: string, assertCurrent: () => void) {
  try {
    recipient = normalizePublicAddress(recipient, 'ethereum');
    const amountUnits = parseDecimalAmount(amount, 18).toString();
    calls.push({ method: 'open', value: amountUnits });
    return Promise.resolve(
      new NativeSmartAccountOperation({
        account,
        network,
        intent: { kind: 'native-transfer', recipient, amountUnits },
        assertCurrent,
        async prepare() {
          if (query.has('prepare-unavailable'))
            throw new Error('Fixture unavailable');
          return {
            kind: 'authorization',
            operation: {
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
              coveredFeeUnits: '0', maximumFeeUnits: '420000000000000',
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
          onBroadcast(hash);
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
      open={open}
      source={source}
      reader={reader}
      context={getNativeSendContext(network)}
      accountLabel="Smart account"
      onBack={() => setClosed(true)}
    />
  );
}
