jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: jest.fn() },
}));
import store from 'state/store';

import { defaultAbiCoder, id } from './ethersV6Compat';
import { getTransactionDisplayInfo } from './transactions';
const TOKEN = '0x' + '22'.repeat(20);
const RECIPIENT = '0x' + '33'.repeat(20);
const state = (decimals: unknown = 0) => ({
  vault: {
    activeNetwork: { chainId: 1, url: 'https://rpc.invalid' },
    activeAccount: { id: 0, type: 'HDAccount' },
    accounts: { HDAccount: { 0: { address: RECIPIENT } } },
    accountAssets: {
      HDAccount: {
        0: {
          ethereum: [
            {
              chainId: 1,
              contractAddress: TOKEN,
              decimals,
              tokenSymbol: 'EXACT',
            },
          ],
        },
      },
    },
  },
});
beforeEach(() => (store.getState as jest.Mock).mockReturnValue(state()));
it.each([
  ['1', '0.000000000000000001'],
  ['9007199254740993000000000000000001', '9007199254740993.000000000000000001'],
  ['0', '0'],
])('keeps native %s exact', async (value, expected) => {
  const result = await getTransactionDisplayInfo(
    { value, to: RECIPIENT },
    'ETH',
    true
  );
  expect(result.displayValue).toBe(expected);
  expect(result.formattedValue).toBe(expected);
});
it.each([
  undefined,
  null,
  'oops',
  -1,
  Infinity,
  NaN,
  Number.MAX_SAFE_INTEGER + 1,
])('does not invent native zero for invalid input %#', async (value) => {
  const result = await getTransactionDisplayInfo(
    { value, to: RECIPIENT },
    'ETH',
    true
  );
  expect(result).toMatchObject({
    displayValue: '?',
    formattedValue: '?',
    amountUnavailable: true,
  });
});
it.each([0, 18, 81, 255])(
  'preserves known ERC20 exact units at %s decimals',
  async (decimals) => {
    (store.getState as jest.Mock).mockReturnValue(state(decimals));
    const units = '9007199254740993';
    const input =
      id('transfer(address,uint256)').slice(0, 10) +
      defaultAbiCoder
        .encode(['address', 'uint256'], [RECIPIENT, units])
        .slice(2);
    const result = await getTransactionDisplayInfo(
      { chainId: 1, to: TOKEN, input, value: '0' },
      'ETH',
      true
    );
    const padded = units.padStart(decimals + 1, '0');
    const expected = decimals
      ? padded.slice(0, -decimals) + '.' + padded.slice(-decimals)
      : units;
    expect(result.displayValue).toBe(expected);
    expect(result.formattedValue).toBe(expected);
  }
);
