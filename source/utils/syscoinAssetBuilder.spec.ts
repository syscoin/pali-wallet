jest.unmock('syscoinjs-lib');

import { SyscoinTransactions } from '@sidhujag/sysweb3-keyring/cjs/transactions/syscoin';

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
    };
    const state = {
      accounts: {
        HDAccount: { 0: { address: 'sys1-source', xpub: 'xpub-source' } },
      },
      activeAccountId: 0,
      activeAccountType: 'HDAccount',
      activeNetwork: { chainId: 57, currency: 'sys', slip44: 57 },
    };
    const transactions = new SyscoinTransactions(
      () => ({ hd: {}, main: readOnlySigner.main }),
      () => readOnlySigner,
      () => state,
      async () => 'sys1-change',
      {},
      {}
    );

    await transactions.getEstimateSysTransactionFee({
      amount: toEightDecimalBuilderAmount(amount, 0, assetType),
      feeRate: 0.00000001,
      receivingAddress: 'sys1-recipient',
      token: { guid: '4294967297', symbol: 'NFT' },
    });

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
