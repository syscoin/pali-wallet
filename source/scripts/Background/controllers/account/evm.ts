import { Web3Accounts } from '@pollum-io/sysweb3-keyring';
import { ICoingeckoToken, IEthereumNftDetails } from '@pollum-io/sysweb3-utils';

import { EthTransactionController } from '../transaction';
import store from 'state/store';
import { setActiveAccountProperty } from 'state/vault';

const EthAccountController = () => {
  const saveTokenInfo = async (
    token: ICoingeckoToken | IEthereumNftDetails
  ) => {
    try {
      const { activeAccount } = store.getState().vault;

      const tokenExists = activeAccount.assets.find(
        (asset: any) => asset.contractAddress === token.contractAddress
      );

      if (tokenExists) throw new Error('Token already exists');

      const balance = await getErc20TokenBalance(
        String(token.contractAddress),
        activeAccount.address
      );

      const web3Token = {
        ...token,
        balance,
      };

      store.dispatch(
        setActiveAccountProperty({
          property: 'assets',
          value: [...activeAccount.assets, web3Token],
        })
      );
    } catch (error) {
      throw new Error(`Could not save token info. Error: ${error}`);
    }
  };

  const tx = EthTransactionController();

  const { getErc20TokenBalance } = Web3Accounts();

  return {
    saveTokenInfo,
    getErc20TokenBalance,
    ...Web3Accounts(),
    tx,
  };
};

export default EthAccountController;
