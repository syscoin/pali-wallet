import { CustomJsonRpcProvider } from '@pollum-io/sysweb3-keyring';
import { INetworkType, retryableFetch } from '@pollum-io/sysweb3-network';

import store from 'state/store';

import { IEvmTransactionsController, IEvmTransactionResponse } from './types';
import {
  findUserTxsInProviderByBlocksRange,
  validateAndManageUserTransactions,
} from './utils';
const EvmTransactionsController = (): IEvmTransactionsController => {
  const getUserTransactionByDefaultProvider = async (
    numBlocks: number,
    web3Provider: CustomJsonRpcProvider
  ) => {
    const providerUserTxs = await findUserTxsInProviderByBlocksRange(
      web3Provider,
      numBlocks
    );

    // Just return the raw transactions - let the caller handle processing
    return providerUserTxs;
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

      const blockResponse = await retryableFetch(url.toString(), {
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

      const proxyResponse = await retryableFetch(url.toString(), {
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
        const transactions = data.result.map((tx: any) => {
          // Validate timestamp
          let timestamp = parseInt(tx.timeStamp, 10);
          const currentTime = Math.floor(Date.now() / 1000);
          const oneYearFromNow = currentTime + 365 * 24 * 60 * 60;
          const tenYearsAgo = currentTime - 10 * 365 * 24 * 60 * 60;

          if (
            !timestamp ||
            isNaN(timestamp) ||
            timestamp < tenYearsAgo ||
            timestamp > oneYearFromNow
          ) {
            console.warn(
              `Invalid timestamp from API for tx ${tx.hash}: ${tx.timeStamp}, using current time`
            );
            timestamp = currentTime;
          }

          return {
            hash: tx.hash,
            from: tx.from,
            to: tx.to,
            value: tx.value,
            blockNumber: parseInt(tx.blockNumber),
            blockHash: tx.blockHash,
            timestamp: timestamp,
            confirmations: parseInt(tx.confirmations),
            chainId: chainId,
            input: tx.input,
            gasPrice: tx.gasPrice,
            gas: tx.gas || tx.gasLimit, // Blockscout may use 'gas' or 'gasLimit'
            nonce: parseInt(tx.nonce),
          };
        });

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
              blockNumber: null, // Pending transactions don't have a block number
              blockHash: null,
              timestamp: tx.timeStamp
                ? parseInt(tx.timeStamp, 10)
                : Math.floor(Date.now() / 1000),
              confirmations: 0,
              chainId: chainId,
              input: tx.input,
              gasPrice: tx.gasPrice,
              gas: tx.gas || tx.gasLimit,
              nonce: tx.nonce !== undefined ? parseInt(tx.nonce) : null,
              // Add any other fields your UI expects as null/default
              contractAddress: tx.contractAddress || null,
              cumulativeGasUsed: tx.cumulativeGasUsed || null,
              gasUsed: tx.gasUsed || null,
              isError: tx.isError || null,
              // eslint-disable-next-line camelcase
              txreceipt_status: tx.txreceipt_status || null,
              transactionIndex:
                tx.transactionIndex !== undefined ? tx.transactionIndex : null,
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

      const response = await retryableFetch(apiEndpoint);
      const data = await response.json();

      if (data.status === '1' && data.result) {
        return data.result;
      }
    } catch (error) {
      console.error('Failed to fetch transaction details from API:', error);
    }
    return null;
  };

  const pollingEvmTransactions = async (
    web3Provider: CustomJsonRpcProvider
  ) => {
    // Guard: ensure web3Provider is valid before polling
    if (!web3Provider) {
      console.warn(
        '[pollingEvmTransactions] No valid web3Provider, skipping polling'
      );
      return [];
    }
    try {
      const { activeAccount, accounts, activeNetwork } = store.getState().vault;
      const currentAccount = accounts[activeAccount.type][activeAccount.id];
      const currentNetworkChainId = activeNetwork?.chainId;
      const rpcForbiddenList = [10];

      let rawTransactions: IEvmTransactionResponse[] = [];

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
          rawTransactions = apiResult.transactions;
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
        rawTransactions.length === 0 &&
        !rpcForbiddenList.includes(currentNetworkChainId!)
      ) {
        // Smart block scanning based on account history
        const { accountTransactions } = store.getState().vault;
        const currentAccountTxs =
          accountTransactions[activeAccount.type]?.[activeAccount.id];

        // Check if account has any transaction history on current network
        const hasTransactionHistory =
          currentAccountTxs?.ethereum?.[currentNetworkChainId!]?.length > 0;

        // Get current balance (native token) - balances are on the account object
        const currentBalance =
          currentAccount.balances?.[INetworkType.Ethereum] || 0;
        const hasBalance = currentBalance !== 0;

        // Determine how many blocks to scan:
        // - New account with no balance: 10 blocks (just recent activity)
        // - Account with balance but no tx history: 20 blocks (they got funds somehow)
        // - Account with tx history: 30 blocks (normal scanning)
        let blocksToScan = 30;

        if (!hasTransactionHistory && !hasBalance) {
          blocksToScan = 10; // Minimal scanning for truly empty accounts
          console.log(
            `[pollingEvmTransactions] Empty account detected, scanning only last ${blocksToScan} blocks`
          );
        } else if (!hasTransactionHistory && hasBalance) {
          blocksToScan = 20; // Medium scanning - they have funds but we haven't found the tx yet
          console.log(
            `[pollingEvmTransactions] Account has balance but no tx history, scanning last ${blocksToScan} blocks`
          );
        } else {
          console.log(
            `[pollingEvmTransactions] Account has transaction history, scanning last ${blocksToScan} blocks`
          );
        }

        rawTransactions = await getUserTransactionByDefaultProvider(
          blocksToScan,
          web3Provider
        );
      }

      // Process all transactions consistently, regardless of source (API or RPC)
      const processedTransactions =
        validateAndManageUserTransactions(rawTransactions);
      return processedTransactions as IEvmTransactionResponse[];
    } catch (error) {
      console.error('Error in pollingEvmTransactions:', error);
      // Re-throw the error so it propagates up and keeps loading state active
      throw error;
    }
  };

  return {
    getUserTransactionByDefaultProvider,
    pollingEvmTransactions,
    fetchTransactionsFromAPI,
    fetchTransactionDetailsFromAPI,
    testExplorerApi, // Export the test function
  };
};

export default EvmTransactionsController;
