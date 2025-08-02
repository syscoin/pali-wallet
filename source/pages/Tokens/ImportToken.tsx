import {
  LoadingOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
} from '@ant-design/icons';
import { debounce } from 'lodash';
import React, {
  useState,
  useCallback,
  useEffect,
  useMemo,
  useDeferredValue,
  useRef,
} from 'react';
import { useTranslation } from 'react-i18next';
import { TbFileImport } from 'react-icons/tb';
import { useSelector } from 'react-redux';
import { useSearchParams, useLocation } from 'react-router-dom';

import PaliLogo from 'assets/all_assets/favicon-32.png';
import { ImportableAssetsList } from 'components/index';
import { useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import {
  ITokenEthProps,
  ITokenDetails,
  ITokenSearchResult,
} from 'types/tokens';
import {
  getCurrentTab,
  createNavigationContext,
  navigateWithContext,
} from 'utils/navigationState';

export const ImportToken: React.FC = () => {
  const { controllerEmitter } = useController();
  const { navigate, alert } = useUtils();
  const { t } = useTranslation();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  // Tab state - get initial from URL params or location state
  const getInitialTab = () => {
    const tabValue = getCurrentTab(searchParams, location.state, 'owned');
    return tabValue as 'owned' | 'custom';
  };

  const [activeTab, setActiveTab] = useState<'owned' | 'custom'>(
    getInitialTab()
  );

  // PATH 1: Your Tokens state
  const [ownedTokens, setOwnedTokens] = useState<ITokenSearchResult[]>([]);
  const [isLoadingOwned, setIsLoadingOwned] = useState(false);

  // PATH 2: Custom Token state - restore from navigation state if available
  const [customContractAddress, setCustomContractAddress] = useState(
    location.state?.customContractAddress || ''
  );
  const [customTokenDetails, setCustomTokenDetails] =
    useState<ITokenDetails | null>(location.state?.customTokenDetails || null);
  const [isValidatingCustom, setIsValidatingCustom] = useState(false);

  // Common state
  const [currentlyImporting, setCurrentlyImporting] = useState<string | null>(
    null
  );
  const [recentlyImportedIds, setRecentlyImportedIds] = useState<Set<string>>(
    new Set()
  );
  const [fetchingLogos, setFetchingLogos] = useState<Set<string>>(new Set());

  const {
    accounts,
    activeAccount: activeAccountMeta,
    activeNetwork,
    accountAssets,
  } = useSelector((state: RootState) => state.vault);
  const activeAccount = accounts[activeAccountMeta.type][activeAccountMeta.id];
  const activeAccountAssets =
    accountAssets?.[activeAccountMeta.type]?.[activeAccountMeta.id];

  // Use deferred value for search optimization
  const deferredCustomAddress = useDeferredValue(customContractAddress);

  // Refs for stable debounce
  const debouncedValidationRef = useRef<ReturnType<typeof debounce> | null>(
    null
  );
  const loadingKeyRef = useRef<string>('');

  // Calculate imported asset IDs for efficient lookup - must match the token ID format
  const importedAssetIds = useMemo(() => {
    const ids = new Set<string>();
    if (activeAccountAssets?.ethereum) {
      activeAccountAssets.ethereum
        .filter((token) => token.chainId === activeNetwork.chainId)
        .forEach((token) => {
          // Use the same ID format: contractAddress-chainId
          ids.add(`${token.contractAddress.toLowerCase()}-${token.chainId}`);
        });
    }
    // Also add recently imported IDs (these should also use the same format)
    recentlyImportedIds.forEach((id) => ids.add(id));
    return ids;
  }, [
    activeAccountAssets?.ethereum,
    activeNetwork.chainId,
    recentlyImportedIds,
  ]);

  // PATH 1: Load tokens user actually owns
  const loadOwnedTokens = useCallback(async () => {
    if (!activeAccount?.address) return;

    setIsLoadingOwned(true);
    try {
      const results = (await controllerEmitter(
        ['wallet', 'getUserOwnedTokens'],
        [activeAccount.address]
      )) as ITokenSearchResult[];

      // Group tokens by contract address to combine duplicates
      const groupedByContract = new Map<string, ITokenSearchResult>();
      const erc1155TokenCounts = new Map<string, number>(); // Track unique token IDs per contract

      results.forEach((token) => {
        const contractKey = token.contractAddress?.toLowerCase() || '';
        const existing = groupedByContract.get(contractKey);

        if (existing) {
          if (token.tokenStandard === 'ERC-1155') {
            // For ERC-1155, count unique token IDs instead of summing balances
            erc1155TokenCounts.set(
              contractKey,
              (erc1155TokenCounts.get(contractKey) || 1) + 1
            );
            // Don't sum balances for ERC-1155 - keep the count of unique items
            existing.balance = erc1155TokenCounts.get(contractKey) || 1;
          } else {
            // For other tokens, combine balances
            existing.balance = (existing.balance || 0) + (token.balance || 0);
          }
          // Keep the first token's metadata (name, symbol, etc.)
        } else {
          if (token.tokenStandard === 'ERC-1155') {
            // For ERC-1155, always use count instead of balance
            groupedByContract.set(contractKey, { ...token, balance: 1 });
            erc1155TokenCounts.set(contractKey, 1);
          } else {
            groupedByContract.set(contractKey, { ...token });
          }
        }
      });

      // Convert back to array
      const groupedResults = Array.from(groupedByContract.values());
      const filteredResults = groupedResults.filter((token) => {
        const tokenId = `${token.contractAddress?.toLowerCase() || ''}-${
          activeNetwork.chainId
        }`;
        return (
          !importedAssetIds.has(tokenId) || recentlyImportedIds.has(tokenId)
        );
      });

      setOwnedTokens(filteredResults);
    } catch (error) {
      console.error('Error loading owned tokens:', error);
      setOwnedTokens([]);
    } finally {
      setIsLoadingOwned(false);
    }
  }, [
    activeAccount?.address,
    importedAssetIds,
    recentlyImportedIds,
    controllerEmitter,
    alert,
    t,
    activeNetwork.chainId,
  ]);

  // Load user's owned tokens - only once per account/network combination
  useEffect(() => {
    if (!activeAccount?.address) return;

    // Create a unique key for this account/network combination
    const currentKey = `${activeAccount.address}-${activeNetwork.chainId}`;

    // Only load if we haven't loaded for this specific combination
    if (loadingKeyRef.current !== currentKey) {
      loadingKeyRef.current = currentKey;
      loadOwnedTokens();
    }
  }, [activeAccount?.address, activeNetwork.chainId]);

  // Create debounced validation function
  useEffect(() => {
    const validateCustomToken = async (contractAddress: string) => {
      if (!contractAddress || contractAddress.length < 42) {
        setCustomTokenDetails(null);
        return;
      }

      setIsValidatingCustom(true);

      try {
        // For custom import, use enhanced validation that includes market data
        let details = await controllerEmitter(
          ['wallet', 'getTokenDetailsWithMarketData'],
          [contractAddress, activeAccount.address]
        ).catch(() => null);

        // If enhanced validation fails, try NFT validation
        if (!details) {
          details = await controllerEmitter(
            ['wallet', 'validateNftContract'],
            [contractAddress, activeAccount.address]
          ).catch(() => null);
        }

        // If NFT validation fails, try basic ERC-20
        if (!details) {
          details = await controllerEmitter(
            ['wallet', 'validateERC20Only'],
            [contractAddress, activeAccount.address]
          );
        }

        if (details) {
          setCustomTokenDetails(details as ITokenDetails);
        } else {
          throw new Error('Invalid contract');
        }
      } catch (error) {
        console.error('Validation error:', error);
        setCustomTokenDetails(null);
      } finally {
        setIsValidatingCustom(false);
      }
    };

    // Create debounced function
    debouncedValidationRef.current = debounce(validateCustomToken, 500);

    // Cleanup function to cancel any pending debounced calls
    return () => {
      if (debouncedValidationRef.current) {
        debouncedValidationRef.current.cancel();
        debouncedValidationRef.current = null;
      }
    };
  }, [
    activeAccount?.address,
    controllerEmitter,
    activeAccountAssets,
    activeNetwork.chainId,
    recentlyImportedIds,
  ]);

  // Handle custom contract input change
  useEffect(() => {
    if (deferredCustomAddress && debouncedValidationRef.current) {
      debouncedValidationRef.current(deferredCustomAddress.trim());
    } else if (!deferredCustomAddress) {
      setCustomTokenDetails(null);
    }
  }, [deferredCustomAddress]);

  // Convert token data to ImportableAsset format
  const convertToImportableAssets = useCallback(
    (tokens: (ITokenSearchResult | ITokenDetails)[]) =>
      tokens.map((token) => {
        const isSearchResult =
          'contractAddress' in token && !('chainId' in token && token.chainId);
        let imageUrl: string | undefined;

        if (typeof token.image === 'string') {
          imageUrl = token.image;
        } else if (token.image && typeof token.image === 'object') {
          const img = token.image as any;
          imageUrl = img.large || img.small || img.thumb;
        }

        const normalizedAddress = token.contractAddress.toLowerCase();
        const tokenStandard = isSearchResult
          ? (token as ITokenSearchResult).tokenStandard
          : (token as ITokenDetails).tokenStandard;
        const isNft = isSearchResult
          ? ['ERC-721', 'ERC-1155'].includes(tokenStandard || '') // For API results, derive from tokenStandard
          : (token as ITokenDetails).isNft || false; // For ITokenDetails, use the existing field
        return {
          id: `${normalizedAddress}-${activeNetwork.chainId}`, // Keep the contractAddress-chainId format
          symbol: token.symbol,
          name: token.name, // Keep names intact - they can have spaces
          balance: token.balance || 0,
          decimals: token.decimals,
          logo: imageUrl || PaliLogo, // Always provide a logo - fallback to Pali logo
          contractAddress: normalizedAddress,
          chainId: activeNetwork.chainId,
          tokenStandard,
          isNft,
          // Enhanced data will be fetched in asset details if needed
        };
      }),
    [activeNetwork.chainId]
  );

  // Handle import
  const handleImport = async (asset: any) => {
    setCurrentlyImporting(asset.id);

    try {
      let tokenLogo = asset.logo || PaliLogo;

      // If token doesn't have a logo or is using default Pali logo, try to fetch from CoinGecko
      if (!asset.logo || asset.logo === PaliLogo) {
        try {
          // Add to fetching logos set for UI feedback
          setFetchingLogos((prev) => new Set(prev).add(asset.id));

          console.log(
            `[ImportToken] Fetching CoinGecko data for token without logo: ${asset.contractAddress}`
          );

          const enhancedDetails = (await controllerEmitter(
            ['wallet', 'getOnlyMarketData'],
            [asset.contractAddress]
          )) as any;

          if (enhancedDetails?.image) {
            // Use CoinGecko image if available
            tokenLogo =
              enhancedDetails.image?.large ||
              enhancedDetails.image?.small ||
              enhancedDetails.image?.thumb ||
              enhancedDetails.image ||
              PaliLogo;

            console.log(
              `[ImportToken] Successfully fetched CoinGecko logo for ${asset.symbol}`
            );
          } else {
            console.log(
              `[ImportToken] No CoinGecko logo found for ${asset.symbol}, using default`
            );
          }
        } catch (logoError) {
          console.log(
            `[ImportToken] Failed to fetch CoinGecko logo for ${asset.symbol}:`,
            logoError
          );
          // Continue with default logo
        } finally {
          // Remove from fetching logos set
          setFetchingLogos((prev) => {
            const newSet = new Set(prev);
            newSet.delete(asset.id);
            return newSet;
          });
        }
      }

      const tokenToSave: ITokenEthProps = {
        tokenSymbol: asset.symbol.toUpperCase(),
        contractAddress: asset.contractAddress,
        decimals: asset.decimals || 18,
        isNft: asset.isNft || false,
        balance: asset.balance || 0,
        chainId: activeNetwork.chainId,
        name: asset.name || asset.symbol,
        logo: tokenLogo,
        tokenStandard: asset.tokenStandard || 'ERC-20',
      };

      await controllerEmitter(['wallet', 'saveTokenInfo'], [tokenToSave]);

      // Add to recently imported for immediate UI feedback - use the full ID format
      setRecentlyImportedIds((prev) => new Set(prev).add(asset.id));

      // Show success alert
      alert.success(
        t('tokens.hasBeenAddedToYourWallet', { token: asset.symbol })
      );
    } catch (error) {
      console.error('Import error:', error);
      alert.error(error.message || t('tokens.tokenNotAdded'));
    } finally {
      setCurrentlyImporting(null);
    }
  };

  // Update URL when tab changes
  const updateTabInUrl = (tab: string) => {
    const newParams = new URLSearchParams(searchParams);
    newParams.set('tab', tab);
    setSearchParams(newParams, { replace: true });
  };

  // Update tab when URL parameters change
  useEffect(() => {
    const tabParam = searchParams.get('tab');
    if (tabParam === 'custom') {
      setActiveTab('custom');
    } else if (tabParam === 'owned') {
      setActiveTab('owned');
    }
  }, [searchParams]);

  // Handle details click with navigation context
  const handleDetailsClick = (asset: any) => {
    // Prepare component state to preserve
    const state = {
      customContractAddress,
      customTokenDetails,
    };

    const returnContext = {
      ...createNavigationContext('/tokens/add', activeTab, state),
      // Include existing return context to make it recursive
      returnContext: location.state?.returnContext,
    };

    navigateWithContext(
      navigate,
      '/home/details',
      {
        ...asset,
        isImportPreview: true,
      },
      returnContext
    );
  };

  // Handle tab change
  const handleTabChange = (tab: 'owned' | 'custom') => {
    setActiveTab(tab);
    updateTabInUrl(tab);
    if (tab === 'custom') {
      setCustomContractAddress('');
      setCustomTokenDetails(null);
    }
  };

  // Prepare assets for the list
  const ownedAssetsForList = useMemo(
    () => convertToImportableAssets(ownedTokens),
    [ownedTokens, convertToImportableAssets]
  );

  const customAssetsForList = useMemo(
    () =>
      customTokenDetails ? convertToImportableAssets([customTokenDetails]) : [],
    [customTokenDetails, convertToImportableAssets]
  );

  return (
    <div className="flex flex-col h-full bg-bkg-3 text-brand-white font-poppins">
      {/* Tab Navigation */}
      <div className="h-10 relative flex items-end justify-center w-full bg-bkg-1 -mt-2">
        <button
          className={`w-[12.5rem] h-full px-4 font-medium text-base transition-all duration-300 ${
            activeTab === 'owned'
              ? 'bg-bkg-3 text-brand-white rounded-tr-[2rem]'
              : 'bg-bkg-1 text-brand-gray200 hover:text-brand-white'
          }`}
          type="button"
          onClick={() => handleTabChange('owned')}
        >
          {t('tokens.yourTokens')}
        </button>

        <button
          className={`w-[12.5rem] h-full px-4 font-medium text-base transition-all duration-300 ${
            activeTab === 'custom'
              ? 'bg-bkg-3 text-brand-white rounded-tl-[2rem]'
              : 'bg-bkg-1 text-brand-gray200 hover:text-brand-white'
          }`}
          type="button"
          onClick={() => handleTabChange('custom')}
        >
          {t('tokens.addCustomTab')}
        </button>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto remove-scrollbar px-4 py-4">
        {activeTab === 'owned' ? (
          <ImportableAssetsList
            assets={ownedAssetsForList}
            isLoading={isLoadingOwned}
            onImport={handleImport}
            onDetailsClick={handleDetailsClick}
            importedAssetIds={importedAssetIds}
            currentlyImporting={currentlyImporting}
            fetchingLogos={fetchingLogos}
            assetType="evm"
          />
        ) : (
          <div className="space-y-4">
            {/* Contract Address Input */}
            <div className="relative max-w-lg mx-auto">
              <input
                className="w-full h-12 px-6 pr-12 bg-brand-blue800 border border-bkg-white200/30 
                            rounded-full text-brand-white placeholder-brand-gray200/70 text-sm font-poppins
                            focus:border-brand-royalblue/50 focus:outline-none focus:ring-2 focus:ring-brand-royalblue/20
                            transition-all duration-200"
                placeholder={t('tokens.enterContractAddress')}
                value={customContractAddress}
                onChange={(e) => setCustomContractAddress(e.target.value)}
              />
              <div className="absolute right-4 top-1/2 transform -translate-y-1/2 flex items-center justify-center w-6 h-6">
                {isValidatingCustom ? (
                  <LoadingOutlined className="text-brand-royalblue animate-spin text-base" />
                ) : customTokenDetails && customContractAddress ? (
                  <CheckCircleOutlined className="text-warning-success text-base" />
                ) : customContractAddress &&
                  !customTokenDetails &&
                  !isValidatingCustom ? (
                  <CloseCircleOutlined className="text-warning-error text-base" />
                ) : null}
              </div>
            </div>

            {/* Custom token details */}
            {customTokenDetails && (
              <ImportableAssetsList
                assets={customAssetsForList}
                isLoading={false}
                onImport={handleImport}
                onDetailsClick={handleDetailsClick}
                importedAssetIds={importedAssetIds}
                currentlyImporting={currentlyImporting}
                fetchingLogos={fetchingLogos}
                assetType="evm"
              />
            )}

            {/* Empty state for custom tab */}
            {!customContractAddress && !customTokenDetails && (
              <div className="text-center py-12">
                <div className="relative inline-block mb-4">
                  <div className="absolute inset-0 bg-brand-royalblue/20 blur-3xl rounded-full"></div>
                  <div className="relative w-16 h-16 mx-auto bg-bkg-2 rounded-full flex items-center justify-center">
                    <TbFileImport
                      size={32}
                      className="text-brand-royalblue hover:text-brand-royalbluemedium transition-colors duration-200"
                    />
                  </div>
                </div>
                <h3 className="text-brand-white font-rubik font-medium text-lg mb-1">
                  {t('tokens.addCustomToken')}
                </h3>
                <p className="text-brand-gray200 text-sm font-poppins max-w-xs mx-auto">
                  {t('tokens.enterContractToImport')}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ImportToken;
