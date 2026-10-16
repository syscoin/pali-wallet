jest.unmock('syscoinjs-lib');
jest.unmock('tiny-secp256k1');

import { utils as sys } from 'syscoinjs-lib';

import {
  createSptAssetMatrixFixture,
  installSptAssetMatrixRoutes,
  SPT_ASSET_MATRIX,
  sptAssetMatrixMetadata,
  sptAssetMatrixRead,
  SptMatrixMetadataFault,
} from '../../e2e/harness/sptAssetMatrixFixture';
import {
  getAssetReviewRows,
  getSyscoinPsbtReviewError,
} from '../../source/utils/syscoinPsbtReview';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const txlib = require('syscointx-js');
const backend = 'https://blockbook-dev.syscoin.org/api/v2';

const decodedParent = (
  fixture: ReturnType<typeof createSptAssetMatrixFixture>
) => {
  const parent = fixture.parentTxs[0];
  return {
    feeSatoshis: '1000',
    syscoin: {
      txtype: 'assetallocation_send',
      allocations: {
        assets: txlib
          .getAllocationsFromOutputs(parent.outs)
          .map((asset: any) => ({
            assetGuid: String(asset.assetGuid),
            values: asset.values.map((value: any) => ({
              n: value.n,
              value: String(value.value),
            })),
          })),
      },
    },
    vout: parent.outs.map((output: any, n: number) => ({
      n,
      scriptPubKey: {
        hex: Buffer.from(output.script).toString('hex'),
        type: n === 0 ? 'witness_v0_keyhash' : 'nulldata',
        addresses: n === 0 ? [fixture.userAddress] : [],
      },
    })),
  };
};

describe('fenced synthetic NEVM-origin SPT asset matrix', () => {
  it('the route installer aborts financial/foreign requests without forwarding them', async () => {
    const fixture = createSptAssetMatrixFixture(SPT_ASSET_MATRIX[0].id);
    let handler: (route: any) => Promise<unknown>;
    const context: any = {
      route: jest.fn(async (_pattern, callback) => {
        handler = callback;
      }),
    };
    const observed = await installSptAssetMatrixRoutes(
      context,
      fixture,
      'http://127.0.0.1:1234'
    );
    const requests = [
      { method: 'POST', url: backend + '/sendtx/', rpc: undefined },
      { method: 'GET', url: backend + '/sendtx/test', rpc: undefined },
      {
        method: 'POST',
        url: 'https://rpc.tanenbaum.io',
        rpc: { method: 'eth_sendRawTransaction' },
      },
      {
        method: 'POST',
        url: 'https://rpc.tanenbaum.io',
        rpc: { method: 'sys_sign' },
      },
      {
        method: 'GET',
        url:
          'https://foreign.invalid/api/v2/asset/' + fixture.assetCase.assetGuid,
        rpc: undefined,
      },
    ];
    for (const request of requests) {
      const route = {
        request: () => ({
          method: () => request.method,
          url: () => request.url,
          postDataJSON: () => request.rpc,
        }),
        continue: jest.fn(),
        fulfill: jest.fn(),
        abort: jest.fn(),
      };
      await handler!(route);
      expect(route.abort).toHaveBeenCalledWith('blockedbyclient');
      expect(route.continue).not.toHaveBeenCalled();
      expect(route.fulfill).not.toHaveBeenCalled();
    }
    expect(observed.deniedWrites).toHaveLength(4);
    expect(observed.deniedUnknown).toHaveLength(5);
    expect(observed.reads).toEqual([]);
  });

  it('declares only canonical ERC20/NFT precision and nonreserved asset identities', () => {
    expect(SPT_ASSET_MATRIX).toHaveLength(4);
    expect(new Set(SPT_ASSET_MATRIX.map((c) => c.assetGuid)).size).toBe(4);
    for (const c of SPT_ASSET_MATRIX) {
      expect(c.assetGuid).not.toBe('123456');
      if (c.assetType === 'ERC20') {
        expect(c.decimals).toBe(8);
        expect(BigInt(c.assetGuid) >> BigInt(32)).toBe(BigInt(0));
      } else {
        expect(c.decimals).toBe(0);
        expect(c.originDecimals).toBe(0);
        expect(String(BigInt(c.assetGuid) >> BigInt(32))).toBe(c.tokenId);
      }
    }
  });

  it.each(SPT_ASSET_MATRIX)(
    '$id binds balance, raw parent, sanitizer and strict review',
    (c) => {
      const fixture = createSptAssetMatrixFixture(c.id);
      const account: any = sptAssetMatrixRead(
        fixture,
        backend + '/xpub/' + fixture.userXpub,
        'GET'
      );
      const response: any = sptAssetMatrixRead(
        fixture,
        backend + '/utxo/' + fixture.userXpub,
        'GET'
      );
      expect(account.balance).toBe(fixture.nativeBalanceSatoshis);
      expect(account.tokensAsset).toEqual([sptAssetMatrixMetadata(fixture)]);
      expect(response.utxos[0]).toMatchObject({
        txid: fixture.parentTxs[0].getId(),
        value: String(fixture.parentTxs[0].outs[0].value),
        assetInfo: { assetGuid: c.assetGuid, value: c.balanceAtomic },
      });
      const metadata = sptAssetMatrixMetadata(fixture);
      const decoded = decodedParent(fixture);
      expect(
        getSyscoinPsbtReviewError(decoded, { [c.assetGuid]: metadata })
      ).toBeNull();
      expect(getAssetReviewRows(decoded, { [c.assetGuid]: metadata })).toEqual([
        expect.objectContaining({
          assetGuid: c.assetGuid,
          rawAmount: c.balanceAtomic,
          amount: c.balanceDisplay,
          symbol: c.symbol,
        }),
      ]);
      const sanitized = sys.sanitizeBlockbookUTXOs(
        fixture.userXpub,
        response,
        sys.syscoinNetworks.testnet,
        { rbf: true },
        new Map([[c.assetGuid, {}]])
      );
      expect(sanitized.utxos).toHaveLength(1);
      expect(sanitized.utxos[0].assetInfo.value.toString()).toBe(
        c.balanceAtomic
      );
      expect(sanitized.assets.get(c.assetGuid).precision).toBe(c.decimals);
      expect(sanitized.assets.get(c.assetGuid).contract).toEqual(
        Buffer.from(c.contract.slice(2), 'hex')
      );
    }
  );

  it.each(SPT_ASSET_MATRIX)(
    '$id builds exact adjacent/MAX allocations and refuses unaffordable native fees',
    (c) => {
      const fixture = createSptAssetMatrixFixture(c.id);
      const build = (requested: string, rate: string) => {
        const response = sptAssetMatrixRead(
          fixture,
          backend + '/utxo/' + fixture.userXpub,
          'GET'
        );
        const map = new Map([
          [
            c.assetGuid,
            {
              changeAddress: fixture.userAddress,
              outputs: [
                {
                  value: new sys.BN(requested),
                  address: fixture.recipientAddress,
                },
              ],
            },
          ],
        ]);
        const sanitized = sys.sanitizeBlockbookUTXOs(
          fixture.userXpub,
          response,
          sys.syscoinNetworks.testnet,
          { rbf: true },
          map
        );
        return txlib.assetAllocationSend(
          { rbf: true },
          sanitized,
          map,
          fixture.userAddress,
          new sys.BN(rate)
        );
      };
      const total = BigInt(c.balanceAtomic);
      const amounts = c.belowMaxDisplay ? [total - BigInt(1), total] : [total];
      for (const amount of amounts) {
        const result = build(String(amount), '2');
        expect(result.success).toBe(true);
        const assets = txlib.getAllocationsFromOutputs(result.outputs);
        expect(assets).toHaveLength(1);
        expect(String(assets[0].assetGuid)).toBe(c.assetGuid);
        const recipient = assets[0].values.find(
          (value: any) =>
            result.outputs[value.n].address === fixture.recipientAddress
        );
        expect(String(recipient.value)).toBe(String(amount));
        expect(
          assets[0].values.reduce(
            (n: bigint, value: any) => n + BigInt(value.value),
            BigInt(0)
          )
        ).toBe(total);
        expect(BigInt(result.fee.toString())).toBeGreaterThan(BigInt(0));
      }
      const refused = build(String(amounts[0]), '1000');
      expect(refused.success).not.toBe(true);
      expect(refused.error).toBeTruthy();
    }
  );

  const commonFaults: SptMatrixMetadataFault[] = [
    'missing-type',
    'missing-contract',
    'missing-origin-decimals',
    'wrong-utxo-decimals',
  ];
  it.each(
    SPT_ASSET_MATRIX.flatMap((c) =>
      commonFaults.map((fault) => ({ id: c.id, fault }))
    )
  )(
    '$id rejects $fault rather than inventing origin metadata',
    ({ id, fault }) => {
      const valid = createSptAssetMatrixFixture(id),
        bad = createSptAssetMatrixFixture(id, fault);
      const decoded = decodedParent(valid),
        guid = valid.assetCase.assetGuid;
      expect(
        getSyscoinPsbtReviewError(decoded, {
          [guid]: sptAssetMatrixMetadata(valid),
        })
      ).toBeNull();
      expect(
        getSyscoinPsbtReviewError(decoded, {
          [guid]: sptAssetMatrixMetadata(bad),
        })
      ).not.toBeNull();
    }
  );

  it.each(SPT_ASSET_MATRIX.filter((c) => c.assetType !== 'ERC20'))(
    '$id requires its NEVM token ID',
    (c) => {
      const fixture = createSptAssetMatrixFixture(c.id, 'missing-token-id');
      expect(
        getSyscoinPsbtReviewError(decodedParent(fixture), {
          [c.assetGuid]: sptAssetMatrixMetadata(fixture),
        })
      ).toBe(`Unable to verify token ID for asset ${c.assetGuid}`);
    }
  );

  it.each(SPT_ASSET_MATRIX)(
    '$id never supplies foreign data, writes or a different asset',
    (c) => {
      const f = createSptAssetMatrixFixture(c.id);
      for (const [url, method] of [
        [backend + '/sendtx/', 'POST'],
        [backend + '/sendtx/test', 'GET'],
        [backend + '/asset/' + c.assetGuid, 'POST'],
        ['https://foreign.invalid/api/v2/asset/' + c.assetGuid, 'GET'],
        [backend + '/asset/123456', 'GET'],
        [backend + '/xpub/unrelated', 'GET'],
        [backend + '/utxo/unrelated', 'GET'],
        [backend + '/tx/' + '0'.repeat(64), 'GET'],
      ])
        expect(sptAssetMatrixRead(f, url, method)).toBeUndefined();
    }
  );
});
