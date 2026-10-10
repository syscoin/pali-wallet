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
import { useSelector } from 'react-redux';
import { useSearchParams, useLocation } from 'react-router-dom';

import { getHomeBrowsingScope } from '../Home/useHomeBrowsingState';
import PaliLogo from 'assets/all_assets/favicon-32.png';
import {
  FiDownload,
  LoadingOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
} from 'components/Icon/Icon';
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
  createBrowsingNavigationContext,
  navigateWithContext,
} from 'utils/navigationState';

import { useTokenImportNavigation } from './useTokenImportNavigation';

export const ImportToken: React.FC = () => {
  const { controllerEmitter } = useController();
  const { navigate, alert } = useUtils();
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  const {
    accounts,
    activeAccount: activeAccountMeta,
    activeNetwork,
    accountAssets,
  } = useSelector((state: RootState) => state.vault);
  const activeAccount = accounts[activeAccountMeta.type][activeAccountMeta.id];
  const tokenImportScope = getHomeBrowsingScope(
    { ...activeAccount, ...activeAccountMeta },
    activeNetwork,
    false
  );
  const restoredState =
    location.state?.tokenImportScope === tokenImportScope
      ? location.state
      : undefined;

  // Tab state - get initial from URL params or location state
  const getInitialTab = () => {
    const tabValue = getCurrentTab(searchParams, location.state, 'owned');
    return tabValue as 'owned' | 'custom';
  };

  const [requestedTab, setRequestedTab] = useState<'owned' | 'custom'>(
    getInitialTab()
  );

  // PATH 1: Your Tokens state
  const [ownedTokens, setOwnedTokens] = useState<ITokenSearchResult[]>([]);
  const [isLoadingOwned, setIsLoadingOwned] = useState(false);
  const [ownedTokensUnavailable, setOwnedTokensUnavailable] = useState(false);

  // PATH 2: Custom Token state - restore from navigation state if available
  const [customContractAddress, setCustomContractAddress] = useState(
    restoredState?.customContractAddress || ''
  );
  const [customTokenDetails, setCustomTokenDetails] =
    useState<ITokenDetails | null>(restoredState?.customTokenDetails || null);
  const [isValidatingCustom, setIsValidatingCustom] = useState(false);
  const [customTokenId, setCustomTokenId] = useState(
    restoredState?.customTokenId || ''
  );
  useTokenImportNavigation(tokenImportScope, {
    customContractAddress,
    customTokenId,
  });
  const [isVerifyingTokenId, setIsVerifyingTokenId] = useState(false);
  const [verifiedTokenBalance, setVerifiedTokenBalance] = useState<
    number | null
  >(null);
  const [verifiedTokenRawBalance, setVerifiedTokenRawBalance] = useState<
    string | null
  >(null);

  // Common state
  const [currentlyImporting, setCurrentlyImporting] = useState<string | null>(
    null
  );
  const [fetchingLogos, setFetchingLogos] = useState<Set<string>>(new Set());

  const activeAccountAssets =
    accountAssets?.[activeAccountMeta.type]?.[activeAccountMeta.id];

  // Keep the URL preference, but always show manual import without discovery.
  const activeTab = activeNetwork.apiUrl ? requestedTab : 'custom';
  const language = (i18n.resolvedLanguage || i18n.language || 'en')
    .toLowerCase()
    .split('-')[0];
  const docsLocale = ['es', 'pt', 'fr', 'de', 'ru', 'zh', 'ja', 'ko'].includes(
    language
  )
    ? `/${language}`
    : '';
  const importHelpUrl = `https://docs.paliwallet.com${docsLocale}/docs/users/token-discovery-and-explorer-apis`;

  // Use deferred value for search optimization
  const deferredCustomAddress = useDeferredValue(customContractAddress);
  const deferredTokenId = useDeferredValue(customTokenId);

  // Refs for stable debounce
  const debouncedValidationRef = useRef<ReturnType<typeof debounce> | null>(
    null
  );
  const loadingKeyRef = useRef<string>('');
  const ownedRequestIdRef = useRef(0);

  // Calculate imported asset IDs for efficient lookup - must match the token ID format
  const importedAssetIds = useMemo(() => {
    const ids = new Set<string>();
    if (activeAccountAssets?.ethereum) {
      activeAccountAssets.ethereum
        .filter((token) => token.chainId === activeNetwork.chainId)
        .forEach((token) => {
          // For ERC-1155 tokens, include tokenId in the ID format to allow different tokenIds from same contract
          if (token.tokenStandard === 'ERC-1155' && token.tokenId) {
            ids.add(
              `${token.contractAddress.toLowerCase()}-${token.chainId}-${
                token.tokenId
              }`
            );
          } else {
            // Use the standard format for non-ERC-1155 tokens: contractAddress-chainId
            ids.add(`${token.contractAddress.toLowerCase()}-${token.chainId}`);
          }
        });
    }
    return ids;
  }, [activeAccountAssets?.ethereum, activeNetwork.chainId]);

  // PATH 1: Load tokens user actually owns
  const loadOwnedTokens = useCallback(async () => {
    if (!activeAccount?.address || !activeNetwork.apiUrl) return;

    const requestKey = `${activeAccount.address}-${activeNetwork.chainId}-${activeNetwork.apiUrl}`;
    const requestId = ++ownedRequestIdRef.current;
    const isCurrent = () =>
      loadingKeyRef.current === requestKey &&
      ownedRequestIdRef.current === requestId;
    setIsLoadingOwned(true);
    setOwnedTokensUnavailable(false);
    try {
      const results = (await controllerEmitter(
        ['wallet', 'getUserOwnedTokens'],
        [activeAccount.address]
      )) as ITokenSearchResult[];
      // Filter out already imported tokens
      const filteredResults = results.filter((token) => {
        // Match the ID format used in getUserOwnedTokens
        const tokenId = token.id; // Use the ID directly from the API response
        return !importedAssetIds.has(tokenId);
      });

      if (isCurrent()) setOwnedTokens(filteredResults);
    } catch (error) {
      console.error('Error loading owned tokens:', error);
      if (isCurrent()) {
        setOwnedTokensUnavailable(true);
      }
    } finally {
      if (isCurrent()) setIsLoadingOwned(false);
    }
  }, [
    activeAccount?.address,
    importedAssetIds,
    alert,
    t,
    activeNetwork.chainId,
    activeNetwork.apiUrl,
  ]);

  // Load user's owned tokens - only once per account/network combination
  useEffect(() => {
    if (!activeAccount?.address || !activeNetwork.apiUrl) return;

    // Create a unique key for this account/network combination
    const currentKey = `${activeAccount.address}-${activeNetwork.chainId}-${activeNetwork.apiUrl}`;

    // Only load if we haven't loaded for this specific combination
    if (loadingKeyRef.current !== currentKey) {
      loadingKeyRef.current = currentKey;
      setOwnedTokens([]);
      loadOwnedTokens();
    }
    return () => {
      ownedRequestIdRef.current += 1;
      loadingKeyRef.current = '';
    };
  }, [activeAccount?.address, activeNetwork.chainId, activeNetwork.apiUrl]);

  // Create debounced validation function
  useEffect(() => {
    let current = true;
    const validateCustomToken = async (contractAddress: string) => {
      if (!contractAddress || contractAddress.length < 42) {
        // SYSCOIN: A cancelled validation cannot clear this input's spinner.
        setIsValidatingCustom(false);
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
        if (!current) return;
        if (!details) {
          details = await controllerEmitter(
            ['wallet', 'validateNftContract'],
            [contractAddress, activeAccount.address]
          ).catch(() => null);
        }

        // If NFT validation fails, try basic ERC-20
        if (!current) return;
        if (!details) {
          details = await controllerEmitter(
            ['wallet', 'validateERC20Only'],
            [contractAddress, activeAccount.address]
          );
        }

        if (!current) return;
        if (details) {
          setCustomTokenDetails(details as ITokenDetails);
        } else {
          throw new Error('Invalid contract');
        }
      } catch (error) {
        console.error('Validation error:', error);
        if (current) setCustomTokenDetails(null);
      } finally {
        if (current) setIsValidatingCustom(false);
      }
    };

    // Create debounced function
    debouncedValidationRef.current = debounce(validateCustomToken, 500);

    // Cleanup function to cancel any pending debounced calls
    return () => {
      // SYSCOIN: Cancellation must also reject already-running async results.
      current = false;
      if (debouncedValidationRef.current) {
        debouncedValidationRef.current.cancel();
        debouncedValidationRef.current = null;
      }
    };
  }, [activeAccount?.address, activeNetwork.chainId, deferredCustomAddress]);

  // Handle custom contract input change
  useEffect(() => {
    if (deferredCustomAddress && debouncedValidationRef.current) {
      debouncedValidationRef.current(deferredCustomAddress.trim());
    } else if (!deferredCustomAddress) {
      setCustomTokenDetails(null);
      setIsValidatingCustom(false);
    }
  }, [deferredCustomAddress, activeAccount?.address, activeNetwork.chainId]);

  // Verify ERC1155 token ID balance
  const verifyERC1155TokenId = useCallback(
    async (tokenId: string) => {
      if (!customTokenDetails || !activeAccount.address || !tokenId.trim()) {
        setVerifiedTokenBalance(null);
        setVerifiedTokenRawBalance(null);
        return;
      }

      if (customTokenDetails.tokenStandard !== 'ERC-1155') {
        return;
      }

      setIsVerifyingTokenId(true);

      try {
        const result = (await controllerEmitter(
          ['wallet', 'verifyERC1155Ownership'],
          [customTokenDetails.contractAddress, activeAccount.address, [tokenId]]
        )) as {
          balance: number;
          rawBalance?: string;
          tokenId: string;
          verified: boolean;
        }[];

        if (result && result.length > 0) {
          const tokenInfo = result[0];
          if (tokenInfo.verified) {
            // Token ID format is valid - set balance even if it's 0
            setVerifiedTokenBalance(tokenInfo.balance);
            setVerifiedTokenRawBalance(tokenInfo.rawBalance ?? null);
          } else {
            // Token ID format is invalid or contract call failed
            setVerifiedTokenBalance(-1);
            setVerifiedTokenRawBalance(null);
          }
        } else {
          // No result - set to -1
          setVerifiedTokenBalance(-1);
          setVerifiedTokenRawBalance(null);
        }
      } catch (error) {
        console.error('Error verifying token ID:', error);
        // Set to -1 to indicate error/invalid tokenId
        setVerifiedTokenBalance(-1);
        setVerifiedTokenRawBalance(null);
      } finally {
        setIsVerifyingTokenId(false);
      }
    },
    [customTokenDetails, activeAccount.address]
  );

  // Verify token ID when it changes
  useEffect(() => {
    if (customTokenDetails?.tokenStandard === 'ERC-1155' && deferredTokenId) {
      verifyERC1155TokenId(deferredTokenId);
    }
  }, [customTokenDetails, deferredTokenId, verifyERC1155TokenId]);

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
        // Generate appropriate ID format based on token standard
        const baseId = `${normalizedAddress}-${activeNetwork.chainId}`;
        const tokenId = isSearchResult
          ? (token as ITokenSearchResult).tokenId
          : (token as any).tokenId; // For custom tokens, tokenId is added dynamically
        const id =
          tokenStandard === 'ERC-1155' && tokenId
            ? `${baseId}-${tokenId}`
            : baseId;

        return {
          id,
          symbol: token.symbol,
          name: token.name, // Keep names intact - they can have spaces
          balance: token.balance || 0,
          decimals: token.decimals,
          logo: imageUrl || PaliLogo, // Always provide a logo - fallback to Pali logo
          contractAddress: normalizedAddress,
          chainId: activeNetwork.chainId,
          tokenStandard,
          isNft,
          // Preserve tokenId for ERC-1155 tokens from search results or details
          ...(tokenId && { tokenId }),
          // Enhanced data will be fetched in asset details if needed
        };
      }),
    [activeNetwork.chainId]
  );

  // Handle import
  const handleImport = useCallback(
    async (asset: any) => {
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

        // For ERC1155, require tokenId and use verified balance
        // For owned tokens, tokenId comes from asset. For custom tokens, it comes from customTokenId
        const tokenId = activeTab === 'custom' ? customTokenId : asset.tokenId;

        if (asset.tokenStandard === 'ERC-1155' && !tokenId) {
          alert.error(t('tokens.tokenIdRequired'));
          setCurrentlyImporting(null);
          return;
        }

        // For custom ERC-1155 tokens, check if tokenId format is valid
        if (
          asset.tokenStandard === 'ERC-1155' &&
          activeTab === 'custom' &&
          verifiedTokenBalance === -1
        ) {
          alert.error(t('send.invalidTokenId'));
          setCurrentlyImporting(null);
          return;
        }

        // Allow adding ERC-1155 tokens even with 0 balance (but not invalid ones)

        const tokenToSave: ITokenEthProps = {
          tokenSymbol: asset.symbol.toUpperCase(),
          contractAddress: asset.contractAddress,
          decimals: Number(asset.decimals ?? 18),
          isNft:
            asset.isNft ??
            ['ERC-721', 'ERC-1155'].includes(asset.tokenStandard || 'ERC-20'),
          balance:
            asset.tokenStandard === 'ERC-1155' && activeTab === 'custom'
              ? verifiedTokenBalance ?? 0 // Use verified balance for custom ERC-1155 tokens
              : asset.balance || 0, // Use asset balance for owned tokens or non-ERC-1155
          chainId: activeNetwork.chainId,
          name: asset.name || asset.symbol,
          logo: tokenLogo,
          tokenStandard: asset.tokenStandard || 'ERC-20',
          ...(asset.tokenStandard === 'ERC-1155' && tokenId ? { tokenId } : {}),
          ...(asset.tokenStandard === 'ERC-1155' &&
          activeTab === 'custom' &&
          verifiedTokenRawBalance
            ? { rawBalance: verifiedTokenRawBalance }
            : {}),
        };

        await controllerEmitter(['wallet', 'saveTokenInfo'], [tokenToSave]);

        // Show success alert
        alert.success(
          t('tokens.hasBeenAddedToYourWallet', { token: asset.symbol })
        );
      } catch (error: any) {
        console.error('Import error:', error);
        alert.error(error.message || t('tokens.tokenNotAdded'));
      } finally {
        setCurrentlyImporting(null);
      }
    },
    [
      activeTab,
      activeNetwork.chainId,
      t,
      alert,
      customTokenId,
      verifiedTokenBalance,
      verifiedTokenRawBalance,
      currentlyImporting,
    ]
  );

  // Update URL when tab changes
  const updateTabInUrl = (tab: string) => {
    const newParams = new URLSearchParams(searchParams);
    newParams.set('tab', tab);
    setSearchParams(newParams, { replace: true, state: location.state });
  };

  // Update tab when URL parameters change
  useEffect(() => {
    const tabParam = searchParams.get('tab');
    if (tabParam === 'custom') {
      setRequestedTab('custom');
    } else if (tabParam === 'owned') {
      setRequestedTab('owned');
    }
  }, [searchParams]);

  // Handle details click with navigation context
  const handleDetailsClick = useCallback(
    (asset: any) => {
      // Prepare component state to preserve
      const state = {
        customContractAddress,
        customTokenId,
        tokenImportScope,
      };

      const returnContext = createBrowsingNavigationContext(location, {
        ...state,
        tab: activeTab,
      });

      navigateWithContext(
        navigate,
        '/home/details',
        {
          ...asset,
          isImportPreview: true,
        },
        returnContext
      );
    },
    [
      activeTab,
      customContractAddress,
      customTokenId,
      tokenImportScope,
      location,
      navigate,
    ]
  );

  // Handle tab change
  const handleTabChange = (tab: 'owned' | 'custom') => {
    setRequestedTab(tab);
    updateTabInUrl(tab);
    if (tab === 'custom') {
      setCustomContractAddress('');
      setCustomTokenDetails(null);
      setCustomTokenId('');
      setVerifiedTokenBalance(null);
    }
  };

  // Prepare assets for the list
  const ownedAssetsForList = useMemo(
    () => convertToImportableAssets(ownedTokens),
    [ownedTokens, convertToImportableAssets]
  );

  const customAssetsForList = useMemo(() => {
    if (!customTokenDetails) return [];

    // For ERC-1155, don't show tokens with invalid tokenId formats
    if (
      customTokenDetails.tokenStandard === 'ERC-1155' &&
      verifiedTokenBalance === -1
    ) {
      return [];
    }

    // For ERC-1155, use verified balance and tokenId if available
    const tokenWithCorrectBalance =
      customTokenDetails.tokenStandard === 'ERC-1155' &&
      verifiedTokenBalance !== null
        ? {
            ...customTokenDetails,
            balance: verifiedTokenBalance,
            ...(customTokenId && { tokenId: customTokenId }),
          }
        : customTokenDetails;

    return convertToImportableAssets([tokenWithCorrectBalance]);
  }, [
    customTokenDetails,
    convertToImportableAssets,
    verifiedTokenBalance,
    customTokenId,
  ]);

  return (
    <div className="flex flex-col h-full bg-bkg-3 text-brand-white font-poppins">
      {/* Tab Navigation */}
      {activeNetwork.apiUrl && (
        <div className="h-10 relative flex items-end justify-center w-full bg-bkg-1 -mt-2">
          <button
            className={`w-[12.5rem] h-full px-4 font-medium text-base transition-all duration-300 ${
              activeTab === 'owned'
                ? 'bg-bkg-3 text-brand-white rounded-tr-[2rem]'
                : 'bg-bkg-1 text-brand-gray200 hover:text-brand-white'
            }`}
            type="button"
            aria-pressed={activeTab === 'owned'}
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
            aria-pressed={activeTab === 'custom'}
            onClick={() => handleTabChange('custom')}
          >
            {t('tokens.addCustomTab')}
          </button>
        </div>
      )}

      {/* Content Area */}
      <div
        data-navigation-scroll="token-import"
        className="flex-1 overflow-y-auto remove-scrollbar px-4 py-4"
      >
        {activeTab === 'owned' && ownedTokensUnavailable ? (
          <div role="alert">
            <p>{t('settings.apiConnectionError')}</p>
            {/* SYSCOIN: Retry only on user action; the API cooldown still applies. */}
            <button
              className="mt-2 text-brand-royalblue underline"
              onClick={loadOwnedTokens}
              type="button"
            >
              {t('receive.retry')}
            </button>
          </div>
        ) : activeTab === 'owned' &&
          !isLoadingOwned &&
          ownedAssetsForList.length === 0 ? (
          <div className="flex flex-col items-center text-center px-4 py-12">
            <div className="w-16 h-16 mb-4 bg-bkg-2 rounded-full flex items-center justify-center">
              <FiDownload size={32} className="text-brand-royalblue" />
            </div>
            <h3 className="text-brand-white font-rubik font-medium text-lg mb-2">
              {t('tokens.noAdditionalTokensFound')}
            </h3>
            <p className="text-brand-gray200 text-sm max-w-xs mb-5">
              {t('tokens.missingTokenManualImport')}
            </p>
            <button
              className="h-10 px-6 rounded-full bg-brand-royalblue text-brand-white text-sm font-medium hover:bg-brand-royalbluemedium transition-colors"
              type="button"
              onClick={() => handleTabChange('custom')}
            >
              {t('tokens.addCustomTab')}
            </button>
          </div>
        ) : activeTab === 'owned' ? (
          <ImportableAssetsList
            key={`owned-${currentlyImporting || 'none'}`}
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
              <label
                className="block mb-2 text-sm font-medium text-brand-white"
                htmlFor="custom-token-contract"
              >
                {t('settings.contractAddress')}
              </label>
              <div className="relative">
                <input
                  id="custom-token-contract"
                  className="w-full h-12 px-6 pr-12 bg-brand-blue800 border border-bkg-white200/30
                            rounded-full text-brand-white placeholder-brand-gray200/70 text-sm font-poppins
                            focus:border-brand-royalblue/50 focus:outline-none focus:ring-2 focus:ring-brand-royalblue/20
                            transition-all duration-200"
                  placeholder={t('tokens.enterContractAddress')}
                  value={customContractAddress}
                  onChange={(e) => {
                    setCustomContractAddress(e.target.value);
                    setCustomTokenDetails(null);
                    setCustomTokenId('');
                    setVerifiedTokenBalance(null);
                    setVerifiedTokenRawBalance(null);
                  }}
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
              {!activeNetwork.apiUrl && (
                <div className="mt-3 text-xs text-brand-gray200 leading-relaxed">
                  <p>{t('tokens.discoveryUnavailable')}</p>
                  <a
                    className="inline-block mt-1 text-brand-royalbluemedium underline hover:text-brand-white"
                    href={importHelpUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t('tokens.importHelp')}
                  </a>
                </div>
              )}
            </div>

            {/* Token ID Input for ERC-1155 */}
            {customTokenDetails?.tokenStandard === 'ERC-1155' && (
              <div className="relative max-w-lg mx-auto">
                <label
                  className="block mb-2 text-sm font-medium text-brand-white"
                  htmlFor="custom-token-id"
                >
                  {t('send.tokenId')}
                </label>
                <div className="relative">
                  <input
                    id="custom-token-id"
                    className="w-full h-12 px-6 pr-14 bg-brand-blue800 border border-bkg-white200/30
                              rounded-full text-brand-white placeholder-brand-gray200/70 text-sm font-poppins
                              focus:border-brand-royalblue/50 focus:outline-none focus:ring-2 focus:ring-brand-royalblue/20
                              transition-all duration-200"
                    placeholder={t('send.enterTokenId')}
                    value={customTokenId}
                    onChange={(e) => setCustomTokenId(e.target.value)}
                  />
                  <div className="absolute right-5 top-1/2 transform -translate-y-1/2 flex items-center justify-center w-5 h-5">
                    {isVerifyingTokenId ? (
                      <LoadingOutlined className="text-brand-royalblue animate-spin text-sm" />
                    ) : verifiedTokenBalance !== null && customTokenId ? (
                      verifiedTokenBalance >= 0 ? (
                        <CheckCircleOutlined
                          className={
                            verifiedTokenBalance === 0
                              ? 'text-brand-gray200 text-sm'
                              : 'text-warning-success text-sm'
                          }
                          title={
                            verifiedTokenBalance === 0
                              ? `${t('tokens.balanceForTokenId', {
                                  balance: 0,
                                })} ${t('tokens.verifyTokenExists')}`
                              : t('tokens.balanceForTokenId', {
                                  balance: verifiedTokenBalance,
                                })
                          }
                        />
                      ) : (
                        <CloseCircleOutlined
                          className="text-warning-error text-sm"
                          title="Invalid token ID format"
                        />
                      )
                    ) : null}
                  </div>
                </div>
              </div>
            )}
            {customTokenDetails?.tokenStandard === 'ERC-1155' &&
              customTokenId &&
              verifiedTokenBalance === 0 && (
                <p className="text-xs text-brand-gray200 mt-1 px-5">
                  {t('tokens.erc1155ZeroBalanceNote')}
                </p>
              )}

            {/* Custom token details */}
            {customTokenDetails && (
              <ImportableAssetsList
                key={`custom-${currentlyImporting || 'none'}`}
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
          </div>
        )}
      </div>
    </div>
  );
};

export default ImportToken;
