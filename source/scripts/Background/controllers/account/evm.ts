import { Web3Accounts } from '@pollum-io/sysweb3-keyring';
import { ICoingeckoToken } from '@pollum-io/sysweb3-utils';

import { EthTransactionController } from '../transaction';
import store from 'state/store';
import { setActiveAccountProperty } from 'state/vault';

const EthAccountController = () => {
  const getErc20TokenBalance = async (
    tokenAddress: string,
    walletAddress: string
  ) => {
    try {
      const balance = await Web3Accounts().getBalanceOfAnyToken(
        tokenAddress,
        walletAddress
      );

      return balance;
    } catch (error) {
      return 0;
    }
  };

  const saveTokenInfo = async (token: ICoingeckoToken) => {
    const { activeAccount } = store.getState().vault;

    const tokenExists = activeAccount.assets.find(
      (asset: any) => asset.id === token.id
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
  };

  const tx = EthTransactionController();

  return {
    saveTokenInfo,
    getErc20TokenBalance,
    ...Web3Accounts(),
    tx,
  };
};

export default EthAccountController;
