import { ethers } from 'ethers';

import store from 'state/store';
import { setActiveAccountProperty, setIsLoadingTxs } from 'state/vault';

import { IEvmTransactionsController, ITransactionResponse } from './types';
import {
  findUserTxsInProviderByBlocksRange,
  validateAndManageUserTransactions,
} from './utils';

const EvmTransactionsController = (): IEvmTransactionsController => {
  let LAST_PROCESSED_BLOCK = -1;

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

    const treatedTxs = validateAndManageUserTransactions(providerUserTxs);

    const validateIfManageState = Boolean(
      providerUserTxs.length === 0 || treatedTxs.length === 0
    );

    //This mean that we don't have any TXs to update in state, so we can stop here
    if (validateIfManageState) return;

    updateUserTransactionsState(treatedTxs);
  };

  const firstRunForProviderTransactions = async () => {
    const { activeNetwork } = store.getState().vault;

    const provider = new ethers.providers.JsonRpcProvider(activeNetwork.url);

    const latestBlockNumber = await provider.getBlockNumber();
    const fromBlock = Math.max(0, latestBlockNumber - 30); // Get only the last 30 blocks
    const toBlock = latestBlockNumber;

    await getUserTransactionByDefaultProvider(fromBlock, toBlock);

    LAST_PROCESSED_BLOCK = toBlock;
  };

  const pollingEvmTransactions = async (
    provider:
      | ethers.providers.EtherscanProvider
      | ethers.providers.JsonRpcProvider
  ) => {
    const { isBitcoinBased } = store.getState().vault;

    console.log('running');
    const latestBlockNumber = await provider.getBlockNumber();

    const fromBlock = LAST_PROCESSED_BLOCK + 1;

    if (Boolean(isBitcoinBased || latestBlockNumber === LAST_PROCESSED_BLOCK)) {
      return;
    }

    await getUserTransactionByDefaultProvider(fromBlock, latestBlockNumber);

    LAST_PROCESSED_BLOCK = latestBlockNumber;
  };

  return {
    getUserTransactionByDefaultProvider,
    firstRunForProviderTransactions,
    pollingEvmTransactions,
  };
};

export default EvmTransactionsController;
