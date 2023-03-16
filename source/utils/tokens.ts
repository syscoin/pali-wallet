import axios from 'axios';
import { ethers } from 'ethers';
import lodash from 'lodash';

import { getErc20Abi, getErc21Abi } from '@pollum-io/sysweb3-utils';

import store from 'state/store';
import { ITokenEthProps } from 'types/tokens';

export const getSymbolByChain = async (chain: string) => {
  const { data } = await axios.get(
    `https://api.coingecko.com/api/v3/coins/${chain}`
  );

  return data.symbol.toString().toUpperCase();
};

//Remove this function later, will be only in EvmAssetsController
export const getBalanceUpdatedToErcTokens = async () => {
  const { accounts, networks, activeAccount } = store.getState().vault;

  const findAccount = accounts[activeAccount];
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
