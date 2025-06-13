import axios from 'axios';
import cloneDeep from 'lodash/cloneDeep';
import isEmpty from 'lodash/isEmpty';

import { KeyringManager } from '@pollum-io/sysweb3-keyring';

import SysTrezorController, { ISysTrezorController } from '../trezor/syscoin';
import store from 'state/store';
import { setAccountPropertyByIdAndType } from 'state/vault';
import { ITokenSysProps } from 'types/tokens';

const config = {
  headers: {
    'X-User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3',
  },
  withCredentials: true,
};

export interface ISysAccountController {
  deleteTokenInfo: (assetGuid: string) => void;
  saveTokenInfo: (token: ITokenSysProps) => Promise<void>;
  setAddress: () => Promise<string>;
  trezor: ISysTrezorController;
  // tx: ISyscoinTransactions;
}

const SysAccountController = (
  getKeyring: () => KeyringManager
): ISysAccountController => {
  const setAddress = async (): Promise<string> => {
    const keyringManager = getKeyring();
    const { activeAccount } = store.getState().vault;
    const address = await keyringManager.updateReceivingAddress();

    store.dispatch(
      setAccountPropertyByIdAndType({
        id: activeAccount.id,
        type: activeAccount.type,
        property: 'address',
        value: String(address),
      })
    );

    return address;
  };

  const saveTokenInfo = async (token: ITokenSysProps) => {
    try {
      const { activeAccount, accounts, activeNetwork } = store.getState().vault;

      // Check for duplicate considering both assetGuid AND chainId (network-specific)
      const tokenExists = accounts[activeAccount.type][
        activeAccount.id
      ].assets.syscoin.find(
        (asset: ITokenSysProps) =>
          asset.assetGuid === token.assetGuid &&
          asset.chainId === activeNetwork.chainId
      );

      if (tokenExists) throw new Error('Token already exists on this network');

      // Syscoin 5 no longer uses pubData field
      const description = token.description || '';
      const ipfsUrl = description.startsWith('https://ipfs.io/ipfs/')
        ? description
        : '';
      const assetInfos = {
        ...token,
        chainId: activeNetwork.chainId,
        description,
        image: '',
        balance:
          token.balance !== undefined && token.decimals !== undefined
            ? Number(token.balance) / Math.pow(10, Number(token.decimals))
            : 0,
      };
      if (!isEmpty(ipfsUrl)) {
        const { data } = await axios.get(ipfsUrl, config);

        assetInfos.image = data && data.image ? data.image : '';
      }

      store.dispatch(
        setAccountPropertyByIdAndType({
          id: activeAccount.id,
          type: activeAccount.type,
          property: 'assets',
          value: {
            ...accounts[activeAccount.type][activeAccount.id].assets,
            syscoin: [
              ...accounts[activeAccount.type][activeAccount.id].assets.syscoin,
              assetInfos,
            ],
          },
        })
      );
    } catch (error) {
      throw new Error(`Could not save token info. Error: ${error}`);
    }
  };

  const deleteTokenInfo = (assetGuid: string) => {
    try {
      const { activeAccount, accounts, activeNetwork } = store.getState().vault;

      // Find token considering both assetGuid AND chainId (network-specific)
      const tokenExists = accounts[activeAccount.type][
        activeAccount.id
      ].assets.syscoin?.find(
        (asset: ITokenSysProps) =>
          asset.assetGuid === assetGuid &&
          asset.chainId === activeNetwork.chainId
      );

      if (!tokenExists) throw new Error("Token doesn't exist on this network!");

      const cloneAssets = cloneDeep(
        accounts[activeAccount.type][activeAccount.id].assets
      );

      // Filter out the token by both assetGuid AND chainId
      const newAssetsValue = {
        ...cloneAssets,
        syscoin: cloneAssets.syscoin.filter(
          (currentToken) =>
            !(
              currentToken.assetGuid === assetGuid &&
              currentToken.chainId === activeNetwork.chainId
            )
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
      throw new Error(`Could not delete SPT token. Error: ${error}`);
    }
  };

  //todo we cannot call those fn directly we should call over keyring manager class
  const trezor = SysTrezorController();

  return {
    trezor,
    setAddress,
    saveTokenInfo,
    deleteTokenInfo,
  };
};

export default SysAccountController;
