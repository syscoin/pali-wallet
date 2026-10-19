jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: jest.fn() },
}));

import store from 'state/store';

import { Interface } from './ethersV6Compat';
import { getTransactionDisplayInfo } from './transactions';

const OWNER = `0x${'11'.repeat(20)}`;
const TOKEN = `0x${'22'.repeat(20)}`;
const RECIPIENT = `0x${'33'.repeat(20)}`;
const iface = new Interface([
  'function approve(address spender,uint256 amount)',
  'function setApprovalForAll(address operator,bool approved)',
  'function safeTransferFrom(address from,address to,uint256 tokenId)',
  'function mint() payable',
]);
const state = (assetChain = 1) => ({
  vault: {
    activeNetwork: { chainId: 1, url: 'https://rpc.invalid' },
    activeAccount: { id: 0, type: 'HDAccount' },
    accounts: { HDAccount: { 0: { address: OWNER } } },
    accountAssets: {
      HDAccount: {
        0: {
          ethereum: [
            {
              chainId: assetChain,
              contractAddress: TOKEN,
              tokenSymbol: 'ART',
              isNft: true,
            },
          ],
        },
      },
    },
  },
});

beforeEach(() => {
  (store.getState as jest.Mock).mockReturnValue(state());
});

it('recognizes a real NFT transfer from its calldata', async () => {
  await expect(
    getTransactionDisplayInfo(
      {
        chainId: 1,
        from: OWNER,
        to: TOKEN,
        input: iface.encodeFunctionData('safeTransferFrom', [
          OWNER,
          RECIPIENT,
          7,
        ]),
        value: '0',
      },
      'ETH',
      true
    )
  ).resolves.toMatchObject({
    isNft: true,
    isErc20Transfer: true,
    displayValue: 1,
    tokenId: '7',
    actualRecipient: RECIPIENT,
  });
});

it.each(['approve', 'setApprovalForAll'])(
  'does not invent an NFT transfer for %s',
  async (method) => {
    await expect(
      getTransactionDisplayInfo(
        {
          chainId: 1,
          from: OWNER,
          to: TOKEN,
          input: iface.encodeFunctionData(method, [
            RECIPIENT,
            method === 'approve' ? 7 : true,
          ]),
          value: '0',
        },
        'ETH',
        true
      )
    ).resolves.toMatchObject({
      isNft: false,
      isErc20Transfer: false,
      displayValue: 0,
      displaySymbol: 'ETH',
    });
  }
);

it('preserves the native payment amount of a payable NFT mint', async () => {
  await expect(
    getTransactionDisplayInfo(
      {
        chainId: 1,
        from: OWNER,
        to: TOKEN,
        input: iface.encodeFunctionData('mint'),
        value: '1000000000000000000',
      },
      'ETH',
      true
    )
  ).resolves.toMatchObject({
    isNft: false,
    isErc20Transfer: false,
    displayValue: 1,
    displaySymbol: 'ETH',
  });
});

it('does not use an NFT from another chain to label a native payment', async () => {
  (store.getState as jest.Mock).mockReturnValue(state(57));
  await expect(
    getTransactionDisplayInfo(
      {
        chainId: 1,
        from: OWNER,
        to: TOKEN,
        input: '0x',
        value: '2000000000000000000',
      },
      'ETH',
      true
    )
  ).resolves.toMatchObject({
    isNft: false,
    isErc20Transfer: false,
    displayValue: 2,
    displaySymbol: 'ETH',
  });
});
