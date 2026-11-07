import { getAsset } from '@sidhujag/sysweb3-utils';
import { cleanTokenSymbol } from '@sidhujag/sysweb3-utils';

import {
  parseSptInventory,
  supportsSptUtxoChain,
  type SptHolding,
} from '../../../../shared/sptInventory';
import { fetchBackendAccountCached } from '../utils/fetchBackendAccountWrapper';
import store from 'state/store';
import { ITokenSysProps, ISysAssetMetadata } from 'types/tokens';
import { formatUnits } from 'utils/ethersV6Compat';

import { ASSET_CACHE_DURATION, USER_TOKENS_CACHE_DURATION } from './constants';
import { ISysAssetsController, ISysTokensAssetReponse } from './types';
import { ensureTrailingSlash } from './utils';

const projectHolding = (
  holding: SptHolding,
  chainId: number
): ISysTokensAssetReponse => {
  const {
    assetGuid,
    confirmedUnits,
    decimals,
    metadata,
    pendingDeltaUnits,
    receivedUnits,
    sentUnits,
    transfers,
  } = holding;
  return {
    ...metadata,
    assetGuid,
    balance: formatUnits(
      (confirmedUnits + pendingDeltaUnits).toString(),
      decimals
    ),
    chainId,
    confirmedBalance: formatUnits(confirmedUnits.toString(), decimals),
    decimals,
    totalReceived: formatUnits(receivedUnits.toString(), decimals),
    totalSent: formatUnits(sentUnits.toString(), decimals),
    transfers,
    type: 'SPTAllocated',
    unconfirmedBalance: formatUnits(pendingDeltaUnits.toString(), decimals),
  } as ISysTokensAssetReponse;
};

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
    if (!supportsSptUtxoChain(networkChainId)) return [];

    const cacheKey = `${xpubOrAddress}::${networkUrl}::${networkChainId}`;
    const cached = userTokensCache.get(cacheKey);
    const now = Date.now();

    // Return cached data if valid and not expired (and no search term)
    if (cached && now - cached.timestamp < USER_TOKENS_CACHE_DURATION) {
      console.log('[SysAssetsController] Using cached user tokens');
      return cached.tokens;
    }

    const requestOptions = 'details=tokenBalances&tokens=nonzero';

    const accountData = await fetchBackendAccountCached(
      ensureTrailingSlash(networkUrl),
      xpubOrAddress,
      requestOptions,
      true
    );
    const tokens = Array.from(
      parseSptInventory(accountData, xpubOrAddress).holdings.values(),
      (holding) => ({
        ...projectHolding(holding, networkChainId),
        utxoCount: holding.utxoCount,
      })
    );
    userTokensCache.set(cacheKey, { tokens, timestamp: now });
    return tokens;
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
    const { chainId } = store.getState().vault.activeNetwork;
    if (!supportsSptUtxoChain(chainId)) return null;
    try {
      console.log(`[SysAssetsController] Validating SPT token: ${assetGuid}`);

      // Validate assetGuid format
      if (!assetGuid || !/^\d+$/.test(assetGuid)) {
        throw new Error('Invalid asset GUID format');
      }

      assetGuid = assetGuid.replace(/^0+(?=\d)/, '');

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
      let balance: string | undefined;
      try {
        // Blockbook doesn't support filtering by assetGuid, so we fetch all tokens
        const requestOptions = 'details=tokenBalances&tokens=nonzero';
        const accountData = await fetchBackendAccountCached(
          ensureTrailingSlash(networkUrl),
          xpubOrAddress,
          requestOptions,
          true
        );

        const holding = parseSptInventory(accountData, xpubOrAddress).lookup(
          assetGuid
        );
        if (holding && holding.decimals !== assetData.decimals) {
          throw new Error('SPT token balance decimals do not match metadata');
        }
        // Only a complete, valid inventory can establish an explicit zero.
        balance = holding
          ? formatUnits(
              (holding.confirmedUnits + holding.pendingDeltaUnits).toString(),
              holding.decimals
            )
          : '0';
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
        assetType: assetData.assetType,
        symbol: cleanTokenSymbol(assetData.symbol),
        name: cleanTokenSymbol(assetData.symbol), // Syscoin assets often use symbol as name - keep intact
        decimals: assetData.decimals,
        ...(balance !== undefined ? { balance } : {}),
        maxSupply: assetData.maxSupply,
        totalSupply: assetData.totalSupply,
        description: assetData.metaData || '',
        contract: assetData.contract || '', // NEVM contract if bridged
        originDecimals: assetData.originDecimals,
        tokenId: assetData.tokenId,
        chainId,
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
    networkChainId: number,
    existingAssets: ITokenSysProps[] = []
  ): Promise<ISysTokensAssetReponse[]> => {
    if (!supportsSptUtxoChain(networkChainId)) return [];
    // Refresh persisted/imported assets from all used SPT entries so zero-balance
    // tokens still keep their historical sent/received counters.
    const requestOptions = 'details=tokenBalances&tokens=used';

    const accountData = await fetchBackendAccountCached(
      ensureTrailingSlash(networkUrl),
      xpubOrAddress,
      requestOptions,
      true
    );
    const inventory = parseSptInventory(accountData, xpubOrAddress);

    // Update all manually imported tokens
    const updatedTokens: ISysTokensAssetReponse[] = existingAssets
      .filter((asset: ITokenSysProps) => asset.assetGuid !== undefined)
      .map((asset: ITokenSysProps) => {
        const holding = inventory.lookup(String(asset.assetGuid));
        if (holding) {
          // Keep user-authored metadata while refreshing chain-derived values.
          return {
            ...asset,
            ...projectHolding(holding, networkChainId),
            assetGuid: String(asset.assetGuid),
            chainId: networkChainId,
          } as ISysTokensAssetReponse;
        } else {
          // Token not in the response still remains imported. Only its live
          // balance/counters are reset; metadata must remain durable.
          return {
            ...asset,
            assetGuid: String(asset.assetGuid),
            balance: '0',
            unconfirmedBalance: '0',
            totalReceived: '0',
            totalSent: '0',
            transfers: 0,
            type: 'SPTAllocated',
            chainId: networkChainId,
          } as ISysTokensAssetReponse;
        }
      });

    // Return the explicit snapshot supplied by the caller. Reading the live
    // active account here allowed a network/account switch during the request
    // to rebuild one account's assets from another account's state.
    return updatedTokens;
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
