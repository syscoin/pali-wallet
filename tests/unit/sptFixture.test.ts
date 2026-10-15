jest.unmock('syscoinjs-lib');

import { utils as sys } from 'syscoinjs-lib';

import {
  createSptFixture,
  SPT_BALANCE_UNITS,
  SPT_GUID,
  SPT_ORIGIN_CONTRACT,
  SPT_ORIGIN_DECIMALS,
  sptFixtureRead,
} from '../../e2e/harness/sptFixture';
import { getSyscoinPsbtReviewError } from '../../source/utils/syscoinPsbtReview';
import { SYSX_ASSET_GUID } from '../../source/utils/tokens';

describe('offline SPT fixture', () => {
  it('uses an ordinary asset identity, not the reserved SYSX GUID', () => {
    expect(SPT_GUID).not.toBe(SYSX_ASSET_GUID);
  });

  it('models explicit synthetic NEVM ERC20 origin metadata for the strict review', () => {
    const f = createSptFixture();
    const { asset }: any = sptFixtureRead(
      f,
      `https://blockbook-dev.syscoin.org/api/v2/asset/${SPT_GUID}`,
      'GET'
    );
    const decoded = {
      feeSatoshis: '1000',
      syscoin: {
        txtype: 'assetallocation_send',
        allocations: {
          assets: [
            {
              assetGuid: SPT_GUID,
              values: [{ n: 0, value: SPT_BALANCE_UNITS }],
            },
          ],
        },
      },
      vout: [
        {
          n: 0,
          scriptPubKey: {
            addresses: [f.userAddress],
            type: 'witness_v0_keyhash',
          },
        },
      ],
    };
    expect(asset).toMatchObject({
      assetGuid: SPT_GUID,
      assetType: 'ERC20',
      contract: SPT_ORIGIN_CONTRACT,
      originDecimals: SPT_ORIGIN_DECIMALS,
      decimals: 8,
    });
    expect(
      getSyscoinPsbtReviewError(decoded, { [SPT_GUID]: asset })
    ).toBeNull();
    for (const [field, message] of [
      ['assetType', `Unable to verify the origin type for asset ${SPT_GUID}`],
      [
        'originDecimals',
        `Unable to verify origin decimals for asset ${SPT_GUID}`,
      ],
      ['contract', `Unable to verify origin contract for asset ${SPT_GUID}`],
    ]) {
      expect(
        getSyscoinPsbtReviewError(decoded, {
          [SPT_GUID]: { ...asset, [field]: undefined },
        })
      ).toBe(message);
    }
  });

  it('binds the displayed asset balance and spendable prevout to the same bytes', () => {
    const f = createSptFixture();
    const account: any = sptFixtureRead(
      f,
      `https://blockbook-dev.syscoin.org/api/v2/xpub/${f.userXpub}`,
      'GET'
    );
    const utxos: any = sptFixtureRead(
      f,
      `https://blockbook-dev.syscoin.org/api/v2/utxo/${f.userXpub}`,
      'GET'
    );
    expect(account.tokensAsset[0].balance).toBe(SPT_BALANCE_UNITS);
    expect(account.tokensAsset[0].assetGuid).toBe(SPT_GUID);
    expect(utxos.utxos).toHaveLength(1);
    expect(utxos.utxos[0].txid).toBe(f.parentTxs[0].getId());
    expect(utxos.utxos[0].assetInfo.value).toBe(SPT_BALANCE_UNITS);
    expect(f.parentTxs[0].version).toBe(142);
    expect(f.parentTxs[0].outs[0].value).toBe(BigInt(100000));
    expect(Buffer.from(f.parentTxs[0].outs[0].script)).toEqual(
      Buffer.from(
        sys.bitcoinjs.address.toOutputScript(
          f.userAddress,
          sys.syscoinNetworks.testnet
        )
      )
    );
  });
  it('never supplies a send endpoint, POST, foreign origin or foreign account', () => {
    const f = createSptFixture();
    for (const [url, method] of [
      ['https://blockbook-dev.syscoin.org/api/v2/sendtx/', 'POST'],
      ['https://blockbook-dev.syscoin.org/api/v2/sendtx/test', 'GET'],
      [`https://foreign.invalid/api/v2/asset/${SPT_GUID}`, 'GET'],
      ['https://blockbook-dev.syscoin.org/api/v2/xpub/unrelated', 'GET'],
    ])
      expect(sptFixtureRead(f, url, method)).toBeUndefined();
  });

  it('passes the wrapped asset response through the installed SDK sanitizer', () => {
    const f = createSptFixture();
    const response = sptFixtureRead(
      f,
      `https://blockbook-dev.syscoin.org/api/v2/utxo/${f.userXpub}`,
      'GET'
    );
    const sanitized = sys.sanitizeBlockbookUTXOs(
      f.userXpub,
      response,
      sys.syscoinNetworks.testnet,
      { rbf: true },
      new Map([[SPT_GUID, {}]])
    );
    expect(sanitized.utxos).toHaveLength(1);
    expect(sanitized.utxos[0].txId).toBe(f.parentTxs[0].getId());
    expect(sanitized.utxos[0].assetInfo.value.toString()).toBe(
      SPT_BALANCE_UNITS
    );
    expect(sanitized.assets.get(SPT_GUID).precision).toBe(8);
    expect(sanitized.assets.get(SPT_GUID).contract).toEqual(
      Buffer.from(SPT_ORIGIN_CONTRACT.slice(2), 'hex')
    );
  });
});
