import React from 'react';
import { FixtureDeviceAuthorization, fixtureDeviceAuthorization } from './fixtureDeviceAuthorization';
import { createLedgerConnectionFixture } from './nativeLedgerConnectionFixture';

import { parseDecimalAmount } from '../../src/core/amounts';
import { getUtxoNetwork } from '../../src/core/utxoNetworks';
import { CustodyRuntimeError } from '../../src/custody/types';
import { NativeUtxoSendScreen } from '../../src/screens/NativeUtxoSend';

import type { NativeUtxoSend } from '../../src/custody/utxoSend';
import { SYSX_ASSET_DECIMALS, SYSX_ASSET_GUID } from '../../../../source/shared/syscoinAssetIds';

const knownSysx = new URLSearchParams(window.location.search).get('known-icon') === 'sysx';
const asset = knownSysx ? { assetGuid: SYSX_ASSET_GUID, decimals: SYSX_ASSET_DECIMALS, symbol: 'SYSX' } : undefined;
const network = getUtxoNetwork(knownSysx ? 'syscoin' : 'bitcoin');
const recipient = knownSysx ? 'sys1qpqyqszqgpqyqszqgpqyqszqgpqyqszqgzp6ll8' : 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const txid = 'a'.repeat(64);
const ledgerConnection = new URLSearchParams(window.location.search).has('ledger-send') ? createLedgerConnectionFixture(recipient) : undefined;
let confirmations = 0, opens = 0, expired = false;
window.__nativeUtxoLedgerFixture = { confirmations: () => confirmations, opens: () => opens, expire: () => { expired = true; } };
declare global { interface Window { __nativeUtxoLedgerFixture: { confirmations(): number; opens(): number; expire(): void; }; } }
const request = {
  transactionOptions: { rbf: true },
  feeSatoshis: '452',
  ...(asset ? { assetDisplay: asset } : {}),
  outputs: [
    { address: recipient, amountSatoshis: asset ? '294' : '123456789', ...(asset ? { asset: { assetGuid: asset.assetGuid, rawAmount: '123456789' } } : {}) },
    { address: knownSysx ? 'sys1qqurswpc8qurswpc8qurswpc8qurswpc8degtm7' : '1BoatSLRHtKNngkdXEeobR76b53LETtpyT', amountSatoshis: '500' },
  ],
};

async function open(assertCurrent: () => void): Promise<NativeUtxoSend> {
  opens++;
  const options = new URLSearchParams(window.location.search);
  const expireAfterSave = options.has('saved-before-expiry');
  let owner: AbortController | undefined;
  let cancelled = false;
  let saved = !expireAfterSave;
  let seen = false;
  return {
    cancel() { cancelled = true; owner?.abort(); },
    async list() {
      return saved ? [{ txid, accepted: false }] : [];
    },
    async refreshSaved() {
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
            { address: recipient, amountSatoshis: asset ? '294' : amount.toString(), ...(asset ? { asset: { assetGuid: asset.assetGuid, rawAmount: amount.toString() } } : {}) },
            request.outputs[1]!,
          ],
        };
      } catch {
        throw new CustodyRuntimeError('INVALID_INPUT');
      }
    },
    async prepareRetry() {
      return {
        ...request,
        ...(options.has('alternate-provider')
          ? { retryProviderOrigin: 'https://previous-provider.example:8443' }
          : {}),
        retryTxid: txid,
      };
    },
    async confirm(_review, credential) {
      assertCurrent();
      if (credential.method !== 'device' || cancelled) throw Error('CANCELLED');
      const current = new AbortController(); owner = current;
      const check = () => { assertCurrent(); if (cancelled || owner !== current || current.signal.aborted) throw Error('CANCELLED'); };
      try { await fixtureDeviceAuthorization.request('transaction', current.signal, check); check(); }
      finally { if (owner === current) owner = undefined; }
      if (expired) throw new CustodyRuntimeError('CANCELLED');
          confirmations++;
      saved = true;
      if (expireAfterSave) throw new CustodyRuntimeError('CANCELLED');
      seen = true;
      return { txid };
    },
  };
}

export function NativeUtxoSendFixture() {
  return (
    <><NativeUtxoSendScreen
      ledgerConnection={ledgerConnection}
      accountLabel="Account 1"
      network={network}
      asset={asset}
      open={open}
      onBack={() => undefined}
    /><FixtureDeviceAuthorization /></>
  );
}
