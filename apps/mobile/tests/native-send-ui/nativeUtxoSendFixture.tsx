import React from 'react';

import { parseDecimalAmount } from '../../src/core/amounts';
import { getUtxoNetwork } from '../../src/core/utxoNetworks';
import { CustodyRuntimeError } from '../../src/custody/types';
import { NativeUtxoSendScreen } from '../../src/screens/NativeUtxoSend';

import type { NativeUtxoSend } from '../../src/custody/utxoSend';

const network = getUtxoNetwork('bitcoin');
const recipient = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const txid = 'a'.repeat(64);
const request = {
  feeSatoshis: '452',
  outputs: [
    { address: recipient, amountSatoshis: '123456789' },
    { address: '1BoatSLRHtKNngkdXEeobR76b53LETtpyT', amountSatoshis: '500' },
  ],
};

async function open(assertCurrent: () => void): Promise<NativeUtxoSend> {
  const expireAfterSave = new URLSearchParams(window.location.search).has(
    'saved-before-expiry'
  );
  let saved = !expireAfterSave;
  let seen = false;
  return {
    cancel() {},
    async list() {
      return saved ? [{ txid, accepted: false }] : [];
    },
    async check() {
      return seen ? 'seen' : 'unknown';
    },
    async prepare(input) {
      assertCurrent();
      try {
        if (input.recipient !== recipient) throw new Error('Invalid recipient');
        const amount = parseDecimalAmount(input.amount, network.decimals);
        return {
          ...request,
          outputs: [
            { address: recipient, amountSatoshis: amount.toString() },
            request.outputs[1]!,
          ],
        };
      } catch {
        throw new CustodyRuntimeError('INVALID_INPUT');
      }
    },
    async prepareRetry() {
      return { ...request, retryTxid: txid };
    },
    async confirm() {
      assertCurrent();
      saved = true;
      if (expireAfterSave) throw new CustodyRuntimeError('CANCELLED');
      seen = true;
      return { txid };
    },
  };
}

export function NativeUtxoSendFixture() {
  return (
    <NativeUtxoSendScreen
      accountLabel="Account 1"
      network={network}
      open={open}
      onBack={() => undefined}
    />
  );
}
