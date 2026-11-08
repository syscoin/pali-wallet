import { Interface } from 'ethers/abi';

import { getBlacklistTargetsForEvmCall } from '../shared/evmCallBlacklist.ts';

import { getBlacklistTargetsForEvmCallWithContractType } from './evmCallBlacklist';
import { getContractType } from './validations';

jest.mock('./validations', () => ({ getContractType: jest.fn() }));

const token = '0x1111111111111111111111111111111111111111';
const spender = '0x2222222222222222222222222222222222222222';
const abi = new Interface([
  'function approve(address spender,uint256 amount)',
  'function transfer(address to,uint256 amount)',
]);
const provider = {};
const controller = {};

beforeEach(() => jest.mocked(getContractType).mockReset());

describe('browser EVM blacklist contract-type adapter', () => {
  it.each(['ERC-20', 'ERC-721'])(
    'passes the resolved %s standard to the shared decoder',
    async (tokenStandard) => {
      const data = abi.encodeFunctionData('approve', [spender, 0]);
      jest.mocked(getContractType).mockResolvedValue({ type: tokenStandard });

      const targets = await getBlacklistTargetsForEvmCallWithContractType({
        controller,
        data,
        to: token,
        web3Provider: provider,
      });

      expect(getContractType).toHaveBeenCalledTimes(1);
      expect(getContractType).toHaveBeenCalledWith(token, provider, controller);
      expect(targets).toEqual(
        getBlacklistTargetsForEvmCall({ data, to: token, tokenStandard })
      );
    }
  );

  it('keeps unknown-standard approval targets when the type lookup fails', async () => {
    const data = abi.encodeFunctionData('approve', [spender, 0]);
    jest.mocked(getContractType).mockRejectedValue(new Error('Unavailable'));

    expect(
      await getBlacklistTargetsForEvmCallWithContractType({
        data,
        to: token,
        web3Provider: provider,
      })
    ).toEqual(getBlacklistTargetsForEvmCall({ data, to: token }));
  });

  it('does not fetch a contract type for a transfer', async () => {
    const data = abi.encodeFunctionData('transfer', [spender, 1]);
    expect(
      await getBlacklistTargetsForEvmCallWithContractType({
        data,
        to: token,
        web3Provider: provider,
      })
    ).toEqual(getBlacklistTargetsForEvmCall({ data, to: token }));
    expect(getContractType).not.toHaveBeenCalled();
  });
});
