import { isNil } from 'lodash';

import { getAsset } from '@pollum-io/sysweb3-utils';

import { fetchBackendAccountCached } from '../utils/fetchBackendAccountWrapper';
import store from 'state/store';
import { ITokenSysProps, ISysAssetMetadata } from 'types/tokens';

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

  const ASSET_CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours cache for asset metadata

  // Cache for user's owned SPT tokens
  const userTokensCache = new Map<
    string,
    {
      timestamp: number;
      tokens: ISysTokensAssetReponse[];
    }
  >();

  const USER_TOKENS_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes cache for user tokens

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
      console.log('[SysAssetsController] Fetching user owned SPT tokens');

      // Get all SPT tokens from xpub with details
      const requestOptions = 'details=tokenBalances&tokens=nonzero';
      const { tokens, tokensAsset } = await fetchBackendAccountCached(
        ensureTrailingSlash(networkUrl),
        xpub,
        requestOptions,
        true
      );

      const isTokensAssetValid = tokensAsset && tokensAsset.length > 0;
      const validTokens = isTokensAssetValid ? tokensAsset : tokens;

      const preventUndefined =
        typeof validTokens === 'undefined' || validTokens === undefined
          ? []
          : validTokens;

      // Filter to only SPT tokens with assetGuid
      const sptTokens: ISysTokensAssetReponse[] = preventUndefined.filter(
        (token: ISysTokensAssetReponse) => !isNil(token.assetGuid)
      );

      // Add chainId to each token
      const tokensWithChain = sptTokens.map((asset) => ({
        ...asset,
        chainId: networkChainId,
      }));

      // Cache the unfiltered results
      userTokensCache.set(cacheKey, {
        tokens: tokensWithChain,
        timestamp: now,
      });

      console.log(
        `[SysAssetsController] Found ${tokensWithChain.length} SPT tokens for user`
      );
      return tokensWithChain;
    } catch (error) {
      console.error(
        '[SysAssetsController] Error fetching user owned tokens:',
        error
      );
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

        // Use tokensAsset if available, otherwise fall back to tokens
        const tokens =
          accountData.tokensAsset && accountData.tokensAsset.length > 0
            ? accountData.tokensAsset
            : accountData.tokens || [];

        // Find the specific token by assetGuid
        const tokenData = tokens.find(
          (t: any) => t.assetGuid?.toString() === assetGuid
        );

        if (tokenData && tokenData.balance !== undefined) {
          // Balance is already in the smallest unit, divide by decimals
          balance =
            Number(tokenData.balance) / Math.pow(10, assetData.decimals);
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
        symbol: assetData.symbol,
        name: assetData.symbol, // Syscoin assets often use symbol as name
        decimals: assetData.decimals,
        balance: balance,
        maxSupply: assetData.maxSupply,
        totalSupply: assetData.totalSupply,
        description: assetData.metaData || '',
        contract: assetData.contract || '', // NEVM contract if bridged
        chainId: store.getState().vault.activeNetwork.chainId,
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
        balance: 0, // Initialize with 0, will be updated by asset refresh
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

      const { tokens, tokensAsset } = await fetchBackendAccountCached(
        ensureTrailingSlash(networkUrl),
        xpub,
        requestOptions,
        true
      );

      //Validate to know which tokens use, for some cases the request only return tokens without tokensAsset
      //and for some other cases return both
      const isTokensAssetValid = tokensAsset && tokensAsset.length > 0;

      const validTokens = isTokensAssetValid ? tokensAsset : tokens;

      const preventUndefined =
        typeof validTokens === 'undefined' || validTokens === undefined
          ? []
          : validTokens;
      //We need to get only tokens that has AssetGuid property
      const getOnlyTokensWithAssetGuid: ISysTokensAssetReponse[] =
        preventUndefined.filter(
          (token: ISysTokensAssetReponse) => !isNil(token.assetGuid)
        );

      const filteredAssetsLength = getOnlyTokensWithAssetGuid.slice(0, 30);

      if (filteredAssetsLength && filteredAssetsLength.length > 0) {
        //Need to add chainId inside the asset object to we can validate it based on network connect
        //To show it on list and maintain correctly inside state
        const assetsWithChain = filteredAssetsLength.map((asset) => {
          if (asset.chainId && asset.chainId === networkChainId) return asset;

          return { ...asset, chainId: networkChainId };
        });

        const treatedAssets = validateAndManageUserAssets(
          false,
          assetsWithChain
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
