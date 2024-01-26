import cloneDeep from 'lodash/cloneDeep';

import { getTokenInfoBasedOnNetwork } from '@pollum-io/sysweb3-utils';

import PaliLogo from 'assets/icons/favicon-32.png';
import store from 'state/store';
import { setAccountPropertyByIdAndType, setEditedEvmToken } from 'state/vault';
import { ITokenEthProps } from 'types/tokens';

export interface IEthAccountController {
  deleteTokenInfo: (tokenAddress: string) => void;
  editTokenInfo: (token: ITokenEthProps) => void;
  saveTokenInfo: (
    token: ITokenEthProps,
    tokenType?: string,
    currentTokens?: ITokenEthProps[]
  ) => Promise<void>;
}

const EthAccountController = (): IEthAccountController | any => {
  const saveTokenInfo = async (token: ITokenEthProps, tokenType: string) => {
    const { activeAccount, activeNetwork, accounts } = store.getState().vault;
    const { chainId } = activeNetwork;
    const activeAccountData = accounts[activeAccount.type][activeAccount.id];
    try {
      if (tokenType === 'ERC-1155') {
        const currentAssets = [...activeAccountData.assets.ethereum];

        const nftCollection = currentAssets.find(
          (nft) => nft.contractAddress === token.contractAddress
        );
        const finalToken = { ...token, chainId };

        if (nftCollection) {
          const indexItem = currentAssets.indexOf(nftCollection);

          const finalEthAssets = [
            ...accounts[activeAccount.type][
              activeAccount.id
            ].assets.ethereum.slice(0, indexItem),
            finalToken,
            ...accounts[activeAccount.type][
              activeAccount.id
            ].assets.ethereum.slice(indexItem + 1),
          ];

          store.dispatch(
            setAccountPropertyByIdAndType({
              id: activeAccount.id,
              type: activeAccount.type,
              property: 'assets',
              value: {
                ...accounts[activeAccount.type][activeAccount.id].assets,
                ethereum: finalEthAssets,
              },
            })
          );
          return;
        }

        store.dispatch(
          setAccountPropertyByIdAndType({
            id: activeAccount.id,
            type: activeAccount.type,
            property: 'assets',
            value: {
              ...accounts[activeAccount.type][activeAccount.id].assets,
              ethereum: [
                ...accounts[activeAccount.type][activeAccount.id].assets
                  .ethereum,
                finalToken,
              ],
            },
          })
        );
        return;
      }

      const tokenExists = accounts[activeAccount.type][
        activeAccount.id
      ].assets.ethereum?.find(
        (asset: ITokenEthProps) =>
          asset.contractAddress === token.contractAddress
      );

      if (tokenExists) throw new Error('Token already exists');

      let web3Token = await getTokenInfoBasedOnNetwork(token, chainId);

      if (web3Token.logo === '') {
        web3Token = {
          ...web3Token,
          logo: PaliLogo,
        };
      }

      store.dispatch(
        setAccountPropertyByIdAndType({
          id: activeAccount.id,
          type: activeAccount.type,
          property: 'assets',
          value: {
            ...accounts[activeAccount.type][activeAccount.id].assets,
            ethereum: [
              ...accounts[activeAccount.type][activeAccount.id].assets.ethereum,
              web3Token,
            ],
          },
        })
      );
    } catch (error) {
      throw new Error(`Could not save token info. Error: ${error}`);
    }
  };

  const editTokenInfo = (token: ITokenEthProps) => {
    try {
      const { activeAccount, accounts } = store.getState().vault;

      const cloneArray = cloneDeep(
        accounts[activeAccount.type][activeAccount.id].assets
      );

      const findIndex = cloneArray.ethereum.findIndex(
        (stateToken) => stateToken.contractAddress === token.contractAddress
      );

      store.dispatch(
        setEditedEvmToken({
          accountType: activeAccount.type,
          accountId: activeAccount.id,
          tokenIndex: findIndex,
          editedToken: token,
        })
      );
    } catch (error) {
      throw new Error(`Could not edit token info. Error: ${error}`);
    }
  };

  const deleteTokenInfo = (tokenAddress: string) => {
    try {
      const { activeAccount, accounts } = store.getState().vault;

      const tokenExists = accounts[activeAccount.type][
        activeAccount.id
      ].assets.ethereum?.find(
        (asset: ITokenEthProps) => asset.contractAddress === tokenAddress
      );

      if (!tokenExists) throw new Error("Token doesn't exists!");

      const cloneAssets = cloneDeep(
        accounts[activeAccount.type][activeAccount.id].assets
      );

      const newAssetsValue = {
        ...cloneAssets,
        ethereum: cloneAssets.ethereum.filter(
          (currentToken) => currentToken.contractAddress !== tokenAddress
        ),
      };

      store.dispatch(
        setAccountPropertyByIdAndType({
          id: activeAccount.id,
          type: activeAccount.type,
          property: 'assets',
          value: newAssetsValue,
        })
      );
    } catch (error) {
      throw new Error(`Could not delete token. Error: ${error}`);
    }
  };

  return {
    saveTokenInfo,
    editTokenInfo,
    deleteTokenInfo,
  };
};
export default EthAccountController;
