import {
  IEthereumTransactions,
  EthereumTransactions,
  IWeb3Accounts,
  Web3Accounts,
} from '@pollum-io/sysweb3-keyring';
import { getSearch } from '@pollum-io/sysweb3-utils';

import store from 'state/store';
import { setAccountTransactions, setActiveAccountProperty } from 'state/vault';

export interface IEthTransactions extends IEthereumTransactions {
  saveTransaction: (tx: any) => void;
  sendAndSaveTransaction: (tx: any) => Promise<void>;
}

export interface IEthAccountController extends IWeb3Accounts {
  saveTokenInfo: (token: any) => Promise<void>;
  tx: IEthTransactions;
}

const EthAccountController = (): IEthAccountController => {
  const txs = EthereumTransactions();
  const web3Accounts = Web3Accounts();

  const saveTokenInfo = async (token: any) => {
    try {
      const { activeAccount, activeNetwork } = store.getState().vault;
      const { chainId } = activeNetwork;

      const tokenExists = activeAccount.assets.ethereum?.find(
        (asset: any) => asset.contractAddress === token.contractAddress
      );

      if (tokenExists) throw new Error('Token already exists');

      const { coins } = await getSearch(token.tokenSymbol);

      const { name, thumb } = coins[0];

      const web3Token = {
        ...token,
        balance: token.balance,
        name,
        id: token.contractAddress,
        logo: thumb,
        isNft: false,
        chainId,
      };

      store.dispatch(
        setActiveAccountProperty({
          property: 'assets',
          value: {
            ...activeAccount.assets,
            ethereum: [...activeAccount.assets.ethereum, web3Token],
          },
        })
      );
    } catch (error) {
      throw new Error(`Could not save token info. Error: ${error}`);
    }
  };

  const sendAndSaveTransaction = async (tx: any) => {
    store.dispatch(setAccountTransactions(await txs.sendTransaction(tx)));
  };

  const saveTransaction = (tx: any) => {
    store.dispatch(setAccountTransactions(tx));
  };

  const tx: IEthTransactions = {
    sendAndSaveTransaction,
    saveTransaction,
    ...txs,
  };

  return {
    saveTokenInfo,
    tx,
    ...web3Accounts,
  };
};

export default EthAccountController;

export const saveTransaction = (tx: any) => {
  store.dispatch(setAccountTransactions(tx));
};
