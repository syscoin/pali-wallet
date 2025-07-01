import { ethers } from 'ethers';
import floor from 'lodash/floor';
import isEmpty from 'lodash/isEmpty';
import isNil from 'lodash/isNil';

import { CustomJsonRpcProvider } from '@pollum-io/sysweb3-keyring';
import { IKeyringAccountState } from '@pollum-io/sysweb3-keyring';
import {
  contractChecker,
  getErc20Abi,
  getErc21Abi,
  getErc55Abi,
  getTokenStandardMetadata,
} from '@pollum-io/sysweb3-utils';

import { Queue } from '../transactions/queue';
import store from 'state/store';
import {
  IERC1155Collection,
  ITokenEthProps,
  ITokenDetails,
  ITokenSearchResult,
} from 'types/tokens';

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
    const apiUrl = activeNetwork.explorer;

    if (!apiUrl) {
      console.warn(
        `[EvmAssetsController] No explorer API URL found for network: ${activeNetwork.label}`
      );
      return [];
    }

    try {
      console.log(`[EvmAssetsController] Fetching user tokens from ${apiUrl}`);

      // Parse explorer API URL and construct tokenlist endpoint
      const url = new URL(apiUrl);
      const baseUrl = `${url.protocol}//${url.host}`;

      // Try to extract API key from existing URL or use free tier
      const urlParams = new URLSearchParams(url.search);
      const apiKey = urlParams.get('apikey') || 'YourApiKeyToken';

      const tokenListUrl = `${baseUrl}/api?module=account&action=tokenlist&address=${walletAddress}&apikey=${apiKey}`;

      const response = await fetch(tokenListUrl);

      if (!response.ok) {
        console.warn(
          `[EvmAssetsController] Failed to fetch user tokens: ${response.status}`
        );
        return [];
      }

      const data = await response.json();

      if (data.status !== '1' || !data.result) {
        console.warn(
          `[EvmAssetsController] API returned no tokens or error:`,
          data.message
        );
        return [];
      }

      const tokens = data.result;

      // Convert to ITokenSearchResult format
      const results: ITokenSearchResult[] = tokens.map((token: any) => ({
        id: `${token.contractAddress.toLowerCase()}-${activeNetwork.chainId}`,
        symbol: token.symbol || 'Unknown',
        name: token.name || 'Unknown Token',
        contractAddress: token.contractAddress,
        balance:
          parseFloat(token.balance) /
          Math.pow(10, parseInt(token.decimals) || 18),
        decimals: parseInt(token.decimals) || 18,
        type: token.type || 'ERC-20',
        // These will be enhanced with CoinGecko data if available
        marketCapRank: undefined,
        image: undefined,
        currentPrice: undefined,
        priceChange24h: undefined,
        marketCap: undefined,
      }));

      console.log(
        `[EvmAssetsController] Found ${
          results.length
        } tokens held by user, enhanced ${
          results.filter((r) => r.image).length
        } with market data`
      );
      return results;
    } catch (error) {
      console.error(`[EvmAssetsController] Error fetching user tokens:`, error);
      return [];
    }
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

      try {
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
          id: contractAddress.toLowerCase(),
          symbol: symbol.toUpperCase(),
          name: name || symbol,
          contractAddress,
          decimals,
          balance: formattedBalance,
          chainId: store.getState().vault.activeNetwork.chainId,
          tokenStandard,
          isNft: false,
          isVerified: false,
        };

        // Try to enhance with CoinGecko data (non-blocking)
        try {
          const currentPlatform = getCurrentNetworkPlatform();
          if (currentPlatform) {
            const response = await fetch(
              `https://api.coingecko.com/api/v3/coins/${currentPlatform}/contract/${contractAddress}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false`
            );

            if (response.ok) {
              const coinGeckoData = await response.json();
              // Merge CoinGecko data
              return {
                ...coinGeckoData,
                ...tokenDetails,
                isVerified: true,
              };
            }
          }
        } catch (coinGeckoError) {
          console.warn(
            `[EvmAssetsController] CoinGecko data not available for ${contractAddress}`
          );
        }

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
    } catch (error) {
      console.error(
        '[EvmAssetsController] Error validating ERC-20 token:',
        error
      );
      throw error;
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
      const priceResponse = await fetch(
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
      const platformsResponse = await fetch(
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

  const updateAllEvmTokens = async (
    account: IKeyringAccountState,
    currentNetworkChainId: number,
    w3Provider: CustomJsonRpcProvider,
    accountAssets: ITokenEthProps[]
  ): Promise<ITokenEthProps[]> => {
    if (isEmpty(accountAssets)) return [];
    const queue = new Queue(3);

    try {
      queue.execute(
        async () =>
          await Promise.all(
            accountAssets.map(async (vaultAssets: ITokenEthProps) => {
              if (vaultAssets.chainId === currentNetworkChainId) {
                const provider = w3Provider;
                let nftContractType = null;
                let currentAbi = null;

                currentAbi = getErc20Abi();

                if (vaultAssets.isNft) {
                  nftContractType =
                    vaultAssets?.is1155 === undefined ? 'ERC-721' : 'ERC-1155';

                  currentAbi =
                    nftContractType === 'ERC-721'
                      ? getErc21Abi()
                      : getErc55Abi();
                }

                const contract = new ethers.Contract(
                  vaultAssets.contractAddress,
                  currentAbi,
                  provider
                );

                if (nftContractType === 'ERC-1155') {
                  const newCollection = (await Promise.all(
                    vaultAssets.collection.map(async (nft) => {
                      const balanceCallMethod = await contract.balanceOf(
                        account.address,
                        nft.tokenId
                      );

                      const balance = Number(balanceCallMethod);

                      return { ...nft, balance };
                    })
                  )) as IERC1155Collection[];

                  if (newCollection.length > 0) {
                    return { ...vaultAssets, collection: newCollection };
                  }
                }

                const balanceCallMethod = await contract.balanceOf(
                  account.address
                );

                const balance = vaultAssets.isNft
                  ? Number(balanceCallMethod)
                  : `${balanceCallMethod / 10 ** Number(vaultAssets.decimals)}`;

                const formattedBalance = vaultAssets.isNft
                  ? balance
                  : floor(parseFloat(balance as string), 4);

                return { ...vaultAssets, balance: formattedBalance };
              }
              return null;
            })
          )
      );

      const results = await queue.done();

      const updatedTokens = results
        .filter((result) => result.success)
        .map(({ result }) => result);

      const tokens = updatedTokens.some((entry) => isNil(entry))
        ? [...accountAssets]
        : updatedTokens.filter((entry) => !isNil(entry));

      return validateAndManageUserAssets(true, tokens) as ITokenEthProps[];
    } catch (error) {
      console.error(
        "Pali utils: Couldn't update assets due to the following issue ",
        error
      );
      return accountAssets;
    }
  };

  // Wrapper methods for UI components to use via controllerEmitter
  const checkContractType = async (
    contractAddress: string,
    w3Provider: CustomJsonRpcProvider
  ) => {
    try {
      return await contractChecker(contractAddress, w3Provider);
    } catch (error) {
      console.error('Error checking contract type:', error);
      throw error;
    }
  };

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
      symbol,
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
    const cacheKey = `${contractAddress}-basic`;
    const cached = tokenDetailsCache.get(cacheKey);
    const now = Date.now();

    // Return cached data if available (no balance, so no need to refresh)
    if (cached && now - cached.timestamp < TOKEN_DETAILS_CACHE_DURATION) {
      console.log(
        `[EvmAssetsController] Using cached basic token details for ${contractAddress}`
      );
      return cached.details;
    }

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

      // Get basic token metadata (no balance to save API calls)
      const metadata = await getTokenStandardMetadata(
        contractAddress,
        walletAddress,
        w3Provider
      );

      // Create basic token details (no balance, no market data)
      const basicTokenDetails: ITokenDetails = {
        id: `${contractAddress.toLowerCase()}-basic`,
        symbol: metadata.tokenSymbol.toUpperCase(),
        name: metadata.tokenSymbol, // Use symbol as name for basic info
        contractAddress,
        decimals: metadata.decimals || 18,
        balance: 0, // No balance for basic details
        chainId: store.getState().vault.activeNetwork.chainId,
        tokenStandard: contractType as any,
        isNft: contractType === 'ERC-721' || contractType === 'ERC-1155',
        nftType:
          contractType === 'ERC-721'
            ? 'ERC-721'
            : contractType === 'ERC-1155'
            ? 'ERC-1155'
            : undefined,
        isVerified: false, // Basic validation only, no CoinGecko verification
      };

      // Cache the basic details for future use
      tokenDetailsCache.set(cacheKey, {
        details: basicTokenDetails,
        timestamp: now,
      });

      console.log(
        `[EvmAssetsController] Cached basic details for ${contractType} token ${metadata.tokenSymbol}`
      );
      return basicTokenDetails;
    } catch (error) {
      console.error(
        '[EvmAssetsController] Error getting basic token details:',
        error
      );
      return null;
    }
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

      // Get fresh balance
      const metadata = await getTokenStandardMetadata(
        contractAddress,
        walletAddress,
        w3Provider
      );
      const balance = metadata.balance / Math.pow(10, metadata.decimals || 18);

      return {
        ...basicDetails,
        balance: Math.floor(balance * 10000) / 10000,
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
          const response = await fetch(
            `https://api.coingecko.com/api/v3/coins/${currentPlatform}/contract/${contractAddress}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false`
          );

          if (response.ok) {
            const coinGeckoData = await response.json();

            // Merge CoinGecko data with our token details
            const enhancedDetails = {
              ...coinGeckoData, // All CoinGecko fields
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
        const response = await fetch(
          `https://api.coingecko.com/api/v3/coins/${currentPlatform}/contract/${contractAddress}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false`
        );

        if (response.ok) {
          const coinGeckoData = await response.json();

          // Extract only market-related data
          const marketData = {
            id: coinGeckoData.id,
            name: coinGeckoData.name,
            symbol: coinGeckoData.symbol,
            image: coinGeckoData.image,
            currentPrice: coinGeckoData.market_data?.current_price?.usd || 0,
            marketCap: coinGeckoData.market_data?.market_cap?.usd || 0,
            marketCapRank: coinGeckoData.market_cap_rank,
            totalVolume: coinGeckoData.market_data?.total_volume?.usd || 0,
            priceChange24h:
              coinGeckoData.market_data?.price_change_percentage_24h || 0,
            circulatingSupply:
              coinGeckoData.market_data?.circulating_supply || 0,
            totalSupply: coinGeckoData.market_data?.total_supply || 0,
            categories: coinGeckoData.categories || [],
            description: coinGeckoData.description?.en || '',
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
    validateERC20Only, // New simplified version - only 4 ETH calls
  };
};

export default EvmAssetsController;
