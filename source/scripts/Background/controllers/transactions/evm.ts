import axios from 'axios';
import { ethers } from 'ethers';
import { isString } from 'lodash';

import store from 'state/store';
import { setActiveAccountProperty, setIsLoadingTxs } from 'state/vault';

import { etherscanSupportedNetworks } from './constants';
import { IEvmTransactionsController, ITransactionResponse } from './types';
import {
  findUserTxsInProviderByBlocksRange,
  getFormattedTransactionResponse,
  validateAndManageUserTransactions,
} from './utils';

const EvmTransactionsController = (): IEvmTransactionsController => {
  let LAST_PROCESSED_BLOCK = -1;

  const getUserTransactionsByOthersRPCs = async (): Promise<
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

      const limitedTxHistory = result.slice(0, 30);

      if (!isString(result)) {
        const provider = new ethers.providers.JsonRpcProvider(networkUrl);

        const formattedTxs: ITransactionResponse[] = await Promise.all(
          limitedTxHistory.map(
            async (tx: ITransactionResponse) =>
              await getFormattedTransactionResponse(provider, tx)
          )
        );

        return formattedTxs;
      }
    }
  };

  const updateUserTransactionsState = (treatedTxs: ITransactionResponse[]) => {
    //Only manage states if we have some Tx to update

    store.dispatch(setIsLoadingTxs(true));

    store.dispatch(
      setActiveAccountProperty({
        property: 'transactions',
        value: treatedTxs,
      })
    );

    store.dispatch(setIsLoadingTxs(false));
  };

  const getUserTransactionByDefaultProvider = async (
    startBlock: number,
    endBlock: number
  ) => {
    const { accounts, activeAccount, activeNetwork } = store.getState().vault;

    const provider = new ethers.providers.JsonRpcProvider(activeNetwork.url);

    const { address: userAddress } = accounts[activeAccount];

    const providerUserTxs = await findUserTxsInProviderByBlocksRange(
      provider,
      userAddress,
      startBlock,
      endBlock
    );
    //This mean that we don't have any TXs to update in state, so we can stop here
    if (providerUserTxs.length === 0) return;

    const treatedTxs = validateAndManageUserTransactions(providerUserTxs);

    updateUserTransactionsState(treatedTxs);
  };

  const firstRunForTransactions = async () => {
    const { activeNetwork } = store.getState().vault;

    const provider = new ethers.providers.JsonRpcProvider(activeNetwork.url);

    const latestBlockNumber = await provider.getBlockNumber();
    const fromBlock = Math.max(0, latestBlockNumber - 10); // Get only the last 10 blocks
    const toBlock = latestBlockNumber;

    await getUserTransactionByDefaultProvider(fromBlock, toBlock);

    LAST_PROCESSED_BLOCK = toBlock;
  };

  const pollTransactions = async (
    provider:
      | ethers.providers.EtherscanProvider
      | ethers.providers.JsonRpcProvider
  ) => {
    console.log('running');
    const latestBlockNumber = await provider.getBlockNumber();

    const fromBlock = LAST_PROCESSED_BLOCK + 1;

    if (latestBlockNumber === LAST_PROCESSED_BLOCK) {
      return;
    }

    await getUserTransactionByDefaultProvider(fromBlock, latestBlockNumber);

    LAST_PROCESSED_BLOCK = latestBlockNumber;

    setTimeout(pollTransactions, 20000); //20s
  };

  return {
    getUserTransactionsByOthersRPCs,
    getUserTransactionByDefaultProvider,
    firstRunForTransactions,
  };
};

export default EvmTransactionsController;
