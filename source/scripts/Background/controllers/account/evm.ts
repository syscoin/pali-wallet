import cloneDeep from 'lodash/cloneDeep';

import PaliLogo from 'assets/all_assets/favicon-32.png';
import store from 'state/store';
import { setAccountAssets } from 'state/vault';
import { ITokenEthProps } from 'types/tokens';

export interface IEthAccountController {
  deleteTokenInfo: (tokenAddress: string, chainId: number) => void;
  saveTokenInfo: (
    token: ITokenEthProps,
    tokenType?: string,
    currentTokens?: ITokenEthProps[]
  ) => Promise<void>;
}

const EthAccountController = (): IEthAccountController | any => {
  const saveTokenInfo = async (token: ITokenEthProps, tokenType: string) => {
    const { activeAccount, activeNetwork, accountAssets } =
      store.getState().vault;
    const { chainId } = activeNetwork;
    const activeAccountAssets =
      accountAssets[activeAccount.type][activeAccount.id];
    try {
      if (tokenType === 'ERC-1155') {
        const currentAssets = [...activeAccountAssets.ethereum];

        const nftCollection = currentAssets.find(
          (nft) => nft.contractAddress === token.contractAddress
        );
        const finalToken = { ...token, chainId };

        if (nftCollection) {
          const indexItem = currentAssets.indexOf(nftCollection);

          const finalEthAssets = [
            ...activeAccountAssets.ethereum.slice(0, indexItem),
            finalToken,
            ...activeAccountAssets.ethereum.slice(indexItem + 1),
          ];

          store.dispatch(
            setAccountAssets({
              accountId: activeAccount.id,
              accountType: activeAccount.type,
              property: 'ethereum',
              value: finalEthAssets,
            })
          );
          return;
        }

        store.dispatch(
          setAccountAssets({
            accountId: activeAccount.id,
            accountType: activeAccount.type,
            property: 'ethereum',
            value: [...activeAccountAssets.ethereum, finalToken],
          })
        );
        return;
      }

      const tokenExists = activeAccountAssets.ethereum?.find(
        (asset: ITokenEthProps) =>
          asset.contractAddress === token.contractAddress
      );

      if (tokenExists) throw new Error('Token already exists');

      // Use token data as-is
      let web3Token = {
        ...token,
        id: token.contractAddress,
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
      throw new Error(`Could not save token info. Error: ${error}`);
    }
  };

  const deleteTokenInfo = (tokenAddress: string, chainId: number) => {
    try {
      const { activeAccount, accountAssets } = store.getState().vault;
      const activeAccountAssets =
        accountAssets[activeAccount.type][activeAccount.id];

      const tokenExists = activeAccountAssets.ethereum?.find(
        (asset: ITokenEthProps) =>
          asset.contractAddress === tokenAddress && asset.chainId === chainId
      );

      if (!tokenExists)
        throw new Error("Token doesn't exist on specified network!");

      const cloneAssets = cloneDeep(activeAccountAssets);

      store.dispatch(
        setAccountAssets({
          accountId: activeAccount.id,
          accountType: activeAccount.type,
          property: 'ethereum',
          value: cloneAssets.ethereum.filter(
            (currentToken) =>
              currentToken.contractAddress !== tokenAddress ||
              currentToken.chainId !== chainId
          ),
        })
      );
    } catch (error) {
      throw new Error(`Could not delete token. Error: ${error}`);
    }
  };

  return {
    saveTokenInfo,
    deleteTokenInfo,
  };
};
export default EthAccountController;
