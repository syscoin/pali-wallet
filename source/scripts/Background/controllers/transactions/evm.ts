import { CustomJsonRpcProvider } from '@sidhujag/sysweb3-keyring';
import { INetworkType, retryableFetch } from '@sidhujag/sysweb3-network';

import store from 'state/store';
import { setActiveAccountProperty } from 'state/vault';
import { hasPositiveBalance } from 'utils/balance';

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
    includePending = false,
    web3Provider?: CustomJsonRpcProvider
  ): Promise<{
    error?: string;
    transactions: IEvmTransactionResponse[] | null;
  }> => {
    // Shared mapper for API items (txlist or tokentx) to internal shape
    const mapApiTx = (
      item: any,
      chainIdForMap: number,
      overrideTo?: string
    ) => {
      // Validate timestamp into a sane range
      let timestamp = parseInt(item.timeStamp, 10);
      const now = Math.floor(Date.now() / 1000);
      const oneYearFromNow = now + 365 * 24 * 60 * 60;
      const tenYearsAgo = now - 10 * 365 * 24 * 60 * 60;
      if (
        !timestamp ||
        isNaN(timestamp) ||
        timestamp < tenYearsAgo ||
        timestamp > oneYearFromNow
      ) {
        timestamp = now;
      }
      const blockNumberParsed =
        item.blockNumber !== undefined && item.blockNumber !== null
          ? parseInt(item.blockNumber)
          : undefined;
      const confirmationsParsed =
        item.confirmations !== undefined && item.confirmations !== null
          ? parseInt(item.confirmations)
          : 0;
      const nonceParsed =
        item.nonce !== undefined && item.nonce !== null
          ? parseInt(item.nonce)
          : undefined;
      return {
        hash: item.hash,
        from: item.from,
        to: overrideTo ?? item.to,
        value: item.value,
        blockNumber: blockNumberParsed,
        blockHash: item.blockHash,
        timestamp,
        confirmations: confirmationsParsed,
        chainId: chainIdForMap,
        input: item.input,
        gasPrice: item.gasPrice,
        gas: item.gas || item.gasLimit,
        nonce: nonceParsed,
        // eslint-disable-next-line camelcase
        txreceipt_status: item.txreceipt_status || item.isError || null,
        isError: item.isError || null,
      } as any;
    };
    if (!apiUrl) return { transactions: null, error: 'No API URL provided' };

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
    url.searchParams.set('sort', 'desc');

    // Decide whether to include paging using persisted or probed tx count
    let evmTxCount: number | undefined;
    let nativeBalanceHint = 0;
    try {
      const { accounts, activeAccount } = store.getState().vault;
      const acc = accounts[activeAccount.type]?.[activeAccount.id] as any;
      if (acc) {
        // Chain-specific hint takes precedence
        const byChain = acc.evmTxCountByChainId || {};
        if (typeof byChain[chainId] === 'number') evmTxCount = byChain[chainId];
      }
      // Use native balance as a secondary hint: if > 0, txlist almost certainly non-empty
      nativeBalanceHint = Number(acc?.balances?.ethereum || 0);
    } catch {}

    if ((evmTxCount === undefined || evmTxCount === 0) && web3Provider) {
      try {
        const count = await web3Provider.getTransactionCount(address);
        evmTxCount = Number(count || 0);
        const { accounts, activeAccount } = store.getState().vault;
        const acc = accounts[activeAccount.type]?.[activeAccount.id] as any;
        const byChain = { ...(acc?.evmTxCountByChainId || {}) };
        byChain[chainId] = evmTxCount;
        store.dispatch(
          setActiveAccountProperty({
            property: 'evmTxCountByChainId',
            value: byChain,
          })
        );
      } catch (e) {
        evmTxCount = 0; // safe default
      }
    }

    const shouldIncludeOffset = (evmTxCount || 0) > 0 || nativeBalanceHint > 0;

    if (shouldIncludeOffset) {
      url.searchParams.set('page', '1');
      url.searchParams.set('offset', '30');
    }

    // Preserve the API key if it was in the original URL
    // Reference: https://docs.blockscout.com/using-blockscout/my-account/api-keys
    if (existingApiKey) {
      url.searchParams.set('apikey', existingApiKey);
    }

    // Prepare fetch promises for parallel execution
    const fetchPromises: Promise<Response>[] = [retryableFetch(url.toString())];

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

      fetchPromises.push(retryableFetch(pendingUrl.toString()));
    }

    // Token transfer endpoint (use tokentx only for Blockscout compatibility)
    const token20Url = new URL(apiUrl);
    token20Url.searchParams.set('module', 'account');
    token20Url.searchParams.set('action', 'tokentx');
    token20Url.searchParams.set('address', address);
    token20Url.searchParams.set('sort', 'desc');
    if (shouldIncludeOffset) {
      token20Url.searchParams.set('page', '1');
      token20Url.searchParams.set('offset', '30');
    }
    if (existingApiKey) token20Url.searchParams.set('apikey', existingApiKey);

    fetchPromises.push(retryableFetch(token20Url.toString()));

    // Execute all fetches in parallel (tolerate partial failures)
    const responses = await Promise.allSettled(fetchPromises);
    const response =
      responses[0]?.status === 'fulfilled'
        ? (responses[0] as PromiseFulfilledResult<Response>).value
        : (undefined as any as Response);
    const pendingResponse =
      responses[1]?.status === 'fulfilled'
        ? (responses[1] as PromiseFulfilledResult<Response>).value
        : undefined;
    const token20Response =
      responses[2]?.status === 'fulfilled'
        ? (responses[2] as PromiseFulfilledResult<Response>).value
        : undefined;

    if (!response.ok) {
      // Graceful degradation: if tokentx succeeded, return token transfers only
      try {
        const tokenOnly: any[] = [];
        if (token20Response && token20Response.ok) {
          const token20Data = await token20Response.json();
          if (Array.isArray(token20Data?.result)) {
            for (const ev of token20Data.result) {
              const base = mapApiTx(ev, chainId, ev.contractAddress);
              tokenOnly.push({ ...base, tokenRecipient: ev.to } as any);
            }
          }
        }
        return { transactions: tokenOnly, error: undefined };
      } catch (e) {
        const errorMsg = `Explorer API request failed with status ${response.status}`;
        return { transactions: null, error: errorMsg };
      }
    }

    // Parse all responses in parallel (gate optional ones by ok)
    const parsePromises: Promise<any>[] = [response.json()];
    if (pendingResponse) parsePromises.push(pendingResponse.json());
    if (token20Response && token20Response.ok)
      parsePromises.push(token20Response.json());

    const [data, pendingData, token20Data] = await Promise.all(parsePromises);

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
    let baseTxCount = 0; // Number of txs returned by txlist (exclude tokentx)

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
      baseTxCount = data.result.length;
      const transactions = data.result.map((tx: any) => mapApiTx(tx, chainId));

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
            nonce:
              tx.nonce !== undefined && tx.nonce !== null
                ? parseInt(tx.nonce)
                : undefined,
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

    // Normalize token transfer events to transaction-like entries (tokentx only)
    const tokenEventResults: any[] = [];
    try {
      if (token20Data && Array.isArray(token20Data.result))
        tokenEventResults.push(...token20Data.result);
    } catch {}

    const tokenTransactions = tokenEventResults.map((ev: any) => {
      const base = mapApiTx(ev, chainId, ev.contractAddress);
      return { ...base, tokenRecipient: ev.to } as any;
    });

    // Merge and deduplicate by hash (prefer base txlist entries when present)
    const seenHashes = new Set(allTransactions.map((t) => t.hash));
    for (const t of tokenTransactions) {
      if (!seenHashes.has(t.hash)) {
        allTransactions.push(t);
        seenHashes.add(t.hash);
      }
    }

    // Sort by timestamp desc to maintain expected order after merge
    allTransactions.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    // Cache whether this address has transactions (only if not already cached or cache expired)
    // Persist updated hint on account (0 or >=1)
    try {
      const hasTransactionsInTxList = baseTxCount > 0;
      const newCount = hasTransactionsInTxList
        ? Math.max(1, evmTxCount || 0)
        : 0;
      // Maintain only per-chain counts going forward
      const { accounts, activeAccount } = store.getState().vault;
      const acc = accounts[activeAccount.type]?.[activeAccount.id] as any;
      const byChain = { ...(acc?.evmTxCountByChainId || {}) };
      byChain[chainId] = newCount;
      store.dispatch(
        setActiveAccountProperty({
          property: 'evmTxCountByChainId',
          value: byChain,
        })
      );
    } catch {}

    // If we didn't use offset, limit to 30 for consistency
    // This applies to first-time requests and addresses with no transactions
    const finalTransactions = shouldIncludeOffset
      ? allTransactions
      : allTransactions.slice(0, 30);

    return {
      transactions: finalTransactions, // Return the array (even if empty) - empty array is valid
      error: undefined, // No error when we get a valid response with empty results
    };
  };

  const fetchTransactionsPageFromAPI = async (
    address: string,
    chainId: number,
    apiUrl: string,
    page: number,
    offset = 30
  ): Promise<{
    error?: string;
    transactions: IEvmTransactionResponse[] | null;
  }> => {
    try {
      const url = new URL(apiUrl);
      const existingApiKey =
        url.searchParams.get('apikey') || url.searchParams.get('apiKey');
      url.searchParams.set('module', 'account');
      url.searchParams.set('action', 'txlist');
      url.searchParams.set('address', address);
      url.searchParams.set('sort', 'desc');

      // Only include page/offset when vault hint says this chain has tx history
      let shouldIncludeOffset = false;
      try {
        const { accounts, activeAccount } = store.getState().vault;
        const acc = accounts[activeAccount.type]?.[activeAccount.id] as any;
        const byChain = acc?.evmTxCountByChainId || {};
        shouldIncludeOffset = Number(byChain[chainId] || 0) > 0;
      } catch {}

      if (shouldIncludeOffset) {
        url.searchParams.set('page', String(page));
        url.searchParams.set('offset', String(offset));
      }

      if (existingApiKey) url.searchParams.set('apikey', existingApiKey);
      // Token endpoint for the same page (tokentx only)
      const token20Url = new URL(apiUrl);
      token20Url.searchParams.set('module', 'account');
      token20Url.searchParams.set('action', 'tokentx');
      token20Url.searchParams.set('address', address);
      token20Url.searchParams.set('sort', 'desc');
      if (shouldIncludeOffset) {
        token20Url.searchParams.set('page', String(page));
        token20Url.searchParams.set('offset', String(offset));
      }

      if (existingApiKey) token20Url.searchParams.set('apikey', existingApiKey);

      const [response, token20Resp] = await Promise.all([
        retryableFetch(url.toString()),
        retryableFetch(token20Url.toString()),
      ]);

      if (!response.ok) {
        // Graceful degradation: if token20 succeeded, return those events
        if (token20Resp && token20Resp.ok) {
          try {
            const token20Data = await token20Resp.json();
            const tokenEvents: any[] = [];
            if (Array.isArray(token20Data?.result))
              tokenEvents.push(...token20Data.result);
            const tokenTxs = tokenEvents.map((ev: any) => {
              const base = mapApiTx(ev, chainId, ev.contractAddress);
              return { ...base, tokenRecipient: ev.to } as any;
            });
            return { transactions: tokenTxs };
          } catch (err) {
            return {
              transactions: null,
              error: `Explorer API status ${response.status}`,
            };
          }
        }
        return {
          transactions: null,
          error: `Explorer API status ${response.status}`,
        };
      }
      const [data, token20Data] = await Promise.all([
        response.json(),
        token20Resp.ok ? token20Resp.json() : Promise.resolve(null),
      ]);

      // Shared mapper for API items (txlist or tokentx) to internal shape
      const mapApiTx = (
        item: any,
        chainIdForMap: number,
        overrideTo?: string
      ) => {
        let timestamp = parseInt(item.timeStamp, 10);
        const now = Math.floor(Date.now() / 1000);
        const oneYearFromNow = now + 365 * 24 * 60 * 60;
        const tenYearsAgo = now - 10 * 365 * 24 * 60 * 60;
        if (
          !timestamp ||
          isNaN(timestamp) ||
          timestamp < tenYearsAgo ||
          timestamp > oneYearFromNow
        ) {
          timestamp = now;
        }
        const blockNumberParsed =
          item.blockNumber !== undefined && item.blockNumber !== null
            ? parseInt(item.blockNumber)
            : undefined;
        const confirmationsParsed =
          item.confirmations !== undefined && item.confirmations !== null
            ? parseInt(item.confirmations)
            : 0;
        const nonceParsed =
          item.nonce !== undefined && item.nonce !== null
            ? parseInt(item.nonce)
            : undefined;
        return {
          hash: item.hash,
          from: item.from,
          to: overrideTo ?? item.to,
          value: item.value,
          blockNumber: blockNumberParsed,
          blockHash: item.blockHash,
          timestamp,
          confirmations: confirmationsParsed,
          chainId: chainIdForMap,
          input: item.input,
          gasPrice: item.gasPrice,
          gas: item.gas || item.gasLimit,
          nonce: nonceParsed,
          // eslint-disable-next-line camelcase
          txreceipt_status: item.txreceipt_status || item.isError || null,
          isError: item.isError || null,
        } as any;
      };

      let baseTxs: IEvmTransactionResponse[] = [];
      if (
        (data.status === '1' ||
          (data.status === '0' && Array.isArray(data.result))) &&
        Array.isArray(data.result)
      ) {
        baseTxs = data.result.map((tx: any) => mapApiTx(tx, chainId));
      }

      const tokenEvents: any[] = [];
      try {
        if (token20Data && Array.isArray(token20Data.result))
          tokenEvents.push(...token20Data.result);
      } catch {}

      const tokenTxs = tokenEvents.map((ev: any) => {
        const base = mapApiTx(ev, chainId, ev.contractAddress);
        return { ...base, tokenRecipient: ev.to } as any;
      });

      const seen = new Set(baseTxs.map((t) => t.hash));
      const merged = [...baseTxs];
      for (const t of tokenTxs) {
        if (!seen.has(t.hash)) {
          merged.push(t);
          seen.add(t.hash);
        }
      }
      merged.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      return { transactions: merged };
    } catch (err: any) {
      return { transactions: null, error: String(err?.message || err) };
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
    web3Provider: CustomJsonRpcProvider,
    isPolling?: boolean,
    isRapidPolling?: boolean
  ) => {
    // Guard: ensure web3Provider is valid before polling
    if (!web3Provider) {
      console.warn(
        '[pollingEvmTransactions] No valid web3Provider, skipping polling'
      );
      return [];
    }
    const { activeAccount, accounts, activeNetwork, accountTransactions } =
      store.getState().vault;
    const currentAccount = accounts[activeAccount.type]?.[activeAccount.id];
    const currentNetworkChainId = activeNetwork?.chainId;
    const rpcForbiddenList = [10];

    // Check if account exists before proceeding
    if (!currentAccount) {
      console.warn('[pollingEvmTransactions] Active account not found');
      return [];
    }

    // Check if network chain ID exists before proceeding
    if (!currentNetworkChainId) {
      console.warn('[pollingEvmTransactions] No network chain ID found');
      return [];
    }

    let rawTransactions: IEvmTransactionResponse[] = [];

    // Try to fetch from external API first (more efficient)
    if (activeNetwork?.apiUrl) {
      console.log(
        `[pollingEvmTransactions] Attempting to fetch from API for ${currentAccount.address}`
      );
      const apiResult = await fetchTransactionsFromAPI(
        currentAccount.address,
        currentNetworkChainId,
        activeNetwork.apiUrl,
        true,
        web3Provider
      );

      if (apiResult.transactions !== null) {
        console.log(
          `[pollingEvmTransactions] Found ${apiResult.transactions.length} transactions from API`
        );
        rawTransactions = apiResult.transactions;
      } else if (apiResult.error) {
        // Always throw when API is configured but fails
        // Let MainController decide how to handle based on isPolling
        throw new Error(
          `Transaction API error: ${apiResult.error}. Please check your API URL configuration.`
        );
      }
    }

    // Fallback to RPC scanning if API failed or no API configured
    if (
      rawTransactions.length === 0 &&
      !rpcForbiddenList.includes(currentNetworkChainId)
    ) {
      // Smart block scanning based on account history
      const currentAccountTxs =
        accountTransactions[activeAccount.type]?.[activeAccount.id];

      // Check if account has any transaction history on current network
      const hasTransactionHistory =
        currentAccountTxs?.ethereum?.[currentNetworkChainId]?.length > 0;

      // Get current balance (native token) - balances are on the account object
      const currentBalance =
        currentAccount.balances?.[INetworkType.Ethereum] || '0';
      const hasBalance = hasPositiveBalance(currentBalance);
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
      rawTransactions = [];
      // Skip expensive block scanning during rapid polling
      if (isPolling && !isRapidPolling) {
        rawTransactions = await getUserTransactionByDefaultProvider(
          blocksToScan,
          web3Provider
        );
      }

      // ENHANCEMENT: When no API is available, also check specific pending transactions
      // This ensures pending transactions are tracked even if they fall outside the polling window
      if (
        !activeNetwork?.apiUrl &&
        currentAccountTxs?.ethereum?.[currentNetworkChainId]
      ) {
        const existingTxs = currentAccountTxs.ethereum[currentNetworkChainId];
        const pendingTxs = existingTxs.filter(
          (tx: any) => !tx.blockNumber || !tx.blockHash
        );

        if (pendingTxs.length > 0) {
          console.log(
            `[pollingEvmTransactions] Checking ${pendingTxs.length} pending transactions individually`
          );

          // Fetch each pending transaction individually to get its current status
          const pendingTxPromises = pendingTxs.map(async (pendingTx: any) => {
            try {
              const tx = await web3Provider.getTransaction(pendingTx.hash);
              if (tx) {
                // If transaction is found and has a block number, it's confirmed
                if (tx.blockNumber) {
                  const block = await web3Provider.getBlock(tx.blockNumber);
                  const latestBlock = await web3Provider.getBlockNumber();
                  const confirmations = Math.max(
                    0,
                    latestBlock - tx.blockNumber
                  );

                  // Get receipt to check transaction status
                  let receipt = null;
                  let isSuccess = null;
                  try {
                    receipt = await web3Provider.getTransactionReceipt(tx.hash);
                    if (receipt) {
                      isSuccess =
                        receipt.status === 1 || receipt.status === '0x1';
                    }
                  } catch (receiptError) {
                    console.log(`Could not fetch receipt for ${tx.hash}`);
                  }

                  return {
                    ...tx,
                    confirmations,
                    timestamp:
                      block?.timestamp || Math.floor(Date.now() / 1000),
                    chainId: currentNetworkChainId,
                    nonce:
                      tx.nonce !== undefined && tx.nonce !== null
                        ? typeof tx.nonce === 'string'
                          ? parseInt(tx.nonce, 16)
                          : Number(tx.nonce)
                        : undefined,
                    // Add status fields
                    // eslint-disable-next-line camelcase
                    txreceipt_status:
                      isSuccess === null ? null : isSuccess ? '1' : '0',
                    isError: isSuccess === null ? null : isSuccess ? '0' : '1',
                  };
                } else {
                  // Still pending
                  return {
                    ...tx,
                    confirmations: 0,
                    timestamp:
                      pendingTx.timestamp || Math.floor(Date.now() / 1000),
                    chainId: currentNetworkChainId,
                    nonce:
                      tx.nonce !== undefined && tx.nonce !== null
                        ? typeof tx.nonce === 'string'
                          ? parseInt(tx.nonce, 16)
                          : Number(tx.nonce)
                        : undefined,
                  };
                }
              }
            } catch (error) {
              console.error(
                `[pollingEvmTransactions] Error fetching pending tx ${pendingTx.hash}:`,
                error
              );
            }
            return null;
          });

          const updatedPendingTxs = await Promise.all(pendingTxPromises);
          const validUpdatedTxs = updatedPendingTxs.filter((tx) => tx !== null);

          // Merge the individually fetched pending transactions with the block scan results
          if (validUpdatedTxs.length > 0) {
            console.log(
              `[pollingEvmTransactions] Found ${validUpdatedTxs.length} updated pending transactions`
            );
            rawTransactions = [...rawTransactions, ...validUpdatedTxs];
          }
        }
      }
    }

    // Process all transactions consistently, regardless of source (API or RPC)
    const processedTransactions =
      validateAndManageUserTransactions(rawTransactions);
    return processedTransactions as IEvmTransactionResponse[];
  };

  return {
    getUserTransactionByDefaultProvider,
    pollingEvmTransactions,
    fetchTransactionsFromAPI,
    fetchTransactionsPageFromAPI,
    fetchTransactionDetailsFromAPI,
    testExplorerApi, // Export the test function
  };
};

export default EvmTransactionsController;
