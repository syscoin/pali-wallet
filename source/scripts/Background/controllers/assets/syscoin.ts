import { formatUnits } from '@ethersproject/units';
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
  };

  /**
   * Get user owned SPT tokens - similar to EVM's getUserOwnedTokens
   * Scans the blockchain for all SPT tokens the user owns
   */
  const getUserOwnedTokens = async (
    xpubOrAddress: string
  ): Promise<ISysTokensAssetReponse[]> => {
    const { activeNetwork } = store.getState().vault;
    const networkUrl = activeNetwork.url;
    const networkChainId = activeNetwork.chainId;

    const cacheKey = `${xpubOrAddress}::${networkUrl}::${networkChainId}`;
    const cached = userTokensCache.get(cacheKey);
    const now = Date.now();

    // Return cached data if valid and not expired (and no search term)
    if (cached && now - cached.timestamp < USER_TOKENS_CACHE_DURATION) {
      console.log('[SysAssetsController] Using cached user tokens');
      return cached.tokens;
    }

    const requestOptions = 'details=tokenBalances&tokens=nonzero';

    const { tokensAsset } = await fetchBackendAccountCached(
      ensureTrailingSlash(networkUrl),
      xpubOrAddress,
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

    // Group tokens by assetGuid to aggregate multiple UTXOs
    const tokensByAssetGuid = new Map<string, any[]>();

    preventUndefined
      .filter((token: any) => token.assetGuid)
      .forEach((tokenAsset: any) => {
        const guid = String(tokenAsset.assetGuid);
        if (!tokensByAssetGuid.has(guid)) {
          tokensByAssetGuid.set(guid, []);
        }
        tokensByAssetGuid.get(guid)!.push(tokenAsset);
      });

    // Aggregate balances for each unique asset
    const getOnlyTokensWithAssetGuid: ISysTokensAssetReponse[] = Array.from(
      tokensByAssetGuid.entries()
    )
      .map(([assetGuid, tokens]) => {
        // Take the first token as the base (for metadata)
        const firstToken = tokens[0];
        const decimals = firstToken.decimals || 8;

        // Sum up balances from all UTXOs for this asset
        let totalConfirmedBalance = 0;
        let totalUnconfirmedBalance = 0;
        let totalSent = BigInt(0);
        let totalReceived = BigInt(0);
        let totalTransfers = 0;

        tokens.forEach((token: any) => {
          // Add confirmed balance
          totalConfirmedBalance += parseFloat(
            formatUnits(String(token.balance || 0), decimals)
          );

          // Add unconfirmed delta (can be positive or negative)
          // Blockbook now provides per-address SPT unconfirmed deltas
          const unconfirmedRaw =
            token.unconfirmedBalance !== undefined
              ? token.unconfirmedBalance
              : 0;
          totalUnconfirmedBalance += parseFloat(
            formatUnits(String(unconfirmedRaw || 0), decimals)
          );

          // Sum up totals (using BigInt to avoid precision issues)
          totalSent += BigInt(token.totalSent || 0);
          totalReceived += BigInt(token.totalReceived || 0);
          totalTransfers += token.transfers || 0;
        });

        // Real-time balance is confirmed + unconfirmed delta
        const displayBalance = totalConfirmedBalance + totalUnconfirmedBalance;

        return {
          ...firstToken,
          assetGuid: assetGuid,
          // Use aggregated balances
          balance: displayBalance,
          confirmedBalance: totalConfirmedBalance,
          unconfirmedBalance: totalUnconfirmedBalance,
          totalSent: formatUnits(totalSent.toString(), decimals),
          totalReceived: formatUnits(totalReceived.toString(), decimals),
          transfers: totalTransfers,
          chainId: networkChainId,
          // Include count of UTXOs for debugging
          utxoCount: tokens.length,
        };
      })
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
  };

  /**
   * Validate SPT token by assetGuid - similar to EVM's validateERC20Only
   * Used by the "Add Custom" tab for manual token import
   */
  const validateSPTOnly = async (
    assetGuid: string,
    xpubOrAddress: string,
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
      let balance: number = 0;
      try {
        // Blockbook doesn't support filtering by assetGuid, so we fetch all tokens
        const requestOptions = 'details=tokenBalances&tokens=nonzero';
        const accountData = await fetchBackendAccountCached(
          ensureTrailingSlash(networkUrl),
          xpubOrAddress,
          requestOptions,
          true
        );

        // IMPORTANT: For SPT tokens, we should ONLY use tokensAsset array
        // tokens array contains regular UTXO addresses without assetGuid
        const tokens = accountData.tokensAsset || [];

        // Find ALL tokens with this assetGuid to aggregate balances
        const matchingTokens = tokens.filter(
          (t: any) => t.assetGuid?.toString() === assetGuid
        );

        if (matchingTokens.length > 0) {
          // Convert from satoshis to display format and aggregate across all UTXOs
          const decimals = assetData.decimals || 8;

          // Sum up balances from all UTXOs for this asset
          balance = matchingTokens.reduce((total: number, token: any) => {
            const tokenBalance = parseFloat(
              formatUnits(String(token.balance || 0), decimals)
            );
            return total + tokenBalance;
          }, 0);

          console.log(
            `[SysAssetsController] Found ${matchingTokens.length} UTXOs for asset ${assetGuid}, total balance: ${balance}`
          );
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
  };

  const getSysAssetsByXpub = async (
    xpubOrAddress: string,
    networkUrl: string,
    networkChainId: number
  ): Promise<ISysTokensAssetReponse[]> => {
    const requestOptions = 'details=tokenBalances&tokens=nonzero';

    const { tokensAsset } = await fetchBackendAccountCached(
      ensureTrailingSlash(networkUrl),
      xpubOrAddress,
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

    // Group tokens by assetGuid to aggregate multiple UTXOs
    const tokensByAssetGuid = new Map<string, any[]>();

    preventUndefined
      .filter((token: any) => !isNil(token.assetGuid))
      .forEach((tokenAsset: any) => {
        const guid = String(tokenAsset.assetGuid);
        if (!tokensByAssetGuid.has(guid)) {
          tokensByAssetGuid.set(guid, []);
        }
        tokensByAssetGuid.get(guid)!.push(tokenAsset);
      });

    // Aggregate balances for each unique asset
    const aggregatedTokensMap = new Map<string, ISysTokensAssetReponse>();

    tokensByAssetGuid.forEach((tokens, assetGuid) => {
      // Take the first token as the base (for metadata)
      const firstToken = tokens[0];
      const decimals = firstToken.decimals || 8;

      // Sum up balances from all UTXOs for this asset
      let totalConfirmedBalance = 0;
      let totalUnconfirmedBalance = 0;
      let totalSent = BigInt(0);
      let totalReceived = BigInt(0);
      let totalTransfers = 0;

      tokens.forEach((token: any) => {
        // Add confirmed balance
        totalConfirmedBalance += parseFloat(
          formatUnits(String(token.balance || 0), decimals)
        );

        // Add unconfirmed delta (positive for receiver, negative for sender)
        const unconfirmedRaw =
          token.unconfirmedBalance !== undefined ? token.unconfirmedBalance : 0;
        totalUnconfirmedBalance += parseFloat(
          formatUnits(String(unconfirmedRaw || 0), decimals)
        );

        // Sum up totals (using BigInt to avoid precision issues)
        totalSent += BigInt(token.totalSent || 0);
        totalReceived += BigInt(token.totalReceived || 0);
        totalTransfers += token.transfers || 0;
      });

      // Real-time balance is confirmed + unconfirmed delta
      const displayBalance = totalConfirmedBalance + totalUnconfirmedBalance;

      aggregatedTokensMap.set(assetGuid, {
        ...firstToken,
        assetGuid: assetGuid,
        balance: displayBalance,
        confirmedBalance: totalConfirmedBalance,
        unconfirmedBalance: totalUnconfirmedBalance,
        totalSent: formatUnits(totalSent.toString(), decimals),
        totalReceived: formatUnits(totalReceived.toString(), decimals),
        transfers: totalTransfers,
        chainId: networkChainId,
        type: 'SPTAllocated',
      });
    });

    // Get existing manually imported tokens from state
    const { activeAccount, accountAssets } = store.getState().vault;
    const existingAssets =
      accountAssets[activeAccount.type]?.[activeAccount.id]?.syscoin || [];

    // Use aggregated tokens map for lookups
    const blockchainTokensMap = aggregatedTokensMap;

    // Update all manually imported tokens
    const updatedTokens: ISysTokensAssetReponse[] = existingAssets
      .filter((asset: ITokenSysProps) => asset.assetGuid !== undefined)
      .map((asset: ITokenSysProps) => {
        const blockchainToken = blockchainTokensMap.get(asset.assetGuid!);

        if (blockchainToken) {
          // Token found in blockchain response - use aggregated data
          return blockchainToken;
        } else {
          // Token not in blockchain response - set balance to 0
          return {
            assetGuid: asset.assetGuid!,
            balance: 0,
            unconfirmedBalance: 0,
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
