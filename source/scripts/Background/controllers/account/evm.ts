import cloneDeep from 'lodash/cloneDeep';

import PaliLogo from 'assets/all_assets/favicon-32.png';
import store from 'state/store';
import { setAccountAssets } from 'state/vault';
import { ITokenEthProps } from 'types/tokens';

export interface IEthAccountController {
  deleteTokenInfo: (
    tokenAddress: string,
    chainId: number,
    tokenId?: string
  ) => void;
  saveTokenInfo: (
    token: ITokenEthProps,
    tokenType?: string,
    currentTokens?: ITokenEthProps[]
  ) => Promise<void>;
}

const EthAccountController = (): IEthAccountController | any => {
  const saveTokenInfo = async (token: ITokenEthProps) => {
    const { activeAccount, activeNetwork, accountAssets } =
      store.getState().vault;
    const { chainId } = activeNetwork;

    // Validate accountAssets exists
    if (!accountAssets) {
      throw new Error('Account assets not initialized');
    }

    // Validate account type exists
    if (!accountAssets[activeAccount.type]) {
      throw new Error(
        `Account type '${activeAccount.type}' not found in accountAssets`
      );
    }

    // Validate account ID exists
    const activeAccountAssets =
      accountAssets[activeAccount.type][activeAccount.id];
    if (!activeAccountAssets) {
      throw new Error(
        `Account ID '${activeAccount.id}' not found for account type '${activeAccount.type}'`
      );
    }

    if (!activeAccountAssets.ethereum) {
      throw new Error('Ethereum assets array not initialized');
    }

    try {
      const tokenExists = activeAccountAssets.ethereum.find(
        (asset: ITokenEthProps) => {
          // For ERC-1155 tokens, check both contract address and tokenId
          if (
            asset.tokenStandard === 'ERC-1155' &&
            token.tokenStandard === 'ERC-1155'
          ) {
            return (
              asset.contractAddress.toLowerCase() ===
                token.contractAddress.toLowerCase() &&
              asset.tokenId === token.tokenId
            );
          }
          // For other token types, just check contract address
          return (
            asset.contractAddress.toLowerCase() ===
            token.contractAddress.toLowerCase()
          );
        }
      );

      if (tokenExists) {
        if (token.tokenStandard === 'ERC-1155') {
          throw new Error(
            `ERC-1155 token with ID ${token.tokenId} already exists`
          );
        } else {
          throw new Error('Token already exists');
        }
      }

      // Use token data as-is
      let web3Token = {
        ...token,
        // For ERC-1155, include tokenId in the id to make it unique
        id:
          token.tokenStandard === 'ERC-1155' && token.tokenId
            ? `${token.contractAddress.toLowerCase()}_${token.tokenId}`
            : token.contractAddress.toLowerCase(),
        chainId,
      };

      // Only add fallback logo if no logo is provided
      if (!web3Token.logo || web3Token.logo === '') {
        web3Token = {
          ...web3Token,
          logo: PaliLogo,
        };
      }

      store.dispatch(
        setAccountAssets({
          accountId: activeAccount.id,
          accountType: activeAccount.type,
          property: 'ethereum',
          value: [...activeAccountAssets.ethereum, web3Token],
        })
      );
    } catch (error) {
      throw new Error(`Could not save token info. ${error}`);
    }
  };

  const deleteTokenInfo = (
    tokenAddress: string,
    chainId: number,
    tokenId?: string
  ) => {
    try {
      const { activeAccount, accountAssets } = store.getState().vault;

      // Validate accountAssets exists
      if (!accountAssets) {
        throw new Error('Account assets not initialized');
      }

      // Validate account type exists
      if (!accountAssets[activeAccount.type]) {
        throw new Error(
          `Account type '${activeAccount.type}' not found in accountAssets`
        );
      }

      // Validate account ID exists
      const activeAccountAssets =
        accountAssets[activeAccount.type][activeAccount.id];
      if (!activeAccountAssets) {
        throw new Error(
          `Account ID '${activeAccount.id}' not found for account type '${activeAccount.type}'`
        );
      }

      if (!activeAccountAssets.ethereum) {
        throw new Error('Ethereum assets array not initialized');
      }

      // Check if token exists with optional tokenId consideration
      const tokenExists = activeAccountAssets.ethereum.find(
        (asset: ITokenEthProps) => {
          // Compare addresses case-insensitively
          const matchesAddress =
            asset.contractAddress.toLowerCase() ===
              tokenAddress.toLowerCase() && asset.chainId === chainId;
          // If tokenId is provided, also check it matches
          if (tokenId) {
            return matchesAddress && asset.tokenId === tokenId;
          }
          return matchesAddress;
        }
      );

      if (!tokenExists)
        throw new Error("Token doesn't exist on specified network!");

      const cloneAssets = cloneDeep(activeAccountAssets);

      store.dispatch(
        setAccountAssets({
          accountId: activeAccount.id,
          accountType: activeAccount.type,
          property: 'ethereum',
          value: cloneAssets.ethereum.filter((currentToken) => {
            const matchesAddress =
              currentToken.contractAddress.toLowerCase() ===
                tokenAddress.toLowerCase() && currentToken.chainId === chainId;
            // If tokenId is provided, only remove if tokenId also matches
            if (tokenId) {
              return !(matchesAddress && currentToken.tokenId === tokenId);
            }
            // If no tokenId provided, remove all tokens from this contract address
            return !matchesAddress;
          }),
        })
      );
    } catch (error) {
      throw new Error(`Could not delete token. ${error}`);
    }
  };

  return {
    saveTokenInfo,
    deleteTokenInfo,
  };
};
export default EthAccountController;
