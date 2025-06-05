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

  /**
   * Test if an explorer API is available and working
   * Works with both Etherscan and Blockscout APIs
   */
  const testExplorerApi = async (
    apiUrl: string
  ): Promise<{ error?: string; success: boolean }> => {
    try {
      console.error('testExplorerApi', apiUrl);
      const url = new URL(apiUrl);

      // Preserve existing API key if present
      const existingApiKey =
        url.searchParams.get('apikey') || url.searchParams.get('apiKey');

      // Try block module first (Blockscout specific)
      url.searchParams.set('module', 'block');
      url.searchParams.set('action', 'eth_block_number');

      if (existingApiKey) {
        url.searchParams.set('apikey', existingApiKey);
      }

      const blockResponse = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
      });

      if (blockResponse.ok) {
        const blockData = await blockResponse.json();

        // Check for API error responses
        if (blockData.status === '0' || blockData.message === 'NOTOK') {
          const errorMsg =
            blockData.result || blockData.message || 'Explorer API error';
          // If we get a clear API error (like missing API key), return it immediately
          // Don't try proxy module because the same error will occur
          if (errorMsg && errorMsg.toLowerCase().includes('api key')) {
            return { success: false, error: 'settings.missingApiKey' };
          }
          return { success: false, error: errorMsg };
        } else if (blockData.result) {
          return { success: true };
        }
      } else {
        console.log('Block API request failed, trying proxy module...');
      }

      // If block module fails, try proxy module (Etherscan format)
      url.searchParams.set('module', 'proxy');
      url.searchParams.set('action', 'eth_blockNumber');

      const proxyResponse = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
      });

      if (!proxyResponse.ok) {
        return {
          success: false,
          error: `API request failed with status ${proxyResponse.status}`,
        };
      }

      const proxyData = await proxyResponse.json();

      // Check for API error responses
      if (proxyData.status === '0' || proxyData.message === 'NOTOK') {
        const errorMsg =
          proxyData.result || proxyData.message || 'Explorer API error';
        // Check for specific API key error
        if (errorMsg && errorMsg.toLowerCase().includes('api key')) {
          return { success: false, error: 'settings.missingApiKey' };
        }
        return { success: false, error: errorMsg };
      }

      if (proxyData.result) {
        console.log('Proxy API success');
        return { success: true };
      }

      return {
        success: false,
        error: 'API did not return valid block number data',
      };
    } catch (error) {
      return {
        success: false,
        error: `Connection failed: ${error.message}`,
      };
    }
  };

  const fetchTransactionsFromAPI = async (
    address: string,
    chainId: number,
    apiUrl?: string,
    includePending = false
  ): Promise<{
    error?: string;
    transactions: IEvmTransactionResponse[] | null;
  }> => {
    if (!apiUrl) return { transactions: null };

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

      // Prepare fetch promises for parallel execution
      const fetchPromises = [fetch(url.toString())];

      // Add pending transactions fetch if requested
      let pendingUrl: URL | null = null;
      if (includePending) {
        pendingUrl = new URL(apiUrl);
        pendingUrl.searchParams.set('module', 'account');
        pendingUrl.searchParams.set('action', 'pendingtxlist');
        pendingUrl.searchParams.set('address', address);

        if (existingApiKey) {
          pendingUrl.searchParams.set('apikey', existingApiKey);
        }

        fetchPromises.push(fetch(pendingUrl.toString()));
      }

      // Execute both fetches in parallel
      const responses = await Promise.all(fetchPromises);
      const [response, pendingResponse] = responses;

      if (!response.ok) {
        const errorMsg = `Explorer API request failed with status ${response.status}`;
        console.error(errorMsg);
        return { transactions: null, error: errorMsg };
      }

      // Parse both responses in parallel
      const parsePromises = [response.json()];
      if (pendingResponse) {
        parsePromises.push(pendingResponse.json());
      }

      const [data, pendingData] = await Promise.all(parsePromises);

      // Handle API error responses
      // Status "0" with "No transactions found" is not an error, it's a valid empty result
      if (data.status === '0' || data.message === 'NOTOK') {
        // Check if this is actually a "no transactions found" case rather than an error
        const isNoTransactionsFound =
          data.message === 'No transactions found' ||
          (Array.isArray(data.result) && data.result.length === 0);

        if (isNoTransactionsFound) {
          // This is a valid response indicating no transactions, not an error
          console.log('API response: No transactions found for this address');
          // Continue with empty result processing below
        } else {
          // This is an actual error
          const errorMsg = data.result || data.message || 'Explorer API error';
          console.error('Explorer API error:', errorMsg);
          return { transactions: null, error: errorMsg };
        }
      }

      let allTransactions: IEvmTransactionResponse[] = [];

      // Both Etherscan and Blockscout use the same response format
      // Handle both status "1" (success) and status "0" with valid empty results
      if (
        (data.status === '1' ||
          (data.status === '0' && Array.isArray(data.result))) &&
        data.result &&
        Array.isArray(data.result)
      ) {
        // Note: txlist returns transactions that are in blocks (including those with 0 confirmations)
        // It does NOT return transactions that are only in the mempool (truly pending)
        // For mempool transactions, use pendingtxlist action
        const transactions = data.result.map((tx: any) => ({
          hash: tx.hash,
          from: tx.from,
          to: tx.to,
          value: tx.value,
          blockNumber: parseInt(tx.blockNumber),
          blockHash: tx.blockHash,
          timestamp: parseInt(tx.timeStamp),
          confirmations: parseInt(tx.confirmations),
          chainId: chainId,
          input: tx.input,
          gasPrice: tx.gasPrice,
          gas: tx.gas || tx.gasLimit, // Blockscout may use 'gas' or 'gasLimit'
          nonce: parseInt(tx.nonce),
        }));

        allTransactions = transactions;
      }

      // Process pending transactions if they were fetched
      if (
        includePending &&
        pendingResponse &&
        pendingResponse.ok &&
        pendingData
      ) {
        try {
          // Check for pending API errors too
          if (pendingData.status !== '0' && Array.isArray(pendingData.result)) {
            const pendingTxs = pendingData.result.map((tx: any) => ({
              hash: tx.hash,
              from: tx.from,
              to: tx.to,
              value: tx.value,
              blockNumber: 0, // Pending transactions don't have a block number
              blockHash: null,
              timestamp: parseInt(tx.timeStamp) || Date.now() / 1000,
              confirmations: 0,
              chainId: chainId,
              input: tx.input,
              gasPrice: tx.gasPrice,
              gas: tx.gas || tx.gasLimit,
              nonce: parseInt(tx.nonce),
            }));

            // Combine pending with confirmed transactions
            allTransactions = [...pendingTxs, ...allTransactions];
          }
        } catch (pendingError) {
          // Not all APIs support pending transactions, so this is not a critical error
          console.log('Pending transactions not supported by this API');
        }
      }

      return {
        transactions: allTransactions, // Return the array (even if empty) - empty array is valid
        error: undefined, // No error when we get a valid response with empty results
      };
    } catch (error) {
      const errorMsg = `Explorer API connection failed: ${error.message}`;
      console.error(errorMsg, error);
      return { transactions: null, error: errorMsg };
    }
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
        const apiResult = await fetchTransactionsFromAPI(
          currentAccount.address,
          currentNetworkChainId!,
          activeNetwork.apiUrl,
          true
        );

        if (apiResult.transactions !== null) {
          console.log(
            `[pollingEvmTransactions] Found ${apiResult.transactions.length} transactions from API`
          );
          // If API is working and returning transactions (even if empty), we don't need to scan blocks
          // The API already gives us confirmed transactions + pending ones
          const treatedTxs = validateAndManageUserTransactions(
            apiResult.transactions
          );
          return flatMap(treatedTxs);
        } else if (apiResult.error) {
          // Show API error to user via store dispatch that will trigger toast
          console.warn(
            `[pollingEvmTransactions] API Error: ${apiResult.error}`
          );

          // Still continue to RPC fallback for user transactions
          console.log(
            '[pollingEvmTransactions] Falling back to RPC scanning due to API error'
          );
        } else {
          console.log(
            '[pollingEvmTransactions] API returned no transactions, falling back to RPC scanning'
          );
        }
      }

      // Fallback to RPC scanning if API failed or no API configured
      if (
        currentBlockNumber &&
        !rpcForbiddenList.includes(currentNetworkChainId!)
      ) {
        console.log(
          `[pollingEvmTransactions] Scanning blocks ${Math.max(
            currentBlockNumber - 30,
            0
          )} to ${currentBlockNumber}`
        );
        const providerTxs = await getUserTransactionByDefaultProvider(
          Math.max(currentBlockNumber - 30, 0),
          currentBlockNumber
        );

        // Ensure providerTxs is an array
        allTransactions = Array.isArray(providerTxs) ? providerTxs : [];
      }

      // Always ensure we pass an array to validateAndManageUserTransactions
      const treatedTxs = validateAndManageUserTransactions(allTransactions);
      return flatMap(treatedTxs);
    } catch (error) {
      console.error('Error in pollingEvmTransactions:', error);
      return [];
    }
  };

  return {
    getUserTransactionByDefaultProvider,
    pollingEvmTransactions,
    fetchTransactionDetailsFromAPI,
    testExplorerApi, // Export the test function
  };
};

export default EvmTransactionsController;
