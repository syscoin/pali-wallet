jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: jest.fn() },
}));

import { EVM_TRANSACTION_HISTORY_SOURCE } from '../shared/evmHistory';
import store from 'state/store';

import { defaultAbiCoder, id } from './ethersV6Compat';
import { getTransactionDisplayInfo } from './transactions';

const tokenAddress = '0x5555555555555555555555555555555555555555';
const recipient = '0x2222222222222222222222222222222222222222';
const tx = {
  chainId: 1,
  to: tokenAddress,
  input: `${id('transfer(address,uint256)').slice(0, 10)}${defaultAbiCoder
    .encode(['address', 'uint256'], [recipient, 1_000_000])
    .slice(2)}`,
};

const vault = (chainId = 1, assets: any[] = []) => ({
  activeNetwork: { chainId, url: `https://rpc-${chainId}.example` },
  activeAccount: { id: 0, type: 'HDAccount' },
  accounts: { HDAccount: { 0: { address: recipient } } },
  accountAssets: { HDAccount: { 0: { ethereum: assets } } },
});

describe('transaction token metadata isolation', () => {
  it('uses decimals and symbol from the transaction chain only', async () => {
    (store.getState as jest.Mock).mockReturnValue({
      vault: vault(1, [
        {
          chainId: 57,
          contractAddress: tokenAddress,
          decimals: 18,
          tokenSymbol: 'WRONG',
        },
        {
          chainId: 1,
          contractAddress: tokenAddress,
          decimals: 6,
          tokenSymbol: 'RIGHT',
        },
      ]),
    });
    await expect(
      getTransactionDisplayInfo(tx, 'ETH', true)
    ).resolves.toMatchObject({
      displayValue: '1',
      displaySymbol: 'RIGHT',
    });
  });

  it('does not query the active chain for a transaction from a different chain', async () => {
    (store.getState as jest.Mock).mockReturnValue({ vault: vault(57) });
    const getTokenDetails = jest.fn();
    const result = await getTransactionDisplayInfo(tx, 'ETH', false, {
      wallet: { getTokenDetails },
    });
    expect(getTokenDetails).not.toHaveBeenCalled();
    expect(result.hasUnknownDecimals).toBe(true);
  });

  it('discards RPC metadata if the account or network changes while fetching', async () => {
    let resolve!: (value: any) => void;
    (store.getState as jest.Mock).mockReturnValue({ vault: vault() });
    const getTokenDetails = jest.fn().mockReturnValue(
      new Promise((res) => {
        resolve = res;
      })
    );
    const result = getTransactionDisplayInfo(tx, 'ETH', false, {
      wallet: { getTokenDetails },
    });
    (store.getState as jest.Mock).mockReturnValue({ vault: vault(57) });
    resolve({ decimals: 6, symbol: 'STALE' });
    await expect(result).resolves.toMatchObject({ hasUnknownDecimals: true });
  });
});

it('discards lookup metadata after in-place mutation of the captured network/account objects', async () => {
  let resolve!: (value: any) => void;
  const state = { vault: vault() };
  (store.getState as jest.Mock).mockReturnValue(state);
  const pending = getTransactionDisplayInfo(tx, 'ETH', false, {
    wallet: {
      getTokenDetails: () =>
        new Promise((r) => {
          resolve = r;
        }),
    },
  });
  state.vault.activeNetwork.url = 'https://changed.invalid';
  state.vault.activeAccount.id = 1;
  resolve({ decimals: 6, symbol: 'STALE' });
  expect(await pending).toMatchObject({ hasUnknownDecimals: true });
});

it.each([7, { malformed: true }])(
  'keeps indexed-token precedence over irrelevant calldata %#',
  async (input) => {
    (store.getState as jest.Mock).mockReturnValue({ vault: vault() });
    const indexed = {
      chainId: 1,
      to: tokenAddress,
      input,
      value: '1000000',
      historySource: EVM_TRANSACTION_HISTORY_SOURCE.ExplorerTokenTransfer,
      tokenTransfer: {
        chainId: 1,
        contractAddress: tokenAddress,
        recipient,
        value: '1000000',
        decimals: 6,
        symbol: 'TOK',
      },
    };
    await expect(
      getTransactionDisplayInfo(indexed, 'ETH', true)
    ).resolves.toMatchObject({
      formattedValue: '1.0',
      displaySymbol: 'TOK',
      actualRecipient: recipient,
      isErc20Transfer: true,
    });
  }
);

it('interprets an SDK data-only ERC-20 transfer without mutating the source row', async () => {
  (store.getState as jest.Mock).mockReturnValue({
    vault: vault(1, [
      {
        chainId: 1,
        contractAddress: tokenAddress,
        decimals: 6,
        tokenSymbol: 'TOK',
      },
    ]),
  });
  const { input, ...rest } = tx;
  const submitted = {
    ...rest,
    data: input,
    value: { type: 'BigNumber', hex: '0x00' },
  };
  const before = JSON.stringify(submitted);
  await expect(
    getTransactionDisplayInfo(submitted, 'ETH', true)
  ).resolves.toMatchObject({
    isErc20Transfer: true,
    displaySymbol: 'TOK',
    displayValue: '1',
    actualRecipient: recipient,
  });
  expect(JSON.stringify(submitted)).toBe(before);
});
it('does not let a data alias override a present input, including explicit empty input', async () => {
  (store.getState as jest.Mock).mockReturnValue({ vault: vault() });
  const submitted = { ...tx, input: '0x', data: tx.input, value: '0' };
  await expect(
    getTransactionDisplayInfo(submitted, 'ETH', true)
  ).resolves.toMatchObject({
    isErc20Transfer: false,
    displaySymbol: 'ETH',
  });
});
it.each(['0xa9059cbb', '0xa9059cbb' + 'ff'.repeat(64), '0xzz', 'not-hex'])(
  'does not infer a transfer from malformed or noncanonical data %#',
  async (data) => {
    (store.getState as jest.Mock).mockReturnValue({ vault: vault() });
    await expect(
      getTransactionDisplayInfo(
        { chainId: 1, to: tokenAddress, data, value: '0' },
        'ETH',
        true
      )
    ).resolves.toMatchObject({ isErc20Transfer: false });
  }
);
it('keeps a normal native data-only value native', async () => {
  (store.getState as jest.Mock).mockReturnValue({ vault: vault() });
  await expect(
    getTransactionDisplayInfo(
      { chainId: 1, to: recipient, data: '0x', value: '1000000000000000000' },
      'ETH',
      true
    )
  ).resolves.toMatchObject({ isErc20Transfer: false, displaySymbol: 'ETH' });
});
