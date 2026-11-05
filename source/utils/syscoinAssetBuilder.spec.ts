jest.unmock('syscoinjs-lib');

import { SyscoinTransactionsCore } from '@sidhujag/sysweb3-keyring/cjs/transactions/syscoin-core';

import { toEightDecimalBuilderAmount } from './syscoinAssetAmount';

// Exercise the installed keyring implementation used by Pali, not a duplicate
// amount parser. The package does not export this class from its public index.

describe('Pali asset amount to keyring builder', () => {
  const buildAssetOutput = async (
    amount: string,
    assetType: 'ERC721' | 'ERC1155'
  ) => {
    const assetAllocationSend = jest.fn().mockResolvedValue({
      fee: 100,
      psbt: { toBase64: () => 'unsigned-psbt' },
    });
    const readOnlySigner = {
      main: { assetAllocationSend, blockbookURL: 'https://blockbook.test' },
      getOwnedAddress: async () => 'sys1-change',
    };
    const state = {
      accounts: {
        HDAccount: { 0: { address: 'sys1-source', xpub: 'xpub-source' } },
      },
      activeAccountId: 0,
      activeAccountType: 'HDAccount',
      activeNetwork: {
        chainId: 57,
        kind: 'syscoin',
        currency: 'sys',
        slip44: 57,
        url: 'https://blockbook.test',
      },
    };
    const transactions = new SyscoinTransactionsCore(
      () => {
        throw new Error('An asset quote must not invoke a signer');
      },
      () => readOnlySigner,
      () => state as never,
      {},
      () => () => undefined
    );

    await transactions.getEstimateSysTransactionFee(
      {
        amount: toEightDecimalBuilderAmount(amount, 0, assetType),
        feeRate: 0.00000001,
        receivingAddress: 'sys1-recipient',
        token: { guid: '4294967297', symbol: 'NFT' },
      },
      {
        assertCurrent: () => undefined,
        signal: new AbortController().signal,
        fetch: jest.fn(async () => {
          throw new Error('Unexpected asset quote request');
        }),
      }
    );

    const assetMap = assetAllocationSend.mock.calls[0][1] as Map<
      string,
      { outputs: Array<{ value: { toString: () => string } }> }
    >;
    return assetMap.get('4294967297')!.outputs[0].value.toString();
  };

  it('serializes an ERC721 quantity of one as one raw asset unit', async () => {
    await expect(buildAssetOutput('1', 'ERC721')).resolves.toBe('1');
  });

  it('serializes ERC1155 integer quantities without 1e8 scaling', async () => {
    await expect(buildAssetOutput('25', 'ERC1155')).resolves.toBe('25');
  });
});
