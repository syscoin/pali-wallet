jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: jest.fn() },
}));

import store from 'state/store';

import { Interface } from './ethersV6Compat';
import { getTransactionDisplayInfo } from './transactions';

const OWNER = `0x${'11'.repeat(20)}`;
const RECIPIENT = `0x${'22'.repeat(20)}`;
const TOKEN = `0x${'33'.repeat(20)}`;
const iface = new Interface([
  'function transfer(address to,uint256 value)',
  'function transferFrom(address from,address to,uint256 value)',
  'function safeTransferFrom(address from,address to,uint256 tokenId)',
  'function safeTransferFrom(address from,address to,uint256 tokenId,bytes data)',
  'function safeTransferFrom(address from,address to,uint256 tokenId,uint256 amount,bytes data)',
]);
const setAssets = (assets: any[] = []) =>
  (store.getState as jest.Mock).mockReturnValue({
    vault: {
      activeNetwork: { chainId: 1, url: 'https://rpc.invalid' },
      activeAccount: { id: 0, type: 'HDAccount' },
      accounts: { HDAccount: { 0: { address: OWNER } } },
      accountAssets: { HDAccount: { 0: { ethereum: assets } } },
    },
  });
const transaction = (method: string, args: any[]) => ({
  chainId: 1,
  from: OWNER,
  to: TOKEN,
  value: '0',
  input: iface.encodeFunctionData(method, args),
});
const asset = { chainId: 1, contractAddress: TOKEN, tokenSymbol: 'TOKEN' };

beforeEach(() => setAssets());

it.each([
  ['transfer', [RECIPIENT, '1000000']],
  ['transferFrom', [OWNER, RECIPIENT, '1000000']],
])(
  'keeps unknown %s amounts generic until metadata identifies the token',
  async (method, args) => {
    await expect(
      getTransactionDisplayInfo(
        transaction(method as string, args as any[]),
        'ETH',
        true
      )
    ).resolves.toMatchObject({
      actualRecipient: RECIPIENT,
      displaySymbol: '0x3333...3333',
      hasUnknownDecimals: true,
      isErc20Transfer: true,
      isNft: false,
    });
  }
);

it('uses imported fungible metadata for transferFrom', async () => {
  setAssets([{ ...asset, decimals: 6, isNft: false }]);
  await expect(
    getTransactionDisplayInfo(
      transaction('transferFrom', [OWNER, RECIPIENT, '1000000']),
      'ETH',
      true
    )
  ).resolves.toMatchObject({
    displayValue: 1,
    displaySymbol: 'TOKEN',
    isNft: false,
  });
});

it.each(['0', '7'])(
  'uses imported NFT metadata for transferFrom token id %s',
  async (tokenId) => {
    setAssets([{ ...asset, isNft: true }]);
    await expect(
      getTransactionDisplayInfo(
        transaction('transferFrom', [OWNER, RECIPIENT, tokenId]),
        'ETH',
        true
      )
    ).resolves.toMatchObject({ displayValue: 1, isNft: true, tokenId });
  }
);

it.each([
  ['safeTransferFrom(address,address,uint256)', [OWNER, RECIPIENT, '7']],
  [
    'safeTransferFrom(address,address,uint256,bytes)',
    [OWNER, RECIPIENT, '7', '0x'],
  ],
])('infers an NFT from unambiguous %s calldata', async (method, args) => {
  await expect(
    getTransactionDisplayInfo(
      transaction(method as string, args as any[]),
      'ETH',
      true
    )
  ).resolves.toMatchObject({ displayValue: 1, isNft: true, tokenId: '7' });
});

it.each(['unknown', 'imported', 'fetched'])(
  'preserves an exact ERC1155 quantity with %s metadata',
  async (metadata) => {
    if (metadata === 'imported') setAssets([{ ...asset, isNft: true }]);
    const getTokenDetails = jest
      .fn()
      .mockResolvedValue({ symbol: 'TOKEN', isNft: true });
    await expect(
      getTransactionDisplayInfo(
        transaction('safeTransferFrom(address,address,uint256,uint256,bytes)', [
          OWNER,
          RECIPIENT,
          '5',
          '9007199254740993',
          '0x',
        ]),
        'ETH',
        metadata !== 'fetched',
        { wallet: { getTokenDetails } }
      )
    ).resolves.toMatchObject({
      displayValue: '9007199254740993',
      formattedValue: '9007199254740993',
      isNft: true,
      tokenId: '5',
    });
    expect(getTokenDetails).toHaveBeenCalledTimes(
      metadata === 'fetched' ? 1 : 0
    );
  }
);
