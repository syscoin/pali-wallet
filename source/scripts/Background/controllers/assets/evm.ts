import { ethers } from 'ethers';
import lodash from 'lodash';

import {
  ISupportsInterfaceProps,
  contractChecker,
  getERC721StandardBalance,
  getTokenStandardMetadata,
} from '@pollum-io/sysweb3-utils';

import { ITokenEthProps } from 'types/tokens';

import { IAddCustomTokenResponse, IEvmAssetsController } from './types';

const EvmAssetsController = (): IEvmAssetsController => {
  const addEvmDefaultToken = async (
    token: ITokenEthProps,
    accountAddress: string,
    networkUrl: string
  ): Promise<ITokenEthProps | boolean> => {
    try {
      const provider = new ethers.providers.JsonRpcProvider(networkUrl);

      const metadata = await getTokenStandardMetadata(
        token.contractAddress,
        accountAddress,
        provider
      );

      const balance = `${metadata.balance / 10 ** Number(token.decimals)}`;
      const formattedBalance = lodash.floor(parseFloat(balance), 4);

      return {
        ...token,
        balance: formattedBalance,
      };
    } catch (error) {
      return Boolean(error);
    }
  };

  const handleERC20Tokens = async (
    walletAddres: string,
    contractAddress: string,
    decimals: number,
    provider: ethers.providers.JsonRpcProvider
  ): Promise<IAddCustomTokenResponse> => {
    try {
      const metadata = await getTokenStandardMetadata(
        contractAddress,
        walletAddres,
        provider
      );

      const balance = `${
        metadata.balance /
        10 ** (metadata.decimals ? metadata.decimals : decimals)
      }`;

      const formattedBalance = lodash.floor(parseFloat(balance), 4);

      if (metadata) {
        const assetToAdd = {
          tokenSymbol: metadata.tokenSymbol.toUpperCase(),
          contractAddress,
          decimals,
          isNft: false,
          balance: formattedBalance,
        } as ITokenEthProps;

        return {
          error: false,
          tokenToAdd: assetToAdd,
          message: 'ERC-20 Token added',
        };
      }
    } catch (error) {
      return {
        error: true,
        errorType: 'Undefined',
      };
    }
  };

  const handleERC721NFTs = async (
    walletAddres: string,
    contractAddress: string,
    symbol: string,
    decimals: number,
    provider: ethers.providers.JsonRpcProvider
  ): Promise<IAddCustomTokenResponse> => {
    try {
      const getBalance = await getERC721StandardBalance(
        contractAddress,
        walletAddres,
        provider
      );

      const balanceToNumber = Number(getBalance);

      const treatedSymbol = symbol.replaceAll(/\s/g, '').toUpperCase();

      if (
        typeof balanceToNumber !== 'number' ||
        Number.isNaN(balanceToNumber) ||
        Boolean(String(getBalance).includes('Error'))
      ) {
        await handleERC20Tokens(
          walletAddres,
          contractAddress,
          decimals,
          provider
        );

        return;
      }

      const nftToAdd = {
        tokenSymbol: treatedSymbol,
        contractAddress,
        decimals,
        isNft: true,
        balance: balanceToNumber,
      } as ITokenEthProps;

      return {
        error: false,
        tokenToAdd: nftToAdd,
        message: 'ERC-721 Token added',
      };
    } catch (error) {
      return {
        error: true,
        errorType: 'Undefined',
      };
    }
  };

  const addCustomTokenByType = async (
    walletAddres: string,
    contractAddress: string,
    symbol: string,
    decimals: number,
    provider: ethers.providers.JsonRpcProvider
  ): Promise<IAddCustomTokenResponse> => {
    //First validate contract address type
    const contractTypeResponse = (await contractChecker(
      contractAddress,
      provider.connection.url
    )) as ISupportsInterfaceProps;

    if (String(contractTypeResponse).includes('Invalid contract address')) {
      return {
        error: true,
        errorType: 'Invalid',
        message:
          'Invalid contract address. Verify the current contract address or the current network!',
      };
    }

    switch (contractTypeResponse.type) {
      case 'ERC-721':
        try {
          return await handleERC721NFTs(
            walletAddres,
            contractAddress,
            symbol,
            decimals,
            provider
          );
        } catch (_erc721Error) {
          return _erc721Error;
        }
      case 'ERC-1155':
        return {
          error: true,
          errorType: 'ERC-1155',
          message: contractTypeResponse.message,
        };
      // Default will be for cases when contract type will come as Undefined. This type is for ERC-20 cases or contracts that type
      // has not been founded
      default:
        try {
          return await handleERC20Tokens(
            walletAddres,
            contractAddress,
            decimals,
            provider
          );
        } catch (_erc20Error) {
          return _erc20Error;
        }
    }
  };

  return {
    addEvmDefaultToken,
    addCustomTokenByType,
  };
};

export default EvmAssetsController;
