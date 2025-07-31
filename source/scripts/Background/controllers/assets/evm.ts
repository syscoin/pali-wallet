import { CustomJsonRpcProvider } from '@sidhujag/sysweb3-keyring';
import { IKeyringAccountState } from '@sidhujag/sysweb3-keyring';
import { retryableFetch } from '@sidhujag/sysweb3-network';
import {
  contractChecker,
  getErc21Abi,
  getTokenStandardMetadata,
  getNftStandardMetadata,
  getERC721StandardBalance,
} from '@sidhujag/sysweb3-utils';
import { cleanTokenSymbol } from '@sidhujag/sysweb3-utils';
import { ethers } from 'ethers';
import isEmpty from 'lodash/isEmpty';

import { BatchBalanceController } from '../balances/BatchBalanceController';
import { Queue } from '../transactions/queue';
import store from 'state/store';
import {
  ITokenEthProps,
  ITokenDetails,
  ITokenSearchResult,
} from 'types/tokens';
import { isZeroBalance } from 'utils/balance';

import {
  discoverNftTokens,
  verifyERC1155OwnershipHelper,
  verifyERC721OwnershipHelper,
} from './nft-utils';
import { IEvmAssetsController } from './types';
import { validateAndManageUserAssets } from './utils';

const EvmAssetsController = (): IEvmAssetsController => {
  // Cache for token price data
  const priceDataCache = new Map<
    string,
    {
      data: { price: number; priceChange24h?: number };
      timestamp: number;
    }
  >();

  // Cache for token details
  const tokenDetailsCache = new Map<
    string,
    {
      details: any;
      timestamp: number;
    }
  >();

  // Cache for CoinGecko ID detection results
  const coinGeckoDetectionCache = new Map<
    string,
    {
      result: { coingeckoId?: string; coingeckoPlatformId?: string } | null;
      timestamp: number;
    }
  >();

  // Request deduplication to prevent duplicate API calls
  const pendingRequests = new Map<string, Promise<any>>();

  const PRICE_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes cache for price data (needs to be more current)
  const TOKEN_DETAILS_CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours cache for token details
  const COINGECKO_DETECTION_CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours cache for CoinGecko detection

  /**
   * PATH 1: Get tokens held by user account via Blockscout API
   * Shows what the user actually owns - much more practical than browsing thousands of tokens
   */
  const getUserOwnedTokens = async (
    walletAddress: string
  ): Promise<ITokenSearchResult[]> => {
    const { activeNetwork } = store.getState().vault;

    // Only use the API URL if it's explicitly provided
    // Don't blindly use explorer URLs as API endpoints
    const apiUrl = activeNetwork.apiUrl;

    if (!apiUrl) {
      console.log(
        `[EvmAssetsController] No API URL configured for network: ${activeNetwork.label}. Token discovery will be limited to manually added tokens.`
      );
      return [];
    }

    console.log(
      `[EvmAssetsController] Fetching user tokens from API: ${apiUrl}`
    );

    // Parse API URL and construct tokenlist endpoint
    const url = new URL(apiUrl);
    const baseUrl = `${url.protocol}//${url.host}`;

    // Build the token list URL using proper URL API
    const tokenListUrl = new URL(`${baseUrl}/api`);

    // Extract API key if it's already in the original URL
    const existingApiKey = url.searchParams.get('apikey');

    // Build the API request
    tokenListUrl.searchParams.set('module', 'account');
    tokenListUrl.searchParams.set('action', 'tokenlist');
    tokenListUrl.searchParams.set('address', walletAddress);

    // Preserve the API key if it was in the original URL
    if (existingApiKey) {
      tokenListUrl.searchParams.set('apikey', existingApiKey);
    }

    const response = await retryableFetch(tokenListUrl.toString());

    if (!response.ok) {
      throw new Error(`API request failed with status ${response.status}`);
    }

    const data = await response.json();

    if (data.status !== '1' || !data.result) {
      console.warn(
        `[EvmAssetsController] API returned error or no tokens:`,
        data.message || 'No results'
      );
      // This is a legitimate "no tokens" response from the API
      return [];
    }

    const tokens = data.result;

    // Helper function to detect tokens with invisible/funny characters in name
    const hasInvisibleChars = (name: string): boolean => {
      if (!name) return false;

      // Check for zero-width spaces and other invisible Unicode characters
      return /[\u200B-\u200D\uFEFF\u00A0\u0000-\u001F\u007F-\u009F]/.test(name);
    };

    // Convert to ITokenSearchResult format and filter out tokens with funny characters
    const results: ITokenSearchResult[] = tokens
      .filter((token: any) => !hasInvisibleChars(token.name || '')) // Filter out tokens with invisible chars in name
      .map((token: any) => {
        // Check if it's an NFT based on type
        const tokenType = token.type || 'ERC-20';
        const isNft = ['ERC-721', 'ERC-1155'].includes(tokenType);

        return {
          id: `${token.contractAddress.toLowerCase()}-${activeNetwork.chainId}`,
          symbol: cleanTokenSymbol(token.symbol || 'Unknown'),
          name: token.name || 'Unknown Token', // Keep names intact - they can have spaces
          contractAddress: token.contractAddress,
          balance: isNft
            ? parseInt(token.balance) || 1 // For NFTs, balance is the count of NFTs
            : parseFloat(token.balance) /
              Math.pow(10, parseInt(token.decimals) || 18),
          decimals: isNft ? 0 : parseInt(token.decimals) || 18, // NFTs always have 0 decimals
          tokenStandard: tokenType,
        };
      });

    console.log(
      `[EvmAssetsController] Found ${
        results.length
      } valid tokens via API (filtered ${
        tokens.length - results.length
      } tokens with invisible characters)`
    );
    return results;
  };

  /**
   * Simplified ERC-20 validation - Only checks if it's a valid ERC-20 token with minimal ETH calls
   * Used by the "Add Custom" tab which is specifically for ERC-20 tokens only
   */
  const validateERC20Only = async (
    contractAddress: string,
    walletAddress: string,
    w3Provider: CustomJsonRpcProvider
  ): Promise<ITokenDetails | null> => {
    try {
      console.log(
        `[EvmAssetsController] Validating ERC-20 token: ${contractAddress}`
      );

      // Single call to get all ERC-20 data at once
      const erc20Abi = [
        'function name() view returns (string)',
        'function symbol() view returns (string)',
        'function decimals() view returns (uint8)',
        'function balanceOf(address) view returns (uint256)',
        // Add ERC-165 supportsInterface for lightweight type detection
        'function supportsInterface(bytes4) view returns (bool)',
        // Add ERC-4626 asset function for vault detection
        'function asset() view returns (address)',
      ];

      const contract = new ethers.Contract(
        contractAddress,
        erc20Abi,
        w3Provider
      );

      // Make all calls in parallel - this is 4 ETH calls total
      const [name, symbol, decimals, balanceRaw] = await Promise.all([
        contract.name(),
        contract.symbol(),
        contract.decimals(),
        contract.balanceOf(walletAddress),
      ]);

      // Calculate the formatted balance
      const balance = Number(balanceRaw) / Math.pow(10, decimals);
      const formattedBalance = Math.floor(balance * 10000) / 10000;

      // Lightweight token type detection (optional, non-blocking)
      let tokenStandard: 'ERC-20' | 'ERC-777' | 'ERC-4626' = 'ERC-20';
      try {
        // Check for ERC-777 interface (0xe58e113c)
        const [isERC777, isERC4626] = await Promise.all([
          contract.supportsInterface('0xe58e113c').catch(() => false),
          // Check for ERC-4626 by calling asset() function
          contract
            .asset()
            .then(() => true)
            .catch(() => false),
        ]);

        if (isERC777) {
          tokenStandard = 'ERC-777';
        } else if (isERC4626) {
          tokenStandard = 'ERC-4626';
        }
      } catch (interfaceError) {
        // If interface detection fails, default to ERC-20
        console.log(
          '[EvmAssetsController] Interface detection failed, defaulting to ERC-20'
        );
      }

      // Create token details for ERC-20
      const tokenDetails: ITokenDetails = {
        id: `${contractAddress.toLowerCase()}-${
          store.getState().vault.activeNetwork.chainId
        }`,
        symbol: cleanTokenSymbol(symbol).toUpperCase(),
        name: name || symbol, // Keep names intact - they can have spaces
        contractAddress,
        decimals,
        balance: formattedBalance,
        chainId: store.getState().vault.activeNetwork.chainId,
        tokenStandard,
        isNft: false,
        isVerified: false,
      };

      // Don't fetch CoinGecko data during validation - keep it lightweight
      console.log(
        `[EvmAssetsController] Validated ${tokenStandard} token ${symbol} with balance: ${formattedBalance}`
      );
      return tokenDetails;
    } catch (error) {
      // If any of the ERC-20 calls fail, it's not a valid ERC-20 token
      throw new Error(
        'Not a valid ERC-20 token. Please ensure the contract address is correct.'
      );
    }
  };

  /**
   * 3. FIAT PRICE DATA - Fetch native token price using network's coingeckoId with caching
   */
  const getTokenPriceData = async (
    chainId: number,
    currency = 'usd'
  ): Promise<{
    price: number;
    priceChange24h?: number;
  }> => {
    // Find the network configuration for this chain ID
    const { networks } = store.getState().vaultGlobal;
    const network = networks.ethereum[chainId];

    if (!network || !network.coingeckoId) {
      console.warn(
        `[EvmAssetsController] No network configuration or CoinGecko ID found for chain ${chainId}`
      );
      return { price: 0 };
    }

    // Check cache first
    const cacheKey = `${network.coingeckoId}-${currency}`;
    const cached = priceDataCache.get(cacheKey);
    const now = Date.now();

    if (cached && now - cached.timestamp < PRICE_CACHE_DURATION) {
      console.log(
        `[EvmAssetsController] Using cached price data for ${network.coingeckoId}`
      );
      return cached.data;
    }

    try {
      // Use the network's coingeckoId directly - it should be the native token's ID
      const priceResponse = await retryableFetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${network.coingeckoId}&vs_currencies=${currency}&include_24hr_change=true`
      );

      if (priceResponse.ok) {
        const priceData = await priceResponse.json();
        const tokenData = priceData[network.coingeckoId];

        if (tokenData) {
          const result = {
            price: tokenData[currency] || 0,
            priceChange24h: tokenData[`${currency}_24h_change`],
          };

          // Cache the result
          priceDataCache.set(cacheKey, {
            data: result,
            timestamp: now,
          });

          console.log(
            `[EvmAssetsController] Fetched and cached price data for ${network.coingeckoId}`
          );
          return result;
        }
      }

      console.warn(
        `[EvmAssetsController] Failed to fetch price for ${network.coingeckoId}`
      );
      return { price: 0 };
    } catch (error) {
      console.error(
        `[EvmAssetsController] Error fetching price for chain ${chainId}:`,
        error
      );
      return { price: 0 };
    }
  };

  /**
   * Get platform key for current active network using network's coingeckoPlatformId
   */
  const getCurrentNetworkPlatform = (): string | null => {
    const { activeNetwork } = store.getState().vault;
    return activeNetwork.coingeckoPlatformId || null;
  };

  /**
   * Auto-detect CoinGecko IDs for a given chainId by querying CoinGecko API
   * This replaces hardcoded mappings with dynamic lookups
   */
  const detectCoinGeckoIds = async (
    chainId: number
  ): Promise<{
    coingeckoId?: string;
    coingeckoPlatformId?: string;
  } | null> => {
    const cacheKey = `detect-${chainId}`;
    const cached = coinGeckoDetectionCache.get(cacheKey);
    const now = Date.now();

    // Return cached data if valid and not expired (24h cache for detection)
    if (cached && now - cached.timestamp < COINGECKO_DETECTION_CACHE_DURATION) {
      console.log(
        `[EvmAssetsController] Using cached CoinGecko detection for chainId ${chainId}`
      );
      return cached.result;
    }

    try {
      console.log(
        `[EvmAssetsController] Auto-detecting CoinGecko IDs for chainId ${chainId}`
      );

      // Query asset platforms from CoinGecko
      const platformsResponse = await retryableFetch(
        'https://api.coingecko.com/api/v3/asset_platforms'
      );

      if (platformsResponse.ok) {
        const platforms = await platformsResponse.json();

        // Look for platform with matching chain_identifier
        const matchingPlatform = platforms.find(
          (platform: any) =>
            // Direct match with chain_identifier
            platform.chain_identifier === chainId ||
            platform.chain_identifier === chainId.toString()
        );

        if (matchingPlatform) {
          const result = {
            coingeckoId: matchingPlatform.native_coin_id || undefined,
            coingeckoPlatformId: matchingPlatform.id,
          };

          // Cache the result
          coinGeckoDetectionCache.set(cacheKey, {
            result: result,
            timestamp: now,
          });

          console.log(
            `[EvmAssetsController] Auto-detected CoinGecko IDs for chainId ${chainId}:`,
            result
          );
          return result;
        }
      }

      // No match found
      console.log(
        `[EvmAssetsController] No CoinGecko IDs found for chainId ${chainId}`
      );

      // Cache null result to avoid repeated API calls for unsupported chains
      coinGeckoDetectionCache.set(cacheKey, {
        result: null,
        timestamp: now,
      });

      return null;
    } catch (error) {
      console.error(
        `[EvmAssetsController] Error auto-detecting CoinGecko IDs for chainId ${chainId}:`,
        error
      );
      return null;
    }
  };

  /**
   * Update balances for all EVM tokens including NFT collections
   *
   * NFT Collection Balance Updates:
   * - ERC-721 collections: Uses balanceOf(address) to get total count ✅
   * - ERC-1155 collections: Cannot update without specific tokenIds ❌
   *   (ERC-1155 balanceOf requires tokenId parameter which we don't store in collections)
   *
   * Recommendation: Use API-based updates when available for accurate NFT balances
   */
  const updateAllEvmTokens = async (
    account: IKeyringAccountState,
    currentNetworkChainId: number,
    w3Provider: CustomJsonRpcProvider,
    accountAssets: ITokenEthProps[]
  ): Promise<ITokenEthProps[]> => {
    if (isEmpty(accountAssets)) return [];

    const { activeNetwork } = store.getState().vault;

    // Filter assets for current network
    const currentNetworkAssets = accountAssets.filter(
      (asset) => asset.chainId === currentNetworkChainId
    );
    const otherNetworkAssets = accountAssets.filter(
      (asset) => asset.chainId !== currentNetworkChainId
    );

    // If API is available, use it for efficient batch updates
    // Only use explicitly configured API URLs, not explorer URLs
    const apiUrl = activeNetwork.apiUrl;
    if (apiUrl) {
      console.log(
        `[EvmAssetsController] Using API for batch token update: ${apiUrl}`
      );

      // Get all tokens from API in one call
      const ownedTokens = await getUserOwnedTokens(account.address);

      // Create a map of owned tokens for quick lookup
      const ownedTokensMap = new Map(
        ownedTokens.map((token) => [token.contractAddress.toLowerCase(), token])
      );

      // Update existing assets with API data
      const updatedAssets = await Promise.all(
        currentNetworkAssets.map(async (asset) => {
          const apiToken = ownedTokensMap.get(
            asset.contractAddress.toLowerCase()
          );

          if (apiToken) {
            // Token found in API - update balance
            console.log(
              `[EvmAssetsController] Updating ${asset.tokenSymbol} balance from API: ${apiToken.balance}`
            );

            // For all tokens (including NFTs), use the balance from API
            return {
              ...asset,
              balance: asset.isNft
                ? Math.floor(apiToken.balance) // NFTs need integer balances
                : apiToken.balance, // Keep full precision for regular tokens
            };
          } else {
            // Token not in API response - set balance to 0 (as requested)
            // This handles the case where API is set and balance query returns nothing
            console.log(
              `[EvmAssetsController] Token ${asset.tokenSymbol} not found in API - setting balance to 0`
            );

            // Skip updating balance to 0 if it's already 0 (avoid unnecessary updates)
            if (isZeroBalance(asset.balance)) {
              return asset;
            }

            return {
              ...asset,
              balance: 0,
            };
          }
        })
      );

      // Combine updated assets with other network assets
      const allAssets = [...updatedAssets, ...otherNetworkAssets];

      return validateAndManageUserAssets(true, allAssets) as ITokenEthProps[];
    }

    // No API available or API failed - use multicall3 for batch balance fetching
    console.log(
      `[EvmAssetsController] Using multicall3 for batch token balance updates`
    );

    // Separate regular tokens from NFTs
    const regularTokens = currentNetworkAssets.filter((asset) => !asset.isNft);
    const nftAssets = currentNetworkAssets.filter((asset) => asset.isNft);

    // Use BatchBalanceController for regular ERC-20 tokens
    let updatedRegularTokens: ITokenEthProps[] = [];
    if (regularTokens.length > 0) {
      const batchController = new BatchBalanceController(w3Provider);

      const balances = await batchController.getBatchTokenBalances(
        regularTokens,
        account.address
      );

      updatedRegularTokens = regularTokens.map((token) => {
        const balance = balances.get(token.contractAddress.toLowerCase());
        return {
          ...token,
          balance: balance ? parseFloat(balance) : 0, // Keep full precision
        };
      });
    }

    // Handle NFTs separately (they need different ABI calls)
    let updatedNftAssets: ITokenEthProps[] = [];
    if (nftAssets.length > 0) {
      // For NFTs, we still need individual calls or skip if ERC-1155
      const queue = new Queue(3);
      const DELAY_BETWEEN_REQUESTS = 100; // 100ms between each request
      let requestCount = 0;

      // Queue each NFT individually - this ensures only 3 run at a time
      nftAssets.forEach((nftAsset) => {
        queue.execute(async () => {
          // Add progressive delay for each request
          if (requestCount > 0) {
            await new Promise((resolve) =>
              setTimeout(
                resolve,
                DELAY_BETWEEN_REQUESTS * Math.floor(requestCount / 3)
              )
            );
          }
          requestCount++;

          const nftContractType = nftAsset.tokenStandard || 'ERC-721';

          if (nftContractType === 'ERC-1155') {
            // ERC-1155 collections cannot be updated via individual calls
            console.log(
              `[EvmAssetsController] Skipping ERC-1155 collection ${nftAsset.contractAddress} - requires API`
            );
            return nftAsset; // Return unchanged
          }

          // ERC-721: balanceOf(address) returns total count
          const currentAbi = getErc21Abi();
          const contract = new ethers.Contract(
            nftAsset.contractAddress,
            currentAbi,
            w3Provider
          );

          try {
            const balanceCallMethod = await contract.balanceOf(account.address);
            const collectionBalance = Number(balanceCallMethod);

            console.log(
              `[EvmAssetsController] Updated ERC-721 collection ${nftAsset.contractAddress}: ${collectionBalance} NFTs`
            );

            return { ...nftAsset, balance: collectionBalance };
          } catch (error) {
            console.error(
              `[EvmAssetsController] Failed to fetch NFT balance for ${nftAsset.contractAddress}:`,
              error
            );
            return nftAsset; // Return unchanged on error
          }
        });
      });

      const nftResults = await queue.done();
      updatedNftAssets = nftResults
        .filter((result) => result.success)
        .map(({ result }) => result);
    }

    // Combine all updated assets
    const allUpdatedAssets = [
      ...updatedRegularTokens,
      ...updatedNftAssets,
      ...otherNetworkAssets,
    ];

    return validateAndManageUserAssets(
      true,
      allUpdatedAssets
    ) as ITokenEthProps[];
  };

  // Wrapper methods for UI components to use via controllerEmitter
  const checkContractType = async (
    contractAddress: string,
    w3Provider: CustomJsonRpcProvider
  ) => await contractChecker(contractAddress, w3Provider);

  const getERC20TokenInfo = async (
    contractAddress: string,
    accountAddress: string,
    w3Provider: CustomJsonRpcProvider
  ): Promise<{
    balance: string;
    decimals: number;
    name: string;
    symbol: string;
  }> => {
    const erc20Abi = [
      'function name() view returns (string)',
      'function symbol() view returns (string)',
      'function decimals() view returns (uint8)',
      'function balanceOf(address) view returns (uint256)',
    ];

    const contract = new ethers.Contract(contractAddress, erc20Abi, w3Provider);

    const [name, symbol, decimals, balance] = await Promise.all([
      contract.name(),
      contract.symbol(),
      contract.decimals(),
      contract.balanceOf(accountAddress),
    ]);

    return {
      name,
      symbol: cleanTokenSymbol(symbol),
      decimals,
      balance: balance.toString(),
    };
  };

  /**
   * Get basic token details (cached, no balance, no market data)
   * Used by notification manager and other components that only need basic info
   */
  const getTokenDetails = async (
    contractAddress: string,
    walletAddress: string,
    w3Provider: CustomJsonRpcProvider
  ): Promise<ITokenDetails | null> => {
    // Check cache first - no balance needed, so cache is more effective
    const cacheKey = `${contractAddress}-${
      store.getState().vault.activeNetwork.chainId
    }`;
    const cached = tokenDetailsCache.get(cacheKey);
    const now = Date.now();

    // Return cached data if available (no balance, so no need to refresh)
    if (cached && now - cached.timestamp < TOKEN_DETAILS_CACHE_DURATION) {
      console.log(
        `[EvmAssetsController] Using cached basic token details for ${contractAddress}`
      );
      return cached.details;
    }

    // Check if there's already a pending request for this contract
    const pendingKey = `basic-${contractAddress}`;
    if (pendingRequests.has(pendingKey)) {
      console.log(
        `[EvmAssetsController] Reusing pending basic token details request for ${contractAddress}`
      );
      return pendingRequests.get(pendingKey);
    }

    // Create the promise and store it
    const requestPromise = (async () => {
      try {
        // Get contract type for token standard tracking
        const contractTypeResponse = await contractChecker(
          contractAddress,
          w3Provider
        );

        if (String(contractTypeResponse).includes('Invalid contract address')) {
          console.error(
            `[EvmAssetsController] Invalid contract address: ${contractAddress}`
          );
          return null;
        }

        const contractType = (contractTypeResponse as any).type;
        console.log(
          `[EvmAssetsController] Getting basic details for ${contractType} token: ${contractAddress}`
        );

        const isNft = contractType === 'ERC-721' || contractType === 'ERC-1155';
        let basicTokenDetails: ITokenDetails;

        if (isNft) {
          // For NFTs, use NFT-specific metadata function
          const nftMetadata = await getNftStandardMetadata(
            contractAddress,
            w3Provider
          );

          basicTokenDetails = {
            id: `${contractAddress.toLowerCase()}-${
              store.getState().vault.activeNetwork.chainId
            }`,
            symbol: cleanTokenSymbol(nftMetadata.symbol).toUpperCase(),
            name: nftMetadata.name || cleanTokenSymbol(nftMetadata.symbol),
            contractAddress,
            decimals: 0, // NFTs always have 0 decimals
            balance: 0, // No balance for basic details
            chainId: store.getState().vault.activeNetwork.chainId,
            tokenStandard: contractType as any,
            isNft: true,
            isVerified: false,
          };
        } else {
          // For ERC-20 tokens, use standard token metadata
          const metadata = await getTokenStandardMetadata(
            contractAddress,
            walletAddress,
            w3Provider
          );

          basicTokenDetails = {
            id: `${contractAddress.toLowerCase()}-${
              store.getState().vault.activeNetwork.chainId
            }`,
            symbol: cleanTokenSymbol(metadata.tokenSymbol).toUpperCase(),
            name: cleanTokenSymbol(metadata.tokenSymbol), // Use symbol as name for basic info
            contractAddress,
            decimals: metadata.decimals || 18,
            balance: 0, // No balance for basic details
            chainId: store.getState().vault.activeNetwork.chainId,
            tokenStandard: contractType as any,
            isNft: false,
            isVerified: false, // Basic validation only, no CoinGecko verification
          };
        }

        // Cache the basic details for future use
        tokenDetailsCache.set(cacheKey, {
          details: basicTokenDetails,
          timestamp: now,
        });

        console.log(
          `[EvmAssetsController] Cached basic details for ${contractType} token ${basicTokenDetails.symbol}`
        );
        return basicTokenDetails;
      } catch (error) {
        console.error(
          '[EvmAssetsController] Error getting basic token details:',
          error
        );
        return null;
      } finally {
        // Clean up the pending request
        pendingRequests.delete(pendingKey);
      }
    })();

    // Store the pending request
    pendingRequests.set(pendingKey, requestPromise);

    return requestPromise;
  };

  /**
   * Get token details with balance (for import forms)
   */
  const getTokenDetailsWithBalance = async (
    contractAddress: string,
    walletAddress: string,
    w3Provider: CustomJsonRpcProvider
  ): Promise<ITokenDetails | null> => {
    try {
      // Get basic details first (cached)
      const basicDetails = await getTokenDetails(
        contractAddress,
        walletAddress,
        w3Provider
      );
      if (!basicDetails) return null;

      // For NFTs, get balance from NFT-specific methods
      if (basicDetails.isNft) {
        let balance = 0;
        try {
          if (basicDetails.tokenStandard === 'ERC-721') {
            // For ERC-721, we can get the total count of NFTs owned
            const nftBalance = await getERC721StandardBalance(
              contractAddress,
              walletAddress,
              w3Provider
            );
            balance = Number(nftBalance) || 0;
          } else if (basicDetails.tokenStandard === 'ERC-1155') {
            // For ERC-1155, we can't get total balance without knowing token IDs
            // Set balance to 0 and let the user know they need to use an API
            console.log(
              `[EvmAssetsController] ERC-1155 detected - balance check requires specific token IDs`
            );
            balance = 0;
          }
        } catch (balanceError) {
          console.warn(
            `[EvmAssetsController] Failed to get NFT balance for ${contractAddress}:`,
            balanceError
          );
        }

        return {
          ...basicDetails,
          balance,
        };
      }

      // For ERC-20 tokens, get fresh balance
      const metadata = await getTokenStandardMetadata(
        contractAddress,
        walletAddress,
        w3Provider
      );
      const balance = metadata.balance / Math.pow(10, metadata.decimals || 18);

      return {
        ...basicDetails,
        balance: balance, // Keep full precision
      };
    } catch (error) {
      console.error(
        '[EvmAssetsController] Error getting token details with balance:',
        error
      );
      return null;
    }
  };

  /**
   * Get token details with full market data (for details screens)
   */
  const getTokenDetailsWithMarketData = async (
    contractAddress: string,
    walletAddress: string,
    w3Provider: CustomJsonRpcProvider
  ): Promise<ITokenDetails | null> => {
    // Check cache first for enhanced data
    const cacheKey = `${contractAddress}-${getCurrentNetworkPlatform()}`;
    const cached = tokenDetailsCache.get(cacheKey);
    const now = Date.now();

    try {
      // Get basic details and fresh balance
      const detailsWithBalance = await getTokenDetailsWithBalance(
        contractAddress,
        walletAddress,
        w3Provider
      );
      if (!detailsWithBalance) return null;

      // Check if we have cached enhanced market data
      if (cached && now - cached.timestamp < TOKEN_DETAILS_CACHE_DURATION) {
        console.log(
          `[EvmAssetsController] Using cached market data for ${contractAddress}`
        );
        return {
          ...cached.details,
          balance: detailsWithBalance.balance, // Use fresh balance
        };
      }

      // Try to enhance with CoinGecko market data
      try {
        const currentPlatform = getCurrentNetworkPlatform();

        if (currentPlatform) {
          // Check if token exists in CoinGecko
          const response = await retryableFetch(
            `https://api.coingecko.com/api/v3/coins/${currentPlatform}/contract/${contractAddress}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false`
          );

          if (response.ok) {
            const coinGeckoData = await response.json();

            // Clean CoinGecko symbol before merging
            if (coinGeckoData.symbol) {
              coinGeckoData.symbol = cleanTokenSymbol(coinGeckoData.symbol);
            }

            // Merge CoinGecko data with our token details
            const enhancedDetails = {
              ...coinGeckoData, // All CoinGecko fields (with cleaned symbol)
              ...detailsWithBalance, // Our wallet-specific data (symbol, decimals, balance, etc.)
              isVerified: true,
            };

            console.log(
              `[EvmAssetsController] Enhanced ${detailsWithBalance.tokenStandard} token ${contractAddress} with CoinGecko market data`
            );

            // Cache the enhanced data (excluding balance)
            // eslint-disable-next-line @typescript-eslint/no-unused-vars, no-unused-vars
            const { balance: _balanceToExclude, ...cacheableData } =
              enhancedDetails;
            tokenDetailsCache.set(cacheKey, {
              details: cacheableData,
              timestamp: now,
            });

            return enhancedDetails;
          }
        }
      } catch (coinGeckoError) {
        console.warn(
          `[EvmAssetsController] Failed to fetch CoinGecko market data for ${contractAddress}:`,
          coinGeckoError
        );
      }

      // Return basic details with balance if market data fails
      console.log(
        `[EvmAssetsController] No market data available for ${contractAddress}, returning basic details with balance`
      );
      return detailsWithBalance;
    } catch (error) {
      console.error(
        '[EvmAssetsController] Error getting token details with market data:',
        error
      );
      return null;
    }
  };

  /**
   * Get only market data from CoinGecko without any blockchain calls
   * Used by details page since we already have balance/token info
   */
  const getOnlyMarketData = async (
    contractAddress: string
  ): Promise<any | null> => {
    // Check cache first
    const cacheKey = `${contractAddress}-${getCurrentNetworkPlatform()}-marketonly`;
    const cached = tokenDetailsCache.get(cacheKey);
    const now = Date.now();

    if (cached && now - cached.timestamp < TOKEN_DETAILS_CACHE_DURATION) {
      console.log(
        `[EvmAssetsController] Using cached market data for ${contractAddress}`
      );
      return cached.details;
    }

    // Check if there's already a pending request for this contract
    const pendingKey = `market-${contractAddress}`;
    if (pendingRequests.has(pendingKey)) {
      console.log(
        `[EvmAssetsController] Reusing pending market data request for ${contractAddress}`
      );
      return pendingRequests.get(pendingKey);
    }

    // Create the promise and store it
    const requestPromise = (async () => {
      try {
        const currentPlatform = getCurrentNetworkPlatform();

        if (!currentPlatform) {
          const { activeNetwork } = store.getState().vault;
          console.log(
            `[EvmAssetsController] No platform ID configured for network: ${activeNetwork.label} (chainId: ${activeNetwork.chainId})`
          );
          return null;
        }

        // Only fetch market data from CoinGecko
        const response = await retryableFetch(
          `https://api.coingecko.com/api/v3/coins/${currentPlatform}/contract/${contractAddress}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false`
        );

        if (response.ok) {
          const coinGeckoData = await response.json();

          // Clean the symbol and return in ITokenDetails format
          const marketData = {
            ...coinGeckoData,
            symbol: cleanTokenSymbol(coinGeckoData.symbol),
            isVerified: true,
          };

          console.log(
            `[EvmAssetsController] Fetched market data for ${contractAddress}`
          );

          // Cache the market data
          tokenDetailsCache.set(cacheKey, {
            details: marketData,
            timestamp: now,
          });

          return marketData;
        } else {
          console.log(
            `[EvmAssetsController] No CoinGecko data found for ${contractAddress} on ${currentPlatform}`
          );
          return null;
        }
      } catch (error) {
        console.error(
          `[EvmAssetsController] Error fetching market data for ${contractAddress}:`,
          error
        );
        return null;
      } finally {
        // Clean up the pending request
        pendingRequests.delete(pendingKey);
      }
    })();

    // Store the pending request
    pendingRequests.set(pendingKey, requestPromise);

    return requestPromise;
  };

  /**
   * Fetch specific NFT token IDs for a collection
   * Uses blockchain enumeration (APIs don't reliably return token IDs)
   * Limited to 10 tokens to avoid performance issues
   */
  const fetchNftTokenIds = async (
    contractAddress: string,
    ownerAddress: string,
    tokenStandard: 'ERC-721' | 'ERC-1155'
  ): Promise<
    {
      balance: number;
      tokenId: string;
    }[] & {
      hasMore?: boolean;
      requiresManualEntry?: boolean;
    }
  > =>
    // Use blockchain enumeration directly
    fetchNftTokenIdsFromBlockchain(
      contractAddress,
      ownerAddress,
      tokenStandard
    );
  /**
   * Fetch NFT token IDs directly from blockchain
   * Uses enumeration for ERC-721 if available
   */
  const fetchNftTokenIdsFromBlockchain = async (
    contractAddress: string,
    ownerAddress: string,
    tokenStandard: 'ERC-721' | 'ERC-1155'
  ): Promise<
    {
      balance: number;
      tokenId: string;
    }[] & {
      hasMore?: boolean;
      requiresManualEntry?: boolean;
    }
  > => {
    try {
      const { activeNetwork } = store.getState().vault;

      // Create a simple abort controller for the provider
      const abortController = new AbortController();

      // Create a provider for the current network
      const provider = new CustomJsonRpcProvider(
        abortController.signal,
        activeNetwork.url
      );

      // Use the discovery function which handles both ERC-721 and ERC-1155
      const discovery = await discoverNftTokens(
        contractAddress,
        ownerAddress,
        tokenStandard,
        provider
      );

      const result = (discovery.tokens || []) as any;
      result.hasMore = discovery.hasMore || false;
      result.requiresManualEntry = discovery.requiresManualEntry;

      return result;
    } catch (error) {
      console.error('[EvmAssetsController] Blockchain fetch failed:', error);
      // Return empty array with manual entry required
      const result = [] as any;
      result.requiresManualEntry = true;
      return result;
    }
  };

  /**
   * Verify ownership of ERC-721 token IDs
   */
  const verifyERC721Ownership = async (
    contractAddress: string,
    ownerAddress: string,
    tokenIds: string[],
    w3Provider: CustomJsonRpcProvider
  ): Promise<{ balance: number; tokenId: string; verified: boolean }[]> =>
    verifyERC721OwnershipHelper(
      contractAddress,
      ownerAddress,
      tokenIds,
      w3Provider
    );

  /**
   * Verify ownership of ERC-1155 token IDs
   */
  const verifyERC1155Ownership = async (
    contractAddress: string,
    ownerAddress: string,
    tokenIds: string[],
    w3Provider: CustomJsonRpcProvider
  ): Promise<{ balance: number; tokenId: string; verified: boolean }[]> =>
    verifyERC1155OwnershipHelper(
      contractAddress,
      ownerAddress,
      tokenIds,
      w3Provider
    );

  /**
   * Validate and fetch NFT contract details - supports custom NFT import
   * Detects NFT type and uses existing metadata fetching logic
   */
  const validateNftContract = async (
    contractAddress: string,
    walletAddress: string,
    w3Provider: CustomJsonRpcProvider
  ): Promise<ITokenDetails | null> => {
    console.log(
      `[EvmAssetsController] Validating NFT contract: ${contractAddress}`
    );

    // Get contract type first
    const contractTypeResponse = await contractChecker(
      contractAddress,
      w3Provider
    );

    if (String(contractTypeResponse).includes('Invalid contract address')) {
      console.error(
        `[EvmAssetsController] Invalid contract address: ${contractAddress}`
      );
      return null;
    }

    const contractType = (contractTypeResponse as any).type;

    // Only allow NFT contracts
    if (!['ERC-721', 'ERC-1155'].includes(contractType)) {
      throw new Error(
        'Not an NFT contract. Please ensure the contract address is for an ERC-721 or ERC-1155 token.'
      );
    }

    console.log(
      `[EvmAssetsController] Detected ${contractType} NFT contract: ${contractAddress}`
    );

    const { activeNetwork } = store.getState().vault;
    let nftDetails: ITokenDetails;

    if (contractType === 'ERC-721') {
      // ERC-721: Can get balance using balanceOf(address) - returns total count
      try {
        // First get NFT metadata (name/symbol) using proper NFT ABI
        const nftMetadata = await getNftStandardMetadata(
          contractAddress,
          w3Provider
        );

        // Then get balance using ERC-721 specific balance function
        const balance = await getERC721StandardBalance(
          contractAddress,
          walletAddress,
          w3Provider
        );

        nftDetails = {
          id: `${contractAddress.toLowerCase()}-${activeNetwork.chainId}`,
          symbol: cleanTokenSymbol(nftMetadata.symbol).toUpperCase(),
          name:
            nftMetadata.name ||
            cleanTokenSymbol(nftMetadata.symbol).toUpperCase(), // Use name if available, fallback to symbol
          contractAddress,
          decimals: 0, // NFTs always have 0 decimals
          balance: Number(balance) || 0,
          chainId: activeNetwork.chainId,
          tokenStandard: contractType as any,
          isNft: true,
          isVerified: false,
        };

        console.log(
          `[EvmAssetsController] ERC-721 balance detected: ${nftDetails.balance} NFTs, symbol: ${nftDetails.symbol}`
        );
      } catch (error) {
        console.warn(
          `[EvmAssetsController] Failed to get ERC-721 metadata/balance:`,
          error
        );

        // Fallback to manual contract calls
        const contract = new ethers.Contract(
          contractAddress,
          [
            'function name() view returns (string)',
            'function symbol() view returns (string)',
            'function balanceOf(address) view returns (uint256)',
          ],
          w3Provider
        );

        try {
          const [name, symbol, balance] = await Promise.all([
            contract.name().catch(() => 'Unknown Collection'),
            contract.symbol().catch(() => 'UNKNOWN'),
            contract.balanceOf(walletAddress).catch(() => 0),
          ]);

          nftDetails = {
            id: `${contractAddress.toLowerCase()}-${activeNetwork.chainId}`,
            symbol: cleanTokenSymbol(symbol).toUpperCase(),
            name: name || cleanTokenSymbol(symbol).toUpperCase(), // Keep names intact - they can have spaces
            contractAddress,
            decimals: 0,
            balance: Number(balance) || 0,
            chainId: activeNetwork.chainId,
            tokenStandard: contractType as any,
            isNft: true,
            isVerified: false,
          };

          console.log(
            `[EvmAssetsController] ERC-721 fallback successful: ${nftDetails.symbol}`
          );
        } catch (contractError) {
          console.error(
            `[EvmAssetsController] ERC-721 contract calls failed:`,
            contractError
          );

          nftDetails = {
            id: `${contractAddress.toLowerCase()}-${activeNetwork.chainId}`,
            symbol: 'UNKNOWN',
            name: 'Unknown Collection',
            contractAddress,
            decimals: 0,
            balance: 0,
            chainId: activeNetwork.chainId,
            tokenStandard: contractType as any,
            isNft: true,
            isVerified: false,
          };
        }
      }
    } else {
      // ERC-1155: Cannot get balance without specific token IDs
      // Need to use basic contract metadata (name/symbol) without balance
      const contract = new ethers.Contract(
        contractAddress,
        [
          'function name() view returns (string)',
          'function symbol() view returns (string)',
        ],
        w3Provider
      );

      try {
        const [name, symbol] = await Promise.all([
          contract.name().catch(() => 'Unknown'),
          contract.symbol().catch(() => 'Unknown'),
        ]);

        nftDetails = {
          id: `${contractAddress.toLowerCase()}-${activeNetwork.chainId}`,
          symbol: cleanTokenSymbol(symbol).toUpperCase(),
          name: name || cleanTokenSymbol(symbol).toUpperCase(), // Keep names intact - they can have spaces
          contractAddress,
          decimals: 0, // NFTs always have 0 decimals
          balance: 0, // ERC-1155 balance requires specific token IDs - will be updated when user enters them
          chainId: activeNetwork.chainId,
          tokenStandard: contractType as any,
          isNft: true,
          isVerified: false,
        };

        console.log(
          `[EvmAssetsController] ERC-1155 contract detected - balance requires token IDs`
        );
      } catch (error) {
        console.warn(
          `[EvmAssetsController] Failed to get ERC-1155 basic metadata:`,
          error
        );

        nftDetails = {
          id: `${contractAddress.toLowerCase()}-${activeNetwork.chainId}`,
          symbol: 'Unknown',
          name: 'Unknown Collection',
          contractAddress,
          decimals: 0,
          balance: 0,
          chainId: activeNetwork.chainId,
          tokenStandard: contractType as any,
          isNft: true,
          isVerified: false,
        };
      }
    }

    // Don't fetch CoinGecko data during validation - keep it lightweight
    console.log(`[EvmAssetsController] NFT contract validation complete:`, {
      contract: contractAddress,
      type: contractType,
      balance: nftDetails.balance,
      symbol: nftDetails.symbol,
    });

    return nftDetails;
  };

  return {
    updateAllEvmTokens,
    checkContractType,
    getERC20TokenInfo,
    // Core functionality
    getCurrentNetworkPlatform,
    getTokenPriceData,
    detectCoinGeckoIds,
    // Token details with different levels of data
    getTokenDetails, // Basic info only (cached, no balance, no market data) - for notification manager
    getTokenDetailsWithBalance, // Basic info + fresh balance - for import forms
    getTokenDetailsWithMarketData, // Full market data + balance - for details screens
    getOnlyMarketData, // Only market data, no blockchain calls - for details page

    getUserOwnedTokens,
    validateERC20Only, // ERC-20 only validation - for custom ERC-20 import
    validateNftContract, // NFT contract validation - for custom NFT import
    fetchNftTokenIds,
    verifyERC721Ownership,
    verifyERC1155Ownership,
  };
};

export default EvmAssetsController;
