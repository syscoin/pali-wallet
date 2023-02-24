import {
  IEthereumTransactions,
  EthereumTransactions,
  IWeb3Accounts,
  Web3Accounts,
  IKeyringAccountState,
} from '@pollum-io/sysweb3-keyring';
import { getSearch } from '@pollum-io/sysweb3-utils';

import PaliLogo from 'assets/icons/favicon-32.png';
import store from 'state/store';
import {
  setAccounts,
  setAccountTransactions,
  setActiveAccount,
  setActiveAccountProperty,
} from 'state/vault';
import { ITokenEthProps } from 'types/tokens';

export interface IEthTransactions extends IEthereumTransactions {
  saveTransaction: (tx: any) => void;
  sendAndSaveTransaction: (tx: any) => Promise<void>;
}

export interface IEthAccountController extends IWeb3Accounts {
  importAccountByPrivKey: (
    privKey: string,
    label?: string
  ) => Promise<IKeyringAccountState>;
  saveTokenInfo: (token: ITokenEthProps) => Promise<void>;
  tx: IEthTransactions;
}

const EthAccountController = (): IEthAccountController => {
  const txs = EthereumTransactions();
  const web3Accounts = Web3Accounts();
  const { importAccount, getBalance, getUserTransactions } = web3Accounts;

  const importAccountByPrivKey = async (privKey: string, label?: string) => {
    const { activeNetwork, accounts, isBitcoinBased } = store.getState().vault;
    if (isBitcoinBased) return;
    if (privKey) {
      const account = importAccount(`0x${privKey}`);
      const { address, publicKey, privateKey } = account;
      const importedAccount = {
        address,
        assets: { syscoin: [], ethereum: [] },
        isTrezorWallet: false,
        label: label ? label : `Account ${Object.values(accounts).length + 1}`,
        id: Object.values(accounts).length,
        balances: {
          syscoin: 0,
          ethereum: await getBalance(address),
        },
        xprv: privateKey,
        xpub: publicKey,
        transactions: await getUserTransactions(address, activeNetwork),
      } as IKeyringAccountState;
      store.dispatch(
        setAccounts({
          ...accounts,
          [Object.values(accounts).length]: importedAccount,
        })
      );
      store.dispatch(setActiveAccount(importedAccount.id));
      return importedAccount;
    }
  };

  const saveTokenInfo = async (token: ITokenEthProps) => {
    try {
      const { activeAccount, activeNetwork, accounts } = store.getState().vault;
      const { chainId } = activeNetwork;

      const tokenExists = accounts[activeAccount].assets.ethereum?.find(
        (asset: ITokenEthProps) =>
          asset.contractAddress === token.contractAddress
      );

      if (tokenExists) throw new Error('Token already exists');

      let web3Token: ITokenEthProps;

      const { coins } = await getSearch(token.tokenSymbol);

      if (coins && coins[0]) {
        const { name, thumb } = coins[0];

        web3Token = {
          ...token,
          balance: token.balance,
          name,
          id: token.contractAddress,
          logo: thumb,
          isNft: token.isNft,
          chainId,
        };
      } else {
        web3Token = {
          ...token,
          balance: token.balance,
          name: token.tokenSymbol,
          id: token.contractAddress,
          logo: PaliLogo,
          isNft: token.isNft,
          chainId,
        };
      }

      store.dispatch(
        setActiveAccountProperty({
          property: 'assets',
          value: {
            ...accounts[activeAccount].assets,
            ethereum: [...accounts[activeAccount].assets.ethereum, web3Token],
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
    importAccountByPrivKey,
    ...web3Accounts,
  };
};

export default EthAccountController;

export const saveTransaction = (tx: any) => {
  const finalTx = { ...tx, timestamp: Math.floor(Date.now() / 1000) };
  store.dispatch(setAccountTransactions(finalTx));
};
