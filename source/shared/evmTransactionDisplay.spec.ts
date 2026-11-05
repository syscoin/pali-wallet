import { defaultAbiCoder, id } from '../utils/ethersV6Compat';

import { EVM_TRANSACTION_HISTORY_SOURCE } from './evmHistory';
import {
  getEvmTransactionDisplayInfo,
  type EvmDisplayContext,
} from './evmTransactionDisplay';

const CONTRACT = `0x${'22'.repeat(20)}`;
const RECIPIENT = `0x${'33'.repeat(20)}`;
const transfer = (units: string) => ({
  chainId: 1,
  to: CONTRACT,
  value: '0',
  input:
    id('transfer(address,uint256)').slice(0, 10) +
    defaultAbiCoder.encode(['address', 'uint256'], [RECIPIENT, units]).slice(2),
});
const indexed = (value: unknown, decimals: unknown = 0) => ({
  chainId: 1,
  to: CONTRACT,
  value,
  input: '0x',
  historySource: EVM_TRANSACTION_HISTORY_SOURCE.ExplorerTokenTransfer,
  tokenTransfer: {
    chainId: 1,
    contractAddress: CONTRACT,
    recipient: RECIPIENT,
    value,
    decimals,
    symbol: 'TOK',
  },
});
const assetContext = (decimals: unknown): EvmDisplayContext => ({
  chainId: 1,
  assets: [
    { chainId: 1, contractAddress: CONTRACT, tokenSymbol: 'TOK', decimals },
  ],
});

it.each([0, 6, 18, 81, 255])(
  'keeps indexed and calldata token values exact at precision %s',
  async (decimals) => {
    const units = '9007199254740993';
    const event = await getEvmTransactionDisplayInfo(
      indexed(units, decimals),
      'ETH',
      { chainId: 1 }
    );
    const call = await getEvmTransactionDisplayInfo(
      transfer(units),
      'ETH',
      assetContext(decimals)
    );
    expect(call).toMatchObject({
      formattedValue: event.formattedValue,
      displayValue: event.displayValue,
      actualRecipient: RECIPIENT,
      isErc20Transfer: true,
      isNft: false,
    });
  }
);
it.each([undefined, null, -1, 1.5, 256, '', false, true, {}, []])(
  'does not invent decimals for malformed known metadata %#',
  async (decimals) => {
    const lookupToken = jest.fn();
    const result = await getEvmTransactionDisplayInfo(
      transfer('1000000'),
      'ETH',
      { ...assetContext(decimals), lookupToken }
    );
    expect(result.hasUnknownDecimals).toBe(true);
    expect(lookupToken).not.toHaveBeenCalled();
  }
);
it.each([undefined, null, 'x', Number.MAX_SAFE_INTEGER + 1, -1])(
  'keeps invalid indexed amounts unavailable %#',
  async (value) => {
    expect(
      await getEvmTransactionDisplayInfo(indexed(value), 'ETH', { chainId: 1 })
    ).toMatchObject({
      displayValue: '?',
      formattedValue: '?',
      amountUnavailable: true,
      isErc20Transfer: true,
    });
  }
);
it('does not look up metadata for an indexed event', async () => {
  const lookupToken = jest.fn();
  expect(
    await getEvmTransactionDisplayInfo(indexed('0'), 'ETH', {
      chainId: 1,
      lookupToken,
    })
  ).toMatchObject({ displayValue: '0', formattedValue: '0' });
  expect(lookupToken).not.toHaveBeenCalled();
});
it('uses host-owned metadata lookup only for missing same-chain assets', async () => {
  const lookupToken = jest
    .fn()
    .mockResolvedValue({ decimals: 0, symbol: 'KNOWN' });
  expect(
    await getEvmTransactionDisplayInfo(transfer('9007199254740993'), 'ETH', {
      chainId: 1,
      lookupToken,
    })
  ).toMatchObject({ displayValue: '9007199254740993', displaySymbol: 'KNOWN' });
  expect(lookupToken).toHaveBeenCalledTimes(1);
  await getEvmTransactionDisplayInfo(transfer('1'), 'SYS', {
    chainId: 57,
    lookupToken,
  });
  expect(lookupToken).toHaveBeenCalledTimes(1);
});
it('preserves unknown-token estimates as unknown rather than certifying an exact token amount', async () => {
  expect(
    await getEvmTransactionDisplayInfo(transfer('1000000000000000000'), 'ETH', {
      chainId: 1,
    })
  ).toMatchObject({ displayValue: '~1.000000', hasUnknownDecimals: true });
});
it.each(['0', '9007199254740993'])(
  'preserves inferred NFT token identifier %s',
  async (tokenId) => {
    const input =
      id('safeTransferFrom(address,address,uint256)').slice(0, 10) +
      defaultAbiCoder
        .encode(
          ['address', 'address', 'uint256'],
          [CONTRACT, RECIPIENT, tokenId]
        )
        .slice(2);
    expect(
      await getEvmTransactionDisplayInfo(
        { chainId: 1, to: CONTRACT, input, value: '0' },
        'ETH',
        { chainId: 1 }
      )
    ).toMatchObject({
      displayValue: 1,
      formattedValue: '1',
      tokenId,
      isNft: true,
    });
  }
);

it.each([
  { chainId: 57 },
  { contractAddress: 'invalid' },
  { recipient: 'invalid' },
])(
  'never interprets an invalid indexed event as a native payment %#',
  async (change) => {
    const tx = indexed('1000000000000000000', 18);
    Object.assign(tx.tokenTransfer, change);
    const result = await getEvmTransactionDisplayInfo(tx, 'ETH', {
      chainId: 1,
    });
    expect(result).toMatchObject({
      displayValue: '?',
      formattedValue: '?',
      amountUnavailable: true,
      isErc20Transfer: true,
      actualRecipient: '',
    });
    expect(result.displaySymbol).not.toBe('ETH');
  }
);

it('preserves accepted indexed NFT identifier and quantity text', async () => {
  const tx = indexed('0002');
  Object.assign(tx.tokenTransfer, {
    tokenId: '0005',
    tokenStandard: 'ERC-1155',
  });
  expect(
    await getEvmTransactionDisplayInfo(tx, 'ETH', { chainId: 1 })
  ).toMatchObject({
    displayValue: '0002',
    formattedValue: '0002',
    tokenId: '0005',
    nftQuantity: '0002',
    isNft: true,
  });
});
it('formats accepted leading-zero fungible units without changing their quantity', async () => {
  expect(
    await getEvmTransactionDisplayInfo(indexed('0002', 0), 'ETH', {
      chainId: 1,
    })
  ).toMatchObject({ displayValue: '2', formattedValue: '2', isNft: false });
});
