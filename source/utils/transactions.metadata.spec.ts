jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: jest.fn() },
}));

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
      displayValue: 1,
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
