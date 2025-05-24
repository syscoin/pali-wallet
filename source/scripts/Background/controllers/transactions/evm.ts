import flatMap from 'lodash/flatMap';

import { CustomJsonRpcProvider } from '@pollum-io/sysweb3-keyring';

import store from 'state/store';

import { IEvmTransactionsController, IEvmTransactionResponse } from './types';
import {
  findUserTxsInProviderByBlocksRange,
  validateAndManageUserTransactions,
} from './utils';

const EvmTransactionsController = (
  web3Provider: CustomJsonRpcProvider
): IEvmTransactionsController => {
  const getUserTransactionByDefaultProvider = async (
    startBlock: number,
    endBlock: number
  ) => {
    const provider = web3Provider;

    const providerUserTxs = await findUserTxsInProviderByBlocksRange(
      provider,
      startBlock,
      endBlock
    );

    const treatedTxs = validateAndManageUserTransactions(providerUserTxs);

    return treatedTxs as IEvmTransactionResponse[];
  };

  const fetchTransactionsFromAPI = async (
    address: string,
    chainId: number,
    apiUrl?: string
  ): Promise<IEvmTransactionResponse[] | null> => {
    if (!apiUrl) return null;

    try {
      // Most block explorers (Etherscan, Polygonscan, Blockscout, etc.) use this same API format
      // Reference: https://docs.blockscout.com/devs/apis/rpc/account
      const url = new URL(apiUrl);

      // Extract API key if it's already in the URL
      const existingApiKey =
        url.searchParams.get('apikey') || url.searchParams.get('apiKey');

      // Build the API request
      url.searchParams.set('module', 'account');
      url.searchParams.set('action', 'txlist');
      url.searchParams.set('address', address);
      url.searchParams.set('startblock', '0');
      url.searchParams.set('endblock', '99999999');
      url.searchParams.set('sort', 'desc');
      url.searchParams.set('page', '1');
      url.searchParams.set('offset', '50');

      // Preserve the API key if it was in the original URL
      // Reference: https://docs.blockscout.com/using-blockscout/my-account/api-keys
      if (existingApiKey) {
        url.searchParams.set('apikey', existingApiKey);
      }

      const response = await fetch(url.toString());

      if (!response.ok) {
        console.error(`API request failed with status ${response.status}`);
        return null;
      }

      const data = await response.json();

      // Both Etherscan and Blockscout use the same response format
      if (data.status === '1' && data.result && Array.isArray(data.result)) {
        // Get latest block number for accurate confirmation calculation
        const latestBlockNumber = await web3Provider.getBlockNumber();

        // Convert to our internal format
        const transactions = data.result.map((tx: any) => {
          // Recalculate confirmations using latest block number instead of API data
          // API confirmation data might be stale
          const txBlockNumber = parseInt(tx.blockNumber);
          const confirmations =
            txBlockNumber > 0
              ? Math.max(0, latestBlockNumber - txBlockNumber)
              : 0;

          return {
            hash: tx.hash,
            from: tx.from,
            to: tx.to,
            value: tx.value,
            blockNumber: txBlockNumber,
            blockHash: tx.blockHash,
            timestamp: parseInt(tx.timeStamp),
            confirmations, // Use recalculated confirmations
            chainId: chainId,
            input: tx.input,
            gasPrice: tx.gasPrice,
            gas: tx.gas || tx.gasLimit, // Blockscout may use 'gas' or 'gasLimit'
            nonce: parseInt(tx.nonce),
          };
        });

        return transactions;
      } else {
        console.log('API response not in expected format:', data);
      }
    } catch (error) {
      console.error('Error fetching from API:', error);
    }

    return null;
  };

  const fetchTransactionDetailsFromAPI = async (
    hash: string,
    apiUrl: string
  ): Promise<any> => {
    try {
      const url = new URL(apiUrl);
      const apiKey = url.searchParams.get('apikey') || '';
      url.search = '';

      const apiEndpoint = `${url.toString()}?module=transaction&action=gettxinfo&txhash=${hash}${
        apiKey ? `&apikey=${apiKey}` : ''
      }`;

      const response = await fetch(apiEndpoint);
      const data = await response.json();

      if (data.status === '1' && data.result) {
        return data.result;
      }
    } catch (error) {
      console.error('Failed to fetch transaction details from API:', error);
    }
    return null;
  };

  const pollingEvmTransactions = async () => {
    try {
      const { activeAccount, accounts, activeNetwork, currentBlock } =
        store.getState().vault;
      const currentAccount = accounts[activeAccount.type][activeAccount.id];
      const currentBlockNumber = currentBlock?.number;
      const currentNetworkChainId = activeNetwork?.chainId;
      const rpcForbiddenList = [10];

      let allTransactions: IEvmTransactionResponse[] = [];

      // Try to fetch from external API first (more efficient)
      if (activeNetwork?.apiUrl) {
        console.log(
          `[pollingEvmTransactions] Attempting to fetch from API for ${currentAccount.address}`
        );
        const apiTransactions = await fetchTransactionsFromAPI(
          currentAccount.address,
          currentNetworkChainId,
          activeNetwork.apiUrl
        );

        if (apiTransactions && apiTransactions.length > 0) {
          console.log(
            `[pollingEvmTransactions] Found ${apiTransactions.length} transactions from API`
          );
          allTransactions = apiTransactions;
        }
      }

      // Also scan recent blocks for very recent transactions that might not be in the API yet
      const latestBlockNumber = await web3Provider.getBlockNumber();
      const adjustedBlock = currentBlockNumber
        ? latestBlockNumber - parseInt(String(currentBlockNumber), 16)
        : 0;

      let blocksToSearch;

      if (
        currentBlockNumber &&
        currentNetworkChainId &&
        rpcForbiddenList.includes(currentNetworkChainId)
      ) {
        blocksToSearch = Math.min(10, adjustedBlock);
      } else if (
        currentNetworkChainId &&
        rpcForbiddenList.includes(currentNetworkChainId)
      ) {
        blocksToSearch = 10;
      } else if (
        currentBlockNumber &&
        adjustedBlock > 0 &&
        adjustedBlock < 30
      ) {
        blocksToSearch = adjustedBlock;
      } else if (currentBlockNumber && adjustedBlock < 0) {
        blocksToSearch = 30;
      } else {
        blocksToSearch = allTransactions.length > 0 ? 10 : 30; // If we have API data, only scan 10 recent blocks
      }

      const fromBlock = latestBlockNumber - blocksToSearch;

      const recentTxs = await getUserTransactionByDefaultProvider(
        fromBlock,
        latestBlockNumber
      );

      // Combine API transactions with recent block transactions
      if (allTransactions.length > 0) {
        const combinedTxs = [...recentTxs, ...allTransactions];
        const treatedTxs = validateAndManageUserTransactions(combinedTxs);
        return flatMap(treatedTxs);
      }

      return flatMap(recentTxs);
    } catch (error) {
      console.log(error);
    }
  };

  return {
    getUserTransactionByDefaultProvider,
    pollingEvmTransactions,
    fetchTransactionDetailsFromAPI,
  };
};

export default EvmTransactionsController;
