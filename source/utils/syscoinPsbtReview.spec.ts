import {
  getAssetReviewRows,
  getSyscoinPsbtReviewError,
} from './syscoinPsbtReview';

const decodedTransfer = (assetGuid: string, value: string) => ({
  feeSatoshis: '1000',
  syscoin: {
    allocations: { assets: [{ assetGuid, values: [{ n: 1, value }] }] },
    txtype: 'assetallocation_send',
  },
  vout: [
    {
      n: 1,
      scriptPubKey: {
        addresses: ['tsys1-recipient'],
        type: 'witness_v0_keyhash',
      },
    },
  ],
});

describe('Syscoin PSBT review', () => {
  it('shows zero-decimal NFT and ERC-1155 quantities exactly', () => {
    const decoded = decodedTransfer('4294967297', '2');
    const metadata = {
      '4294967297': {
        assetType: 'ERC1155' as const,
        contract: '0x1111111111111111111111111111111111111111',
        decimals: 0,
        originDecimals: 0,
        symbol: 'NFT',
        assetGuid: '4294967297',
        tokenId: '7',
      },
    };

    expect(getSyscoinPsbtReviewError(decoded, metadata)).toBeNull();
    expect(getAssetReviewRows(decoded, metadata)).toEqual([
      {
        amount: '2',
        assetGuid: '4294967297',
        outputIndex: 1,
        rawAmount: '2',
        recipient: 'tsys1-recipient',
        isBurn: false,
        symbol: 'NFT',
      },
    ]);
  });

  it('shows fungible SPT amounts using eight decimals', () => {
    const decoded = decodedTransfer('123456', '123000000');
    const metadata = {
      '123456': {
        assetType: 'SYSX' as const,
        decimals: 8,
        symbol: 'SYSX',
        assetGuid: '123456',
      },
    };

    expect(getAssetReviewRows(decoded, metadata)[0].amount).toBe('1.23');
  });

  it('accepts native SPTs without bridge origin metadata', () => {
    const decoded = decodedTransfer('987654', '12345');
    const metadata = {
      '987654': {
        assetGuid: '987654',
        contract: '',
        decimals: 2,
        symbol: 'NATIVE',
      },
    };

    expect(getSyscoinPsbtReviewError(decoded, metadata)).toBeNull();
    expect(getAssetReviewRows(decoded, metadata)[0].amount).toBe('123.45');
  });

  it('still requires an origin type for bridge-shaped metadata', () => {
    expect(
      getSyscoinPsbtReviewError(decodedTransfer('4294967297', '1'), {
        '4294967297': {
          contract: '0x1111111111111111111111111111111111111111',
          decimals: 0,
          originDecimals: 0,
          tokenId: '0',
        },
      })
    ).toBe('Unable to verify the origin type for asset 4294967297');

    expect(
      getSyscoinPsbtReviewError(decodedTransfer('987654', '1'), {
        '987654': {
          contract: '0x1111111111111111111111111111111111111111',
          decimals: 8,
          originDecimals: 8,
        },
      })
    ).toBe('Unable to verify the origin type for asset 987654');
  });

  it('accepts bridged NFT token ID zero but rejects malformed IDs', () => {
    const metadata = {
      '4294967297': {
        assetType: 'ERC721' as const,
        contract: '0x1111111111111111111111111111111111111111',
        decimals: 0,
        originDecimals: 0,
        symbol: 'ZERO',
        tokenId: '0',
      },
    };

    expect(
      getSyscoinPsbtReviewError(decodedTransfer('4294967297', '1'), metadata)
    ).toBeNull();

    metadata['4294967297'].tokenId = '-1';
    expect(
      getSyscoinPsbtReviewError(decodedTransfer('4294967297', '1'), metadata)
    ).toBe('Unable to verify token ID for asset 4294967297');
  });

  it('fails closed when bridged NFT metadata falls back to eight decimals', () => {
    expect(
      getSyscoinPsbtReviewError(decodedTransfer('4294967297', '1'), {
        '4294967297': {
          assetType: 'ERC1155',
          contract: '0x1111111111111111111111111111111111111111',
          decimals: 8,
          originDecimals: 0,
          symbol: '4294967297',
          tokenId: '7',
        },
      })
    ).toBe('NFT asset 4294967297 must use zero-decimal units');
  });

  it('fails closed on missing metadata, invalid amounts, and unknown types', () => {
    expect(getSyscoinPsbtReviewError(decodedTransfer('123', '1'), {})).toBe(
      'Unable to verify decimals for asset 123'
    );

    expect(
      getSyscoinPsbtReviewError(decodedTransfer('123', '-1'), {
        '123': {
          assetType: 'ERC20',
          contract: '0x1111111111111111111111111111111111111111',
          decimals: 8,
          originDecimals: 8,
          symbol: 'SPT',
        },
      })
    ).toBe('Asset 123 has an invalid output amount');

    expect(
      getSyscoinPsbtReviewError(
        { syscoin: { txtype: 'mystery_operation' }, vout: [] },
        {}
      )
    ).toBe('Unsupported Syscoin transaction type: mystery_operation');

    expect(
      getSyscoinPsbtReviewError(
        { syscoin: { txtype: 'bitcoin' }, vout: [] },
        {}
      )
    ).toBe('Unable to verify the transaction fee');
  });

  it('rejects a nonrepresentable low-decimal ERC20 bridge burn', () => {
    const decoded = {
      feeSatoshis: '1000',
      syscoin: {
        allocations: {
          assets: [
            { assetGuid: '123', values: [{ n: 1, value: '123000001' }] },
          ],
        },
        txtype: 'assetallocation_burn_to_ethereum',
      },
      vout: [{ n: 1, scriptPubKey: { type: 'nulldata' } }],
    };
    const metadata = {
      '123': {
        assetType: 'ERC20' as const,
        contract: '0x1111111111111111111111111111111111111111',
        decimals: 8,
        originDecimals: 2,
        symbol: 'TWO',
      },
    };

    expect(getSyscoinPsbtReviewError(decoded, metadata)).toBe(
      'Burn amount for asset 123 is not representable with 2 origin decimals'
    );

    decoded.syscoin.allocations.assets[0].values[0].value = '123000000';
    expect(getSyscoinPsbtReviewError(decoded, metadata)).toBeNull();
  });
});
