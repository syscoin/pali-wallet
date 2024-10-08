import { ethers } from 'ethers';
import floor from 'lodash/floor';
import isEmpty from 'lodash/isEmpty';
import isNil from 'lodash/isNil';

import { CustomJsonRpcProvider } from '@pollum-io/sysweb3-keyring';
import {
  ISupportsInterfaceProps,
  contractChecker,
  getERC1155StandardBalance,
  getERC721StandardBalance,
  getErc20Abi,
  getErc21Abi,
  getErc55Abi,
  getNftStandardMetadata,
  getTokenStandardMetadata,
} from '@pollum-io/sysweb3-utils';

import { Queue } from '../transactions/queue';
import { IPaliAccount } from 'state/vault/types';
import { IERC1155Collection, ITokenEthProps } from 'types/tokens';

import { IAddCustomTokenResponse, IEvmAssetsController } from './types';
import { validateAndManageUserAssets } from './utils';

const EvmAssetsController = (
  w3Provider: CustomJsonRpcProvider
): IEvmAssetsController => {
  const addEvmDefaultToken = async (
    token: ITokenEthProps,
    accountAddress: string
  ): Promise<ITokenEthProps | boolean> => {
    try {
      const provider = w3Provider;

      const metadata = await getTokenStandardMetadata(
        token.contractAddress,
        accountAddress,
        provider
      );

      const balance = `${metadata.balance / 10 ** Number(token.decimals)}`;
      const formattedBalance = floor(parseFloat(balance), 4);

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
    decimals: number
  ): Promise<IAddCustomTokenResponse> => {
    try {
      const metadata = await getTokenStandardMetadata(
        contractAddress,
        walletAddres,
        w3Provider
      );

      const balance = `${
        metadata.balance /
        10 ** (metadata.decimals ? metadata.decimals : decimals)
      }`;

      const formattedBalance = floor(parseFloat(balance), 4);

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
    decimals: number
  ): Promise<IAddCustomTokenResponse> => {
    try {
      const getBalance = await getERC721StandardBalance(
        contractAddress,
        walletAddres,
        w3Provider
      );

      const balanceToNumber = Number(getBalance);

      const treatedSymbol = symbol.replaceAll(/\s/g, '').toUpperCase();

      if (
        typeof balanceToNumber !== 'number' ||
        Number.isNaN(balanceToNumber) ||
        Boolean(String(getBalance).includes('Error'))
      ) {
        await handleERC20Tokens(walletAddres, contractAddress, decimals);

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

  const handleERC1155Tokens = async (
    walletAddres: string,
    contractAddress: string,
    symbol: string,
    decimals: number
  ): Promise<IAddCustomTokenResponse> => {
    try {
      const getBalance = await getERC1155StandardBalance(
        contractAddress,
        walletAddres,
        w3Provider,
        decimals
      );

      const { name: collectionName } = await getNftStandardMetadata(
        contractAddress,
        w3Provider
      );

      const balanceToNumber = Number(getBalance);

      const treatedSymbol = symbol.replaceAll(/\s/g, '').toUpperCase();

      if (
        typeof balanceToNumber !== 'number' ||
        Number.isNaN(balanceToNumber) ||
        Boolean(String(getBalance).includes('Error'))
      ) {
        await handleERC20Tokens(walletAddres, contractAddress, decimals);

        return;
      }

      const nftToAdd = {
        contractAddress,
        id: contractAddress,
        isNft: true,
        is1155: true,
        collectionName,
        collection: [
          {
            balance: balanceToNumber,
            tokenId: +decimals,
            tokenSymbol: treatedSymbol,
          },
        ],
      } as ITokenEthProps;

      return {
        error: false,
        tokenToAdd: nftToAdd,
        message: 'ERC-1155 Token added',
      };
    } catch (error) {
      console.log({ error });
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
    decimals: number
  ): Promise<IAddCustomTokenResponse> => {
    //First validate contract address type
    const contractTypeResponse = (await contractChecker(
      contractAddress,
      w3Provider
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
            decimals
          );
        } catch (erc721Error) {
          return erc721Error;
        }
      case 'ERC-1155':
        try {
          return await handleERC1155Tokens(
            walletAddres,
            contractAddress,
            symbol,
            decimals
          );
        } catch (erc1155Error) {
          return erc1155Error;
        }
      // Default will be for cases when contract type will come as Undefined. This type is for ERC-20 cases or contracts that type
      // has not been founded
      default:
        try {
          return await handleERC20Tokens(
            walletAddres,
            contractAddress,
            decimals
          );
        } catch (erc20Error) {
          return erc20Error;
        }
    }
  };

  const updateAllEvmTokens = async (
    account: IPaliAccount,
    currentNetworkChainId: number
  ): Promise<ITokenEthProps[]> => {
    if (isEmpty(account.assets.ethereum)) return [];
    const queue = new Queue(3);

    try {
      queue.execute(
        async () =>
          await Promise.all(
            account.assets.ethereum.map(async (vaultAssets: ITokenEthProps) => {
              if (vaultAssets.chainId === currentNetworkChainId) {
                const provider = w3Provider;
                let nftContractType = null;
                let currentAbi = null;

                currentAbi = getErc20Abi();

                if (vaultAssets.isNft) {
                  nftContractType =
                    vaultAssets?.is1155 === undefined ? 'ERC-721' : 'ERC-1155';

                  currentAbi =
                    nftContractType === 'ERC-721'
                      ? getErc21Abi()
                      : getErc55Abi();
                }

                const contract = new ethers.Contract(
                  vaultAssets.contractAddress,
                  currentAbi,
                  provider
                );

                if (nftContractType === 'ERC-1155') {
                  const newCollection = (await Promise.all(
                    vaultAssets.collection.map(async (nft) => {
                      const balanceCallMethod = await contract.balanceOf(
                        account.address,
                        nft.tokenId
                      );

                      const balance = Number(balanceCallMethod);

                      return { ...nft, balance };
                    })
                  )) as IERC1155Collection[];

                  if (newCollection.length > 0) {
                    return { ...vaultAssets, collection: newCollection };
                  }
                }

                const balanceCallMethod = await contract.balanceOf(
                  account.address
                );

                const balance = vaultAssets.isNft
                  ? Number(balanceCallMethod)
                  : `${balanceCallMethod / 10 ** Number(vaultAssets.decimals)}`;

                const formattedBalance = vaultAssets.isNft
                  ? balance
                  : floor(parseFloat(balance as string), 4);

                return { ...vaultAssets, balance: formattedBalance };
              }
              return null;
            })
          )
      );

      const results = await queue.done();

      const updatedTokens = results
        .filter((result) => result.success)
        .map(({ result }) => result);

      const tokens = updatedTokens.some((entry) => isNil(entry))
        ? [...account.assets.ethereum]
        : updatedTokens.filter((entry) => !isNil(entry));

      return validateAndManageUserAssets(true, tokens) as ITokenEthProps[];
    } catch (error) {
      console.error(
        "Pali utils: Couldn't update assets due to the following issue ",
        error
      );
      return account.assets.ethereum as ITokenEthProps[];
    }
  };

  return {
    addEvmDefaultToken,
    addCustomTokenByType,
    updateAllEvmTokens,
  };
};

export default EvmAssetsController;
