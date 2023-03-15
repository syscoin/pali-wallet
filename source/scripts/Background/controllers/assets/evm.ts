import { ethers } from 'ethers';
import lodash from 'lodash';

import {
  ISupportsInterfaceProps,
  contractChecker,
  getERC721StandardBalance,
  getTokenStandardMetadata,
} from '@pollum-io/sysweb3-utils';

import { ITokenEthProps } from 'types/tokens';
import { getController } from 'utils/browser';

const EvmAssetsController = (): IEvmAssetsController => {
  const controller = getController();

  const addEvmDefaultToken = async (
    token: ITokenEthProps,
    accountAddress: string,
    networkUrl: string
  ) => {
    try {
      const provider = new ethers.providers.JsonRpcProvider(networkUrl);

      const metadata = await getTokenStandardMetadata(
        token.contractAddress,
        accountAddress,
        provider
      );

      const balance = `${metadata.balance / 10 ** Number(token.decimals)}`;
      const formattedBalance = lodash.floor(parseFloat(balance), 4);

      await controller.wallet.account.eth.saveTokenInfo({
        ...token,
        balance: formattedBalance,
      });

      return true;
    } catch (error) {
      return false;
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
        await controller.wallet.account.eth.saveTokenInfo({
          tokenSymbol: metadata.tokenSymbol.toUpperCase(),
          contractAddress,
          decimals,
          isNft: false,
          balance: formattedBalance,
        });

        return {
          error: false,
          errorType: '',
          message: 'ERC-20 Token added',
        };
      }
    } catch (error) {
      return {
        error: true,
        errorType: 'Undefined',
        message: '',
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

      await controller.wallet.account.eth.saveTokenInfo({
        tokenSymbol: treatedSymbol,
        contractAddress,
        decimals,
        isNft: true,
        balance: balanceToNumber,
      });

      return {
        error: false,
        errorType: '',
        message: 'ERC-721 Token added',
      };
    } catch (error) {
      return {
        error: true,
        errorType: 'Undefined',
        message: '',
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
        await handleERC721NFTs(
          walletAddres,
          contractAddress,
          symbol,
          decimals,
          provider
        );
        break;
      case 'ERC-1155':
        return {
          error: true,
          errorType: 'ERC-1155',
          message: contractTypeResponse.message,
        };
      // Default will be for cases when contract type will come as Undefined. This type is for ERC-20 cases or contracts that type
      // has not been founded
      default:
        await handleERC20Tokens(
          walletAddres,
          contractAddress,
          decimals,
          provider
        );
        break;
    }
  };

  return {
    addEvmDefaultToken,
    addCustomTokenByType,
  };
};

interface IAddCustomTokenResponse {
  error: boolean;
  errorType: string;
  message: string;
}

export interface IEvmAssetsController {
  addCustomTokenByType: (
    walletAddres: string,
    contractAddress: string,
    symbol: string,
    decimals: number,
    provider: ethers.providers.JsonRpcProvider
  ) => Promise<IAddCustomTokenResponse>;
  addEvmDefaultToken: (
    token: ITokenEthProps,
    accountAddress: string,
    networkUrl: string
  ) => Promise<boolean>;
}

export default EvmAssetsController;
