import { utils as sys } from 'syscoinjs-lib';

import {
  createUtxoFixture,
  fixtureRead,
  UTXO_FIXTURE_PATH,
} from './utxoFixture';
import type { BrowserContext } from '@playwright/test';

// The package exposes CommonJS and has no TypeScript declarations.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const txlib = require('syscointx-js');
export const SPT_GUID = '123457';
export const SPT_SYMBOL = 'TSPT';
export const SPT_BALANCE_UNITS = '9007199254740993';
export const SPT_BALANCE = '90071992.54740993';
export const SPT_BELOW_MAX = '90071992.54740992';

export function createSptFixture() {
  const base = createUtxoFixture(),
    bitcoin = sys.bitcoinjs;
  const parent = new bitcoin.Transaction();
  parent.version = 142;
  parent.addInput(Buffer.alloc(32, 23), 0);
  parent.addOutput(
    bitcoin.address.toOutputScript(
      base.userAddress,
      sys.syscoinNetworks.testnet
    ),
    BigInt(100000)
  );
  const allocation = txlib.bufferUtils.serializeAssetAllocations([
    {
      assetGuid: SPT_GUID,
      values: [{ n: 0, value: new sys.BN(SPT_BALANCE_UNITS) }],
    },
  ]);
  parent.addOutput(
    bitcoin.payments.embed({ data: [allocation] }).output!,
    BigInt(0)
  );
  return { ...base, parentTxs: [parent, base.parentTxs[1]] };
}

export function sptFixtureRead(
  fixture: ReturnType<typeof createSptFixture>,
  urlText: string,
  method: string
): unknown | undefined {
  const url = new URL(urlText);
  const base = fixtureRead(fixture, urlText, method);
  if (
    method !== 'GET' ||
    ![
      'https://blockbook-dev.syscoin.org',
      'https://explorer-blockbook-dev.syscoin.org',
    ].includes(url.origin)
  )
    return undefined;
  const asset = {
    assetGuid: SPT_GUID,
    symbol: SPT_SYMBOL,
    name: 'Offline fixture SPT',
    type: 'SPTAllocated',
    decimals: 8,
    maxSupply: '18446744073709551615',
    balance: SPT_BALANCE_UNITS,
    unconfirmedBalance: '0',
    totalReceived: SPT_BALANCE_UNITS,
    totalSent: '0',
    transfers: 1,
    path: UTXO_FIXTURE_PATH,
  };
  if (url.pathname === '/api/v2/asset/' + SPT_GUID) return { asset };
  if (base !== undefined && /^\/api\/v2\/(xpub|address)\//.test(url.pathname))
    return { ...(base as object), tokensAsset: [asset] };
  if (base !== undefined && url.pathname.startsWith('/api/v2/utxo/'))
    return {
      utxos: [
        {
          txid: fixture.parentTxs[0].getId(),
          vout: 0,
          value: '100000',
          height: 1,
          confirmations: 1,
          address: fixture.userAddress,
          path: UTXO_FIXTURE_PATH,
          assetInfo: { assetGuid: SPT_GUID, value: SPT_BALANCE_UNITS },
        },
      ],
      assets: [asset],
    };
  return base;
}

export async function installSptFixtureRoutes(
  context: BrowserContext,
  fixture: ReturnType<typeof createSptFixture>,
  localOrigin: string
) {
  const reads: string[] = [],
    deniedWrites: string[] = [],
    deniedUnknown: string[] = [];
  await context.route('**/*', async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (!['http:', 'https:'].includes(url.protocol)) return route.continue();
    if (
      url.origin === localOrigin &&
      request.method() === 'GET' &&
      url.pathname === '/'
    )
      return route.continue();
    let rpc: any;
    try {
      rpc = request.postDataJSON();
    } catch {
      /* Plain REST. */
    }
    if (
      /\/sendtx(?:\/|$)/i.test(url.pathname) ||
      (Array.isArray(rpc) ? rpc : [rpc]).some((row) =>
        /^(?:eth_send|sendrawtransaction|sys_signAndSend|wallet_sendCalls)/i.test(
          row?.method || ''
        )
      )
    )
      deniedWrites.push(url.pathname);
    const result = sptFixtureRead(fixture, request.url(), request.method());
    if (result === undefined) {
      deniedUnknown.push(request.method() + ' ' + url.origin + url.pathname);
      return route.abort('blockedbyclient');
    }
    reads.push(url.pathname);
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(result),
    });
  });
  return { reads, deniedWrites, deniedUnknown };
}
