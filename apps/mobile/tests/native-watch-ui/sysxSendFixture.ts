import {
  SYSX_ASSET_DECIMALS,
  SYSX_ASSET_GUID,
} from '../../../../source/shared/syscoinAssetIds.ts';
import { UTXO_NETWORKS } from '../../src/core/utxoNetworks.ts';
import type {
  NativeUtxoReview,
  NativeUtxoSend,
} from '../../src/custody/utxoSend.ts';
import { json, metadata, UTXO_ADDRESSES } from '../publicWatchFixtures.ts';

const owner = UTXO_ADDRESSES.syscoin;
const second = 'sys1qqcrqvpsxqcrqvpsxqcrqvpsxqcrqvpsxvff23l';
const recipient = 'sys1qpqyqszqgpqyqszqgpqyqszqgpqyqszqgzp6ll8';
const change = 'sys1qqurswpc8qurswpc8qurswpc8qurswpc8degtm7';
const asset = Object.freeze({
  assetGuid: SYSX_ASSET_GUID,
  decimals: SYSX_ASSET_DECIMALS,
  symbol: 'SYSX',
});
const view = Object.freeze<NativeUtxoReview>({
  transactionOptions: { rbf: true, zdag: false },
  feeSatoshis: '452',
  assetDisplay: asset,
  outputs: Object.freeze([
    Object.freeze({
      address: recipient,
      amountSatoshis: '294',
      asset: { assetGuid: asset.assetGuid, rawAmount: '12345678' },
    }),
    Object.freeze({
      address: change,
      amountSatoshis: '90000',
      asset: { assetGuid: asset.assetGuid, rawAmount: '187654322' },
    }),
  ]),
});
const counts = { prepares: 0, late: 0, confirmations: 0, cancellations: 0 };
let held = false;
let release: (() => void) | undefined;

export const sysxSendFixture = {
  enabled: new URLSearchParams(window.location.search).has('sysx-utxo-send'),
  owner,
  second,
  recipient,
  hold() {
    held = true;
  },
  release() {
    const resume = release;
    release = undefined;
    resume?.();
  },
  audit: () => ({ ...counts }),
  async fetch(input: RequestInfo | URL, init?: RequestInit) {
    const url = String(input);
    const network = UTXO_NETWORKS.find(({ endpoint }) =>
      url.startsWith(endpoint + '/')
    );
    if (!network || init?.method !== 'GET')
      throw Error('Unexpected SYSX fixture request');
    const path = url.slice(network.endpoint.length);
    if (path === '/api/v2/') return json(metadata(network));
    if (path === '/api/v2/block-index/0')
      return json({ blockHash: network.genesisHash });
    const match =
      /^\/api\/v2\/address\/([^?]+)\?details=tokenBalances&tokens=nonzero$/.exec(
        path
      );
    if (!match) throw Error('Unexpected SYSX fixture path');
    const address = decodeURIComponent(match[1]!);
    return json({
      address,
      balance: '100000',
      unconfirmedBalance: '0',
      txs: 1,
      unconfirmedTxs: 0,
      tokensAsset:
        address === owner
          ? [
              {
                assetGuid: asset.assetGuid,
                symbol: asset.symbol,
                balance: '200000000',
                decimals: asset.decimals,
              },
            ]
          : [],
    });
  },
  open(check: () => void): NativeUtxoSend {
    check();
    let revision = 0;
    const unused = async () => {
      throw Error('The SYSX screen fixture does not sign or submit');
    };
    return {
      cancel() {
        revision++;
        counts.cancellations++;
      },
      async list() {
        check();
        return [];
      },
      async refreshSaved() {
        check();
        return [];
      },
      async prepare(input) {
        check();
        const owned = revision;
        counts.prepares++;
        if (
          input.recipient !== recipient ||
          input.amount !== '0.12345678' ||
          input.asset?.assetGuid !== asset.assetGuid ||
          input.asset.decimals !== asset.decimals ||
          input.max
        )
          throw Error('INVALID_INPUT');
        if (held) {
          held = false;
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          try {
            check();
            if (owned !== revision) throw Error('CANCELLED');
          } catch {
            counts.late++;
          }
          // Deliver a late result anyway. The actual screen must refuse it.
        }
        return view;
      },
      async confirm() {
        counts.confirmations++;
        return unused();
      },
      prepareRetry: unused,
      check: unused,
    };
  },
};
