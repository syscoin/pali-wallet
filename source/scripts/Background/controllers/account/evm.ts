import cloneDeep from 'lodash/cloneDeep';

import { getSearch } from '@pollum-io/sysweb3-utils';

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
  const getTokenInfoInRollux = async (tokenSymbol: string) => {
    function convertToRawGitHubUrl(gitHubUrl) {
      // Replace "github.com" with "raw.githubusercontent.com"
      const rawGitHubUrl = gitHubUrl.replace(
        'github.com',
        'raw.githubusercontent.com'
      );

      // Remove "blob/" if it exists in the URL
      return rawGitHubUrl.replace('/blob/', '/').replace('/tree/', '/');
    }

    const baseUrlToFetch = `https://github.com/syscoin/syscoin-rollux.github.io/tree/master/data/${tokenSymbol}`;

    try {
      const fetchTokenData = await fetch(baseUrlToFetch);

      const tokenDataJson = await fetchTokenData.json();

      if (tokenDataJson.payload) {
        const getTokenImage = tokenDataJson.payload.tree.items[1]
          .name as string;

        const fetchedData = await fetch(
          convertToRawGitHubUrl(`${baseUrlToFetch}/data.json`)
        );

        const convertedDataToJSON = await fetchedData.json();

        return {
          token: convertedDataToJSON as any,
          imageUrl: getTokenImage
            ? `${convertToRawGitHubUrl(baseUrlToFetch)}/${getTokenImage}`
            : '',
        };
      }
    } catch (error) {
      return {
        token: null,
        imageUrl: '',
      };
    }

    //We have to search from both because some Tokens has the Logo in SVG and others in PNG
  };

  const getTokenInfoBySearch = async (tokenSymbol: string) => {
    try {
      const { coins } = await getSearch(tokenSymbol);

      if (coins && coins[0]) {
        return coins[0];
      }
    } catch (error) {
      return null;
    }
  };

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

      const rolluxChainIds = [570, 57000];

      const isRolluxNetwork = rolluxChainIds.some(
        (rolluxChain) => rolluxChain === activeNetwork.chainId
      );

      //Fill the let with the default values that can't be different / edited
      let web3Token: ITokenEthProps = {
        ...token,
        tokenSymbol: token.editedSymbolToUse
          ? token.editedSymbolToUse
          : token.tokenSymbol,
        balance: token.balance ? token.balance : 0,
        id: token.contractAddress,
        isNft: token.isNft,
        chainId,
      };

      switch (isRolluxNetwork) {
        case true:
          const fetchTokenData = await getTokenInfoInRollux(token.tokenSymbol);

          if (fetchTokenData.token !== null && fetchTokenData.imageUrl !== '') {
            web3Token = {
              ...web3Token,
              name: fetchTokenData.token.name || token?.name,
              logo: fetchTokenData.imageUrl || token?.logo,
            };
          } else {
            const tokenResult = await getTokenInfoBySearch(token.tokenSymbol);

            if (tokenResult !== null) {
              const { name, thumb } = tokenResult;

              web3Token = {
                ...web3Token,
                name: token?.name ? token.name : name,
                logo: token?.logo ? token.logo : thumb,
              };
            } else {
              web3Token = {
                ...web3Token,
                name: token.tokenSymbol,
                logo: token?.logo ? token.logo : PaliLogo,
              };
            }
          }
          break;

        case false:
          const tokenResult = await getTokenInfoBySearch(token.tokenSymbol);

          if (tokenResult !== null) {
            const { name, thumb } = tokenResult;

            web3Token = {
              ...web3Token,
              name: token?.name ? token.name : name,
              logo: token?.logo ? token.logo : thumb,
            };
          } else {
            web3Token = {
              ...web3Token,
              name: token.tokenSymbol,
              logo: token?.logo ? token.logo : PaliLogo,
            };
          }

          break;
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
