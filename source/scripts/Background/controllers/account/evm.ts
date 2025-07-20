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
  const saveTokenInfo = async (token: ITokenEthProps) => {
    const { activeAccount, activeNetwork, accountAssets } =
      store.getState().vault;
    const { chainId } = activeNetwork;

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
      throw new Error(`Could not save token info. ${error}`);
    }
  };

  const deleteTokenInfo = (tokenAddress: string, chainId: number) => {
    try {
      const { activeAccount, accountAssets } = store.getState().vault;

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

      const tokenExists = activeAccountAssets.ethereum.find(
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
      throw new Error(`Could not delete token. ${error}`);
    }
  };

  return {
    saveTokenInfo,
    deleteTokenInfo,
  };
};
export default EthAccountController;
