import PaliLogo from 'assets/all_assets/favicon-32.png';
import store from 'state/store';
import { setAccountAssets } from 'state/vault';
import { ITokenEthProps } from 'types/tokens';
import { normalizeNftTokenId } from 'utils/nftTokenId';

import { getAccountAssets, requireAssetArray } from './getAccountAssets';

export interface IEthAccountController {
  prepareTokenAddition: (
    token: ITokenEthProps
  ) => Promise<() => ReturnType<typeof setAccountAssets>>;
  prepareTokenRemoval: (
    tokenAddress: string,
    chainId: number,
    tokenId?: string
  ) => () => ReturnType<typeof setAccountAssets>;
}

const EthAccountController = (): IEthAccountController => {
  const prepareTokenAddition = async (token: ITokenEthProps) => {
    const tokenId =
      token.tokenStandard === 'ERC-1155'
        ? normalizeNftTokenId(token.tokenId)
        : undefined;
    const { activeAccount, activeNetwork, accountAssets } =
      store.getState().vault;
    const { chainId } = activeNetwork;

    const activeAccountAssets = getAccountAssets(accountAssets, activeAccount);

    requireAssetArray(activeAccountAssets.ethereum, 'Ethereum');

    return () => {
      const currentAssets = requireAssetArray(
        store.getState().vault.accountAssets?.[activeAccount.type]?.[
          activeAccount.id
        ]?.ethereum,
        'Ethereum'
      );
      const tokenExists = currentAssets.find((asset: ITokenEthProps) => {
        // SYSCOIN: The same address may name different assets on other chains.
        if (asset.chainId !== chainId) return false;
        // For ERC-1155 tokens, check both contract address and tokenId
        if (
          asset.tokenStandard === 'ERC-1155' &&
          token.tokenStandard === 'ERC-1155'
        ) {
          if (
            asset.contractAddress.toLowerCase() !==
            token.contractAddress.toLowerCase()
          )
            return false;
          try {
            return normalizeNftTokenId(asset.tokenId) === tokenId;
          } catch {
            return false;
          }
        }
        // For other token types, just check contract address
        return (
          asset.contractAddress.toLowerCase() ===
          token.contractAddress.toLowerCase()
        );
      });

      if (tokenExists) {
        if (token.tokenStandard === 'ERC-1155') {
          throw new Error(`ERC-1155 token with ID ${tokenId} already exists`);
        } else {
          throw new Error('Token already exists');
        }
      }

      // Use token data as-is
      const web3Token = {
        ...token,
        ...(tokenId !== undefined && { tokenId }),
        // For ERC-1155, include tokenId in the id to make it unique
        id:
          tokenId !== undefined
            ? `${token.contractAddress.toLowerCase()}-${chainId}-${tokenId}`
            : `${token.contractAddress.toLowerCase()}-${chainId}`,
        chainId,
        logo: token.logo || PaliLogo,
      };

      return setAccountAssets({
        accountId: activeAccount.id,
        accountType: activeAccount.type,
        property: 'ethereum',
        value: [...currentAssets, web3Token],
      });
    };
  };

  const prepareTokenRemoval = (
    tokenAddress: string,
    chainId: number,
    tokenId?: string
  ) => {
    const { activeAccount } = store.getState().vault;
    return () => {
      const { accountAssets } = store.getState().vault;

      const activeAccountAssets = getAccountAssets(
        accountAssets,
        activeAccount
      );

      const currentAssets = requireAssetArray(
        activeAccountAssets.ethereum,
        'Ethereum'
      );

      const matchesToken = (asset: ITokenEthProps) =>
        asset.contractAddress.toLowerCase() === tokenAddress.toLowerCase() &&
        asset.chainId === chainId &&
        (!tokenId || asset.tokenId === tokenId);
      const tokenExists = currentAssets.find(matchesToken);

      if (!tokenExists)
        throw new Error("Token doesn't exist on specified network!");

      return setAccountAssets({
        accountId: activeAccount.id,
        accountType: activeAccount.type,
        property: 'ethereum',
        value: currentAssets.filter(
          (currentToken) => !matchesToken(currentToken)
        ),
      });
    };
  };

  return {
    prepareTokenAddition,
    prepareTokenRemoval,
  };
};
export default EthAccountController;
