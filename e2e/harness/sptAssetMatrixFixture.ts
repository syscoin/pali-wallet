import { utils as sys } from 'syscoinjs-lib';

import {
  createUtxoFixture,
  fixtureRead,
  UTXO_FIXTURE_PATH,
} from './utxoFixture';
import type { BrowserContext } from '@playwright/test';

// Synthetic read responses for NEVM-origin assets. These GUIDs/contracts and
// fabricated parents are not live registrations or independent UTXO issuance.
// ERC20 origin precision can differ, but its canonical UTXO precision is eight.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const txlib = require('syscointx-js');

export interface ISptAssetMatrixCase {
  assetGuid: string;
  assetType: 'ERC20' | 'ERC721' | 'ERC1155';
  balanceAtomic: string;
  balanceDisplay: string;
  belowMaxDisplay: string | null;
  contract: string;
  decimals: 0 | 8;
  id: string;
  invalidPrecisionAmount: string;
  originDecimals: number;
  overBalanceDisplay: string;
  symbol: string;
  tokenId?: string;
}

export const SPT_ASSET_MATRIX: readonly ISptAssetMatrixCase[] = [
  {
    id: 'erc20-origin-zero',
    assetGuid: '123458',
    assetType: 'ERC20',
    symbol: 'E20ZERO',
    contract: '0x1111111111111111111111111111111111111111',
    originDecimals: 0,
    decimals: 8,
    balanceAtomic: '200000000',
    balanceDisplay: '2',
    belowMaxDisplay: '1.99999999',
    overBalanceDisplay: '2.00000001',
    invalidPrecisionAmount: '0.000000001',
  },
  {
    id: 'erc20-origin-eight',
    assetGuid: '123459',
    assetType: 'ERC20',
    symbol: 'E20EIGHT',
    contract: '0x2222222222222222222222222222222222222222',
    originDecimals: 8,
    decimals: 8,
    balanceAtomic: '9007199254740993',
    balanceDisplay: '90071992.54740993',
    belowMaxDisplay: '90071992.54740992',
    overBalanceDisplay: '90071992.54740994',
    invalidPrecisionAmount: '0.000000001',
  },
  {
    id: 'erc721-one',
    assetGuid: '4295090756', // (tokenId 1 << 32) | base GUID 123460
    assetType: 'ERC721',
    symbol: 'E721',
    contract: '0x3333333333333333333333333333333333333333',
    originDecimals: 0,
    decimals: 0,
    tokenId: '1',
    balanceAtomic: '1',
    balanceDisplay: '1',
    belowMaxDisplay: null, // Zero is not a valid ERC721 transfer quantity.
    overBalanceDisplay: '2',
    invalidPrecisionAmount: '0.5',
  },
  {
    id: 'erc1155-large-integer',
    assetGuid: '8590058053', // (tokenId 2 << 32) | base GUID 123461
    assetType: 'ERC1155',
    symbol: 'E1155',
    contract: '0x4444444444444444444444444444444444444444',
    originDecimals: 0,
    decimals: 0,
    tokenId: '2',
    balanceAtomic: '9007199254740993',
    balanceDisplay: '9007199254740993',
    belowMaxDisplay: '9007199254740992',
    overBalanceDisplay: '9007199254740994',
    invalidPrecisionAmount: '1.5',
  },
];

export type SptMatrixMetadataFault =
  | 'missing-type'
  | 'missing-contract'
  | 'missing-origin-decimals'
  | 'missing-token-id'
  | 'wrong-utxo-decimals';

export function createSptAssetMatrixFixture(
  id: string,
  metadataFault?: SptMatrixMetadataFault
) {
  const assetCase = SPT_ASSET_MATRIX.find((candidate) => candidate.id === id);
  if (!assetCase) throw new Error('Unknown SPT matrix case');
  if (metadataFault === 'missing-token-id' && assetCase.assetType === 'ERC20')
    throw new Error('ERC20 does not require an NFT token ID');
  const base = createUtxoFixture(),
    bitcoin = sys.bitcoinjs,
    parent = new bitcoin.Transaction();
  parent.version = 142;
  parent.addInput(
    Buffer.alloc(32, 31 + SPT_ASSET_MATRIX.indexOf(assetCase)),
    0
  );
  parent.addOutput(
    bitcoin.address.toOutputScript(
      base.userAddress,
      sys.syscoinNetworks.testnet
    ),
    BigInt(base.nativeBalanceSatoshis)
  );
  parent.addOutput(
    bitcoin.payments.embed({
      data: [
        txlib.bufferUtils.serializeAssetAllocations([
          {
            assetGuid: assetCase.assetGuid,
            values: [{ n: 0, value: new sys.BN(assetCase.balanceAtomic) }],
          },
        ]),
      ],
    }).output!,
    BigInt(0)
  );
  return {
    ...base,
    assetCase,
    metadataFault,
    parentTxs: [parent, base.parentTxs[1]],
  };
}

export type SptAssetMatrixFixture = ReturnType<
  typeof createSptAssetMatrixFixture
>;

export function sptAssetMatrixMetadata(fixture: SptAssetMatrixFixture) {
  const c = fixture.assetCase;
  const asset: Record<string, unknown> = {
    assetGuid: c.assetGuid,
    symbol: c.symbol,
    name: `Offline synthetic NEVM ${c.assetType} (${c.id})`,
    type: 'SPTAllocated',
    assetType: c.assetType,
    contract: c.contract,
    originDecimals: c.originDecimals,
    decimals: c.decimals,
    ...(c.tokenId ? { tokenId: c.tokenId } : {}),
    maxSupply: '18446744073709551615',
    balance: c.balanceAtomic,
    unconfirmedBalance: '0',
    totalReceived: c.balanceAtomic,
    totalSent: '0',
    transfers: 1,
    path: UTXO_FIXTURE_PATH,
  };
  const omitted = {
    'missing-type': 'assetType',
    'missing-contract': 'contract',
    'missing-origin-decimals': 'originDecimals',
    'missing-token-id': 'tokenId',
  };
  if (fixture.metadataFault === 'wrong-utxo-decimals')
    asset.decimals = c.decimals === 8 ? 0 : 8;
  else if (fixture.metadataFault) delete asset[omitted[fixture.metadataFault]];
  return asset;
}

export function sptAssetMatrixRead(
  fixture: SptAssetMatrixFixture,
  urlText: string,
  method: string
): unknown | undefined {
  const url = new URL(urlText);
  if (
    method !== 'GET' ||
    url.username ||
    url.password ||
    url.hash ||
    ![
      'https://blockbook-dev.syscoin.org',
      'https://explorer-blockbook-dev.syscoin.org',
    ].includes(url.origin)
  )
    return undefined;
  const base = fixtureRead(fixture, urlText, method),
    asset = sptAssetMatrixMetadata(fixture),
    c = fixture.assetCase;
  if (url.pathname === '/api/v2/asset/' + c.assetGuid) return { asset };
  if (base !== undefined && /^\/api\/v2\/(xpub|address)\//.test(url.pathname))
    return { ...(base as object), tokensAsset: [asset] };
  if (base !== undefined && url.pathname.startsWith('/api/v2/utxo/'))
    return {
      utxos: [
        {
          txid: fixture.parentTxs[0].getId(),
          vout: 0,
          value: fixture.nativeBalanceSatoshis,
          height: 1,
          confirmations: 1,
          address: fixture.userAddress,
          path: UTXO_FIXTURE_PATH,
          assetInfo: { assetGuid: c.assetGuid, value: c.balanceAtomic },
        },
      ],
      assets: [asset],
    };
  return base;
}

export async function installSptAssetMatrixRoutes(
  context: BrowserContext,
  fixture: SptAssetMatrixFixture,
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
        /^(?:eth_send|sendrawtransaction|sys_sign|wallet_sendCalls)/i.test(
          row?.method || ''
        )
      )
    )
      deniedWrites.push(request.method() + ' ' + url.pathname);
    const result = sptAssetMatrixRead(fixture, request.url(), request.method());
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
