import axios from 'axios';
import { Chain, chains } from 'eth-chains';
import { ethers } from 'ethers';
import { isNil, isString } from 'lodash';

import store from 'state/store';

import {
  IEvmTransaction,
  IEvmTransactionsController,
  ITransactionResponse,
} from './types';
import { getFormattedTransactionResponse } from './utils';

const EvmTransactionsController = (): IEvmTransactionsController => {
  const getInitialUserTransactions = async (): Promise<
    ITransactionResponse[]
  > => {
    const { activeNetwork, accounts, activeAccount } = store.getState().vault;

    const { address: userAddress } = accounts[activeAccount];

    const {
      label: networkLabel,
      url: networkUrl,
      chainId: networkChainId,
      default: isNetworkDefault,
      apiUrl: networkApiUrl,
    } = activeNetwork;

    const etherscanSupportedNetworks = [
      'homestead',
      'ropsten',
      'rinkeby',
      'goerli',
      'kovan',
    ];

    const networkByLabel =
      networkChainId === 1 ? 'homestead' : networkLabel.toLocaleLowerCase();

    if (isNetworkDefault) {
      if (etherscanSupportedNetworks.includes(networkByLabel)) {
        const etherscanProvider = new ethers.providers.EtherscanProvider(
          networkByLabel,
          'K46SB2PK5E3T6TZC81V1VK61EFQGMU49KA'
        );

        const getTxHistory = await etherscanProvider.getHistory(userAddress);

        const limitedTxHistory = getTxHistory.slice(0, 30); // Limit last 30 TXs

        const formattedTxs: ITransactionResponse[] = await Promise.all(
          limitedTxHistory.map(
            async (tx) =>
              await getFormattedTransactionResponse(etherscanProvider, tx)
          )
        );

        return formattedTxs;
      }

      const query = `?module=account&action=txlist&address=${userAddress}`;

      const {
        data: { result },
      } = await axios.get(`${networkApiUrl}${query}`);

      if (!isString(result)) {
        const provider = new ethers.providers.JsonRpcProvider(networkUrl);

        const formattedTxs: ITransactionResponse[] = await Promise.all(
          result.map(
            async (tx: ITransactionResponse) =>
              await getFormattedTransactionResponse(provider, tx)
          )
        );

        return formattedTxs;
      }
    }
  };

  const getSocketPendingTransactions = async (): Promise<IEvmTransaction[]> => {
    const { activeNetwork, accounts, activeAccount } = store.getState().vault;

    const { address: userAddress, transactions: userTransactions } =
      accounts[activeAccount];

    const getChain = chains.get(activeNetwork.chainId) as Chain;

    const wssUrlByChain = getChain.rpc.find((rpc) => rpc.startsWith('wss://'));

    const wssNeedApiKey = Boolean(wssUrlByChain.includes('API_KEY'));

    const validatedUrl = wssNeedApiKey ? null : wssUrlByChain;

    if (isNil(validatedUrl)) return [];

    const wssProvider = new ethers.providers.WebSocketProvider(validatedUrl);

    wssProvider.on('error', (error) => {
      console.log('error socket transactions', error);
      return userTransactions.ethereum as IEvmTransaction[];
    });

    wssProvider.on('pending', async (txHash: string) => {
      const transaction = await wssProvider.getTransaction(txHash);

      const { from, to, hash, blockNumber } = transaction;

      const isValidTx =
        transaction && (from === userAddress || to === userAddress);

      if (isValidTx) {
        const { timestamp } = await wssProvider.getBlock(Number(blockNumber));

        const txAlreadyExists =
          userTransactions.ethereum.findIndex(
            (transaction: ITransactionResponse) => transaction.hash === hash
          ) > -1;

        if (txAlreadyExists)
          return userTransactions.ethereum as IEvmTransaction[];

        const formattedTx = {
          ...transaction,
          timestamp,
        };

        // Remove last TX from state and add a new one at the beginning
        const updatedEvmTxs: IEvmTransaction[] = userTransactions.ethereum
          .pop()
          .unshift(formattedTx);

        return (userTransactions.ethereum = updatedEvmTxs);
      }
    });
  };

  return {
    getInitialUserTransactions,
    getSocketPendingTransactions,
  };
};

export default EvmTransactionsController;
