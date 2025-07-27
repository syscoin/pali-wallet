import { KeyringManager } from '@sidhujag/sysweb3-keyring';
import axios from 'axios';
import isEmpty from 'lodash/isEmpty';

import store from 'state/store';
import { setAccountPropertyByIdAndType, setAccountAssets } from 'state/vault';
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
    const { activeAccount, activeNetwork, accountAssets } =
      store.getState().vault;
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

    if (!activeAccountAssets.syscoin) {
      throw new Error('Syscoin assets array not initialized');
    }

    // Check for duplicate considering both assetGuid AND chainId (network-specific)
    const tokenExists = activeAccountAssets.syscoin.find(
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
      balance: token.balance || 0, // Balance is already in correct format, don't convert
    };
    if (!isEmpty(ipfsUrl)) {
      const { data } = await axios.get(ipfsUrl, config);

      assetInfos.image = data && data.image ? data.image : '';
    }

    store.dispatch(
      setAccountAssets({
        accountId: activeAccount.id,
        accountType: activeAccount.type,
        property: 'syscoin',
        value: [...activeAccountAssets.syscoin, assetInfos],
      })
    );
  };

  const deleteTokenInfo = (assetGuid: string) => {
    try {
      const { activeAccount, accountAssets, activeNetwork } =
        store.getState().vault;

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

      if (!activeAccountAssets.syscoin) {
        throw new Error('Syscoin assets array not initialized');
      }

      // Find token considering both assetGuid AND chainId (network-specific)
      const tokenExists = activeAccountAssets.syscoin.find(
        (asset: ITokenSysProps) =>
          asset.assetGuid === assetGuid &&
          asset.chainId === activeNetwork.chainId
      );

      if (!tokenExists) throw new Error("Token doesn't exist on this network!");

      store.dispatch(
        setAccountAssets({
          accountId: activeAccount.id,
          accountType: activeAccount.type,
          property: 'syscoin',
          value: activeAccountAssets.syscoin.filter(
            (currentToken) =>
              !(
                currentToken.assetGuid === assetGuid &&
                currentToken.chainId === activeNetwork.chainId
              )
          ),
        })
      );
    } catch (error) {
      throw new Error(`Could not delete SPT token. ${error}`);
    }
  };

  //todo we cannot call those fn directly we should call over keyring manager class

  return {
    setAddress,
    saveTokenInfo,
    deleteTokenInfo,
  };
};

export default SysAccountController;
