import React from 'react';
import { FixtureDeviceAuthorization, fixtureDeviceAuthorization } from './fixtureDeviceAuthorization';
import { createLedgerConnectionFixture } from './nativeLedgerConnectionFixture';

import { parseDecimalAmount } from '../../src/core/amounts';
import { getUtxoNetwork } from '../../src/core/utxoNetworks';
import { CustodyRuntimeError } from '../../src/custody/types';
import { NativeUtxoSendScreen } from '../../src/screens/NativeUtxoSend';

import type { NativeUtxoReview, NativeUtxoSend } from '../../src/custody/utxoSend';
import { SYSX_ASSET_DECIMALS, SYSX_ASSET_GUID } from '../../../../source/shared/syscoinAssetIds';

const knownSysx = new URLSearchParams(window.location.search).get('known-icon') === 'sysx';
const asset = knownSysx ? { assetGuid: SYSX_ASSET_GUID, decimals: SYSX_ASSET_DECIMALS, symbol: 'SYSX' } : undefined;
const network = getUtxoNetwork(knownSysx ? 'syscoin' : 'bitcoin');
const recipient = knownSysx ? 'sys1qpqyqszqgpqyqszqgpqyqszqgpqyqszqgzp6ll8' : 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const txid = 'a'.repeat(64);
const ledgerConnection = new URLSearchParams(window.location.search).has('ledger-send') ? createLedgerConnectionFixture(recipient) : undefined;
let confirmations = 0, opens = 0, expired = false;
window.__nativeUtxoLedgerFixture = { confirmations: () => confirmations, opens: () => opens, expire: () => { expired = true; }, attemptPreviousReview: async () => { throw Error('NOT_READY'); }, attemptInvalidPreparation: async () => { throw Error('NOT_READY'); } };
declare global { interface Window { __nativeUtxoLedgerFixture: { confirmations(): number; opens(): number; expire(): void; attemptPreviousReview(): Promise<void>; attemptInvalidPreparation(): Promise<void>; }; } }
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
  let revision = 0;
  const prepared = new WeakMap<NativeUtxoReview, number>();
  let currentReview: NativeUtxoReview | undefined;
  let previousReview: NativeUtxoReview | undefined;
  const beginPreparation = () => {
    revision++; owner?.abort(); owner = undefined;
    previousReview = currentReview;
    currentReview = undefined;
  };
  const remember = (view: NativeUtxoReview) => {
    currentReview = view;
    prepared.set(view, revision);
    return view;
  };
  let saved = !expireAfterSave;
  let seen = false;
  const send: NativeUtxoSend = {
    cancel() { revision++; owner?.abort(); },
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
      beginPreparation();
      try {
        if (input.recipient !== recipient) throw new Error('Invalid recipient');
        const amount = parseDecimalAmount(input.amount, network.decimals);
        return remember({
          ...request,
          outputs: [
            { address: recipient, amountSatoshis: asset ? '294' : amount.toString(), ...(asset ? { asset: { assetGuid: asset.assetGuid, rawAmount: amount.toString() } } : {}) },
            request.outputs[1]!,
          ],
        });
      } catch {
        throw new CustodyRuntimeError('INVALID_INPUT');
      }
    },
    async prepareRetry() {
      assertCurrent();
      beginPreparation();
      return remember({
        ...request,
        ...(options.has('alternate-provider')
          ? { retryProviderOrigin: 'https://previous-provider.example:8443' }
          : {}),
        retryTxid: txid,
      });
    },
    async confirm(review, credential) {
      assertCurrent();
      const approvedRevision = revision;
      if (credential.method !== 'device' || prepared.get(review) !== approvedRevision || review !== currentReview || expired || owner) throw Error('CANCELLED');
      const current = new AbortController(); owner = current;
      const check = () => { assertCurrent(); if (revision !== approvedRevision || owner !== current || current.signal.aborted) throw Error('CANCELLED'); };
      try { await fixtureDeviceAuthorization.request('transaction', current.signal, check); check(); }
      finally { if (owner === current) owner = undefined; }
      if (expired) throw new CustodyRuntimeError('CANCELLED');
      currentReview = undefined;
      confirmations++;
      saved = true;
      if (expireAfterSave) throw new CustodyRuntimeError('CANCELLED');
      seen = true;
      return { txid };
    },
  };
  window.__nativeUtxoLedgerFixture.attemptPreviousReview = async () => {
    if (!previousReview) throw Error('NOT_READY');
    await send.confirm(previousReview, { method: 'device' });
  };
  window.__nativeUtxoLedgerFixture.attemptInvalidPreparation = async () => {
    await send.prepare({ recipient: 'invalid', amount: '0.1' });
  };
  return send;
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
