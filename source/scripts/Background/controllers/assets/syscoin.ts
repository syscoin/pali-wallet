import { getAsset } from '@sidhujag/sysweb3-utils';
import { cleanTokenSymbol } from '@sidhujag/sysweb3-utils';
import { isNil } from 'lodash';

import { fetchBackendAccountCached } from '../utils/fetchBackendAccountWrapper';
import store from 'state/store';
import { ITokenSysProps, ISysAssetMetadata } from 'types/tokens';

import {
  ASSET_CACHE_DURATION,
  USER_TOKENS_CACHE_DURATION,
  MAX_TOKENS_DISPLAY,
} from './constants';
import { ISysAssetsController, ISysTokensAssetReponse } from './types';
import { validateAndManageUserAssets, ensureTrailingSlash } from './utils';

const SysAssetsControler = (): ISysAssetsController => {
  // Cache for Syscoin asset metadata
  const assetCache = new Map<
    string,
    {
      data: ISysAssetMetadata;
      timestamp: number;
    }
  >();

  // Cache for user's owned SPT tokens
  const userTokensCache = new Map<
    string,
    {
      timestamp: number;
      tokens: ISysTokensAssetReponse[];
    }
  >();

  /**
   * Get cached asset data or fetch if not cached/expired
   */
  const getAssetCached = async (
    networkUrl: string,
    assetGuid: string
  ): Promise<ISysAssetMetadata | null> => {
    const cacheKey = `${networkUrl}::${assetGuid}`;
    const cached = assetCache.get(cacheKey);
    const now = Date.now();

    // Return cached data if valid and not expired
    if (cached && now - cached.timestamp < ASSET_CACHE_DURATION) {
      console.log(
        `[SysAssetsController] Using cached asset data for ${assetGuid}`
      );
      return cached.data;
    }

    // Fetch fresh data
    try {
      console.log(
        `[SysAssetsController] Fetching fresh asset data for ${assetGuid}`
      );
      const assetData = await getAsset(networkUrl, assetGuid);

      // Cache the result
      assetCache.set(cacheKey, {
        data: assetData,
        timestamp: now,
      });

      return assetData;
    } catch (error) {
      console.error(
        `[SysAssetsController] Error fetching asset ${assetGuid}:`,
        error
      );
      throw error;
    }
  };

  /**
   * Get user owned SPT tokens - similar to EVM's getUserOwnedTokens
   * Scans the blockchain for all SPT tokens the user owns
   */
  const getUserOwnedTokens = async (
    xpub: string
  ): Promise<ISysTokensAssetReponse[]> => {
    const { activeNetwork } = store.getState().vault;
    const networkUrl = activeNetwork.url;
    const networkChainId = activeNetwork.chainId;

    const cacheKey = `${xpub}::${networkUrl}::${networkChainId}`;
    const cached = userTokensCache.get(cacheKey);
    const now = Date.now();

    // Return cached data if valid and not expired (and no search term)
    if (cached && now - cached.timestamp < USER_TOKENS_CACHE_DURATION) {
      console.log('[SysAssetsController] Using cached user tokens');
      return cached.tokens;
    }

    try {
      const requestOptions = 'details=tokenBalances&tokens=nonzero';

      const { tokensAsset } = await fetchBackendAccountCached(
        ensureTrailingSlash(networkUrl),
        xpub,
        requestOptions,
        true
      );

      // IMPORTANT: For SPT tokens, we should ONLY use tokensAsset array
      // tokens array contains regular UTXO addresses without assetGuid
      // tokensAsset array contains actual SPT tokens with assetGuid
      const validTokens = tokensAsset || [];

      const preventUndefined =
        typeof validTokens === 'undefined' || validTokens === undefined
          ? []
          : validTokens;

      const getOnlyTokensWithAssetGuid: ISysTokensAssetReponse[] =
        preventUndefined
          .filter((token: any) => token.assetGuid)
          .map((tokenAsset: any) => ({
            ...tokenAsset,
            chainId: networkChainId,
          }))
          .slice(0, MAX_TOKENS_DISPLAY);

      console.log(
        `[SysAssetsController] Found ${getOnlyTokensWithAssetGuid.length} SPT tokens for user (from ${preventUndefined.length} total entries)`
      );

      // Cache the result
      userTokensCache.set(cacheKey, {
        tokens: getOnlyTokensWithAssetGuid,
        timestamp: now,
      });

      return getOnlyTokensWithAssetGuid;
    } catch (err) {
      console.error('[SysAssetsController] getUserOwnedTokens error:', err);
      return [];
    }
  };

  /**
   * Validate SPT token by assetGuid - similar to EVM's validateERC20Only
   * Used by the "Add Custom" tab for manual token import
   */
  const validateSPTOnly = async (
    assetGuid: string,
    xpub: string,
    networkUrl: string
  ): Promise<ITokenSysProps | null> => {
    try {
      console.log(`[SysAssetsController] Validating SPT token: ${assetGuid}`);

      // Validate assetGuid format
      if (!assetGuid || !/^\d+$/.test(assetGuid)) {
        throw new Error('Invalid asset GUID format');
      }

      // Fetch asset metadata
      const assetData = await getAssetCached(networkUrl, assetGuid);

      if (!assetData) {
        throw new Error('Asset not found');
      }

      // Check if it's a valid SPT token
      if (!assetData.symbol || assetData.decimals === undefined) {
        throw new Error('Invalid SPT token data');
      }

      // Get user's balance for this asset (optional)
      let balance = 0;
      try {
        // Blockbook doesn't support filtering by assetGuid, so we fetch all tokens
        const requestOptions = 'details=tokenBalances&tokens=nonzero';
        const accountData = await fetchBackendAccountCached(
          ensureTrailingSlash(networkUrl),
          xpub,
          requestOptions,
          true
        );

        // IMPORTANT: For SPT tokens, we should ONLY use tokensAsset array
        // tokens array contains regular UTXO addresses without assetGuid
        const tokens = accountData.tokensAsset || [];

        // Find the specific token by assetGuid
        const tokenData = tokens.find(
          (t: any) => t.assetGuid?.toString() === assetGuid
        );

        if (tokenData && tokenData.balance !== undefined) {
          // Keep balance in satoshis - it will be converted for display in UI
          balance = Number(tokenData.balance);
        }
      } catch (balanceError) {
        console.warn(
          '[SysAssetsController] Could not fetch balance:',
          balanceError
        );
        // Continue without balance
      }

      // Return validated token details
      const tokenDetails: ITokenSysProps = {
        assetGuid: assetGuid,
        symbol: cleanTokenSymbol(assetData.symbol),
        name: cleanTokenSymbol(assetData.symbol), // Syscoin assets often use symbol as name - keep intact
        decimals: assetData.decimals,
        balance: balance,
        maxSupply: assetData.maxSupply,
        totalSupply: assetData.totalSupply,
        description: assetData.metaData || '',
        contract: assetData.contract || '', // NEVM contract if bridged
        chainId: store.getState().vault.activeNetwork.chainId,
        type: 'SPTAllocated',
      };

      console.log(
        `[SysAssetsController] Valid SPT token found: ${assetData.symbol}`
      );
      return tokenDetails;
    } catch (error) {
      console.error('[SysAssetsController] Error validating SPT token:', error);
      return null;
    }
  };

  const addSysDefaultToken = async (assetGuid: string, networkUrl: string) => {
    try {
      const metadata = await getAssetCached(networkUrl, assetGuid);

      if (!metadata) {
        throw new Error('Asset not found');
      }

      if (!metadata.symbol) {
        throw new Error('Asset has no symbol');
      }

      const sysAssetToAdd = {
        ...metadata,
        symbol: metadata.symbol, // Syscoin 5 uses plain text symbols
        balance: 0, // Initialize with 0 in display format, will be updated by asset refresh
      } as ITokenSysProps;

      return sysAssetToAdd;
    } catch (error) {
      console.error('addSysDefaultToken error:', error);
      throw error; // Re-throw to let caller handle
    }
  };

  const getSysAssetsByXpub = async (
    xpub: string,
    networkUrl: string,
    networkChainId: number
  ): Promise<ISysTokensAssetReponse[]> => {
    try {
      const requestOptions = 'details=tokenBalances&tokens=nonzero';

      const { tokensAsset } = await fetchBackendAccountCached(
        ensureTrailingSlash(networkUrl),
        xpub,
        requestOptions,
        true
      );

      // IMPORTANT: For SPT tokens, we should ONLY use tokensAsset array
      // tokens array contains regular UTXO addresses without assetGuid
      // tokensAsset array contains actual SPT tokens with assetGuid
      const validTokens = tokensAsset || [];

      const preventUndefined =
        typeof validTokens === 'undefined' || validTokens === undefined
          ? []
          : validTokens;
      //We need to get only tokens that has AssetGuid property
      const getOnlyTokensWithAssetGuid: ISysTokensAssetReponse[] =
        preventUndefined.filter(
          (token: ISysTokensAssetReponse) => !isNil(token.assetGuid)
        );

      // Get existing manually imported tokens from state
      const { activeAccount, accountAssets } = store.getState().vault;
      const existingAssets =
        accountAssets[activeAccount.type]?.[activeAccount.id]?.syscoin || [];

      // Create a map of blockchain tokens for easy lookup
      const blockchainTokensMap = new Map(
        getOnlyTokensWithAssetGuid.map((token) => [token.assetGuid, token])
      );

      // Update all manually imported tokens
      const updatedTokens: ISysTokensAssetReponse[] = existingAssets
        .filter((asset: ITokenSysProps) => asset.assetGuid !== undefined)
        .map((asset: ITokenSysProps) => {
          const blockchainToken = blockchainTokensMap.get(asset.assetGuid!);

          if (blockchainToken) {
            // Token found in blockchain response - use updated data
            // Convert all satoshi values to display format
            const decimals = blockchainToken.decimals || 8;
            const divisor = Math.pow(10, decimals);
            return {
              ...blockchainToken,
              balance: blockchainToken.balance / divisor,
              totalSent: String(Number(blockchainToken.totalSent) / divisor),
              totalReceived: String(
                Number(blockchainToken.totalReceived) / divisor
              ),
              chainId: networkChainId,
              type: 'SPTAllocated',
            };
          } else {
            // Token not in blockchain response - set balance to 0
            return {
              assetGuid: asset.assetGuid!,
              balance: 0,
              decimals: asset.decimals,
              name: asset.name || asset.symbol,
              path: '',
              symbol: asset.symbol,
              totalReceived: '0',
              totalSent: '0',
              transfers: 0,
              type: 'SPTAllocated',
              chainId: networkChainId,
            } as ISysTokensAssetReponse;
          }
        });

      const filteredAssetsLength = updatedTokens.slice(0, MAX_TOKENS_DISPLAY);

      if (filteredAssetsLength && filteredAssetsLength.length > 0) {
        const treatedAssets = validateAndManageUserAssets(
          false,
          filteredAssetsLength
        ) as ISysTokensAssetReponse[];
        // Syscoin 5 uses plain text symbols, no decoding needed
        return treatedAssets;
      }

      return [];
    } catch (error) {
      console.error('SysAssetsControler -> getSysAssetsByXpub -> error', error);
      return [];
    }
  };

  return {
    addSysDefaultToken,
    getSysAssetsByXpub,
    getAssetCached,
    getUserOwnedTokens,
    validateSPTOnly,
  };
};

export default SysAssetsControler;
