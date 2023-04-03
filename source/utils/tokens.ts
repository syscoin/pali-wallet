import axios from 'axios';
import { ethers } from 'ethers';
import lodash from 'lodash';

import { KeyringAccountType } from '@pollum-io/sysweb3-keyring';
import { getErc20Abi, getErc21Abi } from '@pollum-io/sysweb3-utils';

import store from 'state/store';
import { ITokenEthProps } from 'types/tokens';
const config = {
  headers: {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3',
  },
};

export const getSymbolByChain = async (chain: string) => {
  const { data } = await axios.get(
    `https://api.coingecko.com/api/v3/coins/${chain}`,
    config
  );

  return data.symbol.toString().toUpperCase();
};

export const getBalanceUpdatedToErcTokens = async (
  accountId: number,
  accountType: KeyringAccountType
) => {
  const { accounts, networks } = store.getState().vault;

  const findAccount = accounts[accountType][accountId];
  try {
    const updatedTokens = await Promise.all(
      findAccount.assets.ethereum.map(async (vaultAssets: ITokenEthProps) => {
        const provider = new ethers.providers.JsonRpcProvider(
          networks.ethereum[vaultAssets.chainId].url
        );

        const _contract = new ethers.Contract(
          vaultAssets.contractAddress,
          vaultAssets.isNft ? getErc21Abi() : getErc20Abi(),
          provider
        );

        const balanceCallMethod = await _contract.balanceOf(
          findAccount.address
        );

        const balance = vaultAssets.isNft
          ? Number(balanceCallMethod)
          : `${balanceCallMethod / 10 ** Number(vaultAssets.decimals)}`;

        const formattedBalance = vaultAssets.isNft
          ? balance
          : lodash.floor(parseFloat(balance as string), 4);

        return { ...vaultAssets, balance: formattedBalance };
      })
    );

    return updatedTokens;
  } catch (error) {
    console.error(
      "Pali utils: Couldn't update assets due to the following issue ",
      error
    );
    return findAccount.assets.ethereum;
  }
};
