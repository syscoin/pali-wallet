import axios from 'axios';
import { isEmpty } from 'lodash';

import {
  KeyringManager,
  ISyscoinTransactions,
  SyscoinTransactions,
} from '@pollum-io/sysweb3-keyring';

import SysTrezorController, { ISysTrezorController } from '../trezor/syscoin';
import store from 'state/store';
import { setActiveAccountProperty } from 'state/vault';
import { ITokenSysProps } from 'types/tokens';
export interface ISysAccountController {
  saveTokenInfo: (token: ITokenSysProps) => Promise<void>;
  setAddress: () => Promise<string>;
  trezor: ISysTrezorController;
  tx: ISyscoinTransactions;
}

const SysAccountController = (): ISysAccountController => {
  const keyringManager = KeyringManager();

  const setAddress = async (): Promise<string> => {
    const {
      accountLatestUpdate: { address },
    } = await keyringManager.getLatestUpdateForAccount();

    store.dispatch(
      setActiveAccountProperty({
        property: 'address',
        value: String(address),
      })
    );

    return address;
  };

  const saveTokenInfo = async (token: ITokenSysProps) => {
    try {
      const { activeAccount, accounts } = store.getState().vault;

      const tokenExists = accounts[activeAccount].assets.syscoin.find(
        (asset: ITokenSysProps) => asset.assetGuid === token.assetGuid
      );

      if (tokenExists) throw new Error('Token already exists');

      const description =
        token.pubData && token.pubData.desc ? atob(token.pubData.desc) : '';

      const ipfsUrl = description.startsWith('https://ipfs.io/ipfs/')
        ? description
        : '';

      const assetInfos = {
        ...token,
        description,
        image: '',
        balance: Number(token.balance) / 10 ** Number(token.decimals),
      };

      if (!isEmpty(ipfsUrl)) {
        const { data } = await axios.get(ipfsUrl);

        assetInfos.image = data && data.image ? data.image : '';
      }

      store.dispatch(
        setActiveAccountProperty({
          property: 'assets',
          value: {
            ...accounts[activeAccount].assets,
            syscoin: [...accounts[activeAccount].assets.syscoin, assetInfos],
          },
        })
      );
    } catch (error) {
      throw new Error(`Could not save token info. Error: ${error}`);
    }
  };

  const trezor = SysTrezorController();
  const tx = SyscoinTransactions();

  return {
    trezor,
    tx,
    setAddress,
    saveTokenInfo,
  };
};

export default SysAccountController;
