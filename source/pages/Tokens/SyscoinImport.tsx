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

import { ImportableAssetsList } from 'components/index';
import { useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { ISysTokensAssetReponse } from 'scripts/Background/controllers/assets/types';
import { RootState } from 'state/store';
import { ITokenSysProps } from 'types/tokens';
import { getTokenLogo } from 'utils/tokens';

export const SyscoinImport: React.FC = () => {
  const { controllerEmitter } = useController();
  const { navigate, alert } = useUtils();
  const { t } = useTranslation();

  // Tab state - two tabs
  const [activeTab, setActiveTab] = useState<'owned' | 'custom'>('owned');

  // PATH 1: Your Tokens state
  const [ownedTokens, setOwnedTokens] = useState<ISysTokensAssetReponse[]>([]);
  const [isLoadingOwned, setIsLoadingOwned] = useState(false);

  // PATH 2: Custom Token state
  const [customAssetGuid, setCustomAssetGuid] = useState('');
  const [customTokenDetails, setCustomTokenDetails] =
    useState<ITokenSysProps | null>(null);
  const [isValidatingCustom, setIsValidatingCustom] = useState(false);

  // Common state
  const [currentlyImporting, setCurrentlyImporting] = useState<string | null>(
    null
  );
  const [recentlyImportedGuids, setRecentlyImportedGuids] = useState<
    Set<string>
  >(new Set());

  const {
    accounts,
    activeAccount: activeAccountMeta,
    activeNetwork,
    accountAssets,
  } = useSelector((state: RootState) => state.vault);
  const activeAccount = accounts[activeAccountMeta.type][activeAccountMeta.id];
  const activeAccountAssets =
    accountAssets[activeAccountMeta.type]?.[activeAccountMeta.id];

  // Use deferred value for search optimization
  const deferredCustomGuid = useDeferredValue(customAssetGuid);

  // Refs for stable debounce
  const debouncedValidationRef = useRef<ReturnType<typeof debounce> | null>(
    null
  );
  const loadingKeyRef = useRef<string>('');

  // Calculate imported asset GUIDs for efficient lookup
  const importedAssetGuids = useMemo(() => {
    const guids = new Set<string>();
    if (activeAccountAssets?.syscoin) {
      activeAccountAssets.syscoin
        .filter((token) => token.chainId === activeNetwork.chainId)
        .forEach((token) => {
          if (token.assetGuid) {
            guids.add(token.assetGuid);
          }
        });
    }
    // Also add recently imported GUIDs
    recentlyImportedGuids.forEach((guid) => guids.add(guid));
    return guids;
  }, [
    activeAccountAssets?.syscoin,
    activeNetwork.chainId,
    recentlyImportedGuids,
  ]);

  // PATH 1: Load tokens user actually owns
  const loadOwnedTokens = useCallback(async () => {
    if (!activeAccount?.xpub) return;

    setIsLoadingOwned(true);
    try {
      const results = (await controllerEmitter(
        ['wallet', 'getUserOwnedTokens'],
        [activeAccount.address]
      )) as ISysTokensAssetReponse[];

      // Filter out already imported tokens BUT keep recently imported ones for UI consistency
      const filteredResults =
        results?.filter(
          (token) =>
            !importedAssetGuids.has(token.assetGuid) ||
            recentlyImportedGuids.has(token.assetGuid)
        ) || [];

      setOwnedTokens(filteredResults);
    } catch (error) {
      console.error('Error loading owned tokens:', error);
      setOwnedTokens([]);
    } finally {
      setIsLoadingOwned(false);
    }
  }, [
    activeAccount?.address,
    importedAssetGuids,
    recentlyImportedGuids,
    controllerEmitter,
    alert,
    t,
  ]);

  // Load user's owned tokens - only once per account/network combination
  useEffect(() => {
    if (!activeAccount?.xpub) return;

    // Create a unique key for this account/network combination
    const currentKey = `${activeAccount.xpub}-${activeNetwork.chainId}`;

    // Only load if we haven't loaded for this specific combination
    if (loadingKeyRef.current !== currentKey) {
      loadingKeyRef.current = currentKey;
      loadOwnedTokens();
    }
  }, [activeAccount?.xpub, activeNetwork.chainId]);

  // Create debounced validation function
  useEffect(() => {
    const validateCustomToken = async (assetGuid: string) => {
      // Validate assetGuid format - must be only digits (same as backend validation)
      if (!assetGuid || !/^\d+$/.test(assetGuid)) {
        setCustomTokenDetails(null);
        return;
      }

      setIsValidatingCustom(true);

      try {
        const details = (await controllerEmitter(
          ['wallet', 'validateSPTOnly'],
          [assetGuid, activeAccount.xpub]
        )) as ITokenSysProps | null;

        if (details) {
          setCustomTokenDetails(details);
        } else {
          throw new Error('Asset not found');
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
    activeAccount?.xpub,
    controllerEmitter,
    activeAccountAssets,
    activeNetwork.chainId,
    recentlyImportedGuids,
  ]);

  // Handle custom asset input change
  useEffect(() => {
    if (deferredCustomGuid && debouncedValidationRef.current) {
      debouncedValidationRef.current(deferredCustomGuid.trim());
    } else if (!deferredCustomGuid) {
      setCustomTokenDetails(null);
    }
  }, [deferredCustomGuid]);

  // Convert token data to ImportableAsset format
  const convertToImportableAssets = useCallback(
    (tokens: (ISysTokensAssetReponse | ITokenSysProps)[]) =>
      tokens.map((token) => ({
        id: token.assetGuid || '',
        symbol: token.symbol || '',
        name: token.name || token.symbol || '',
        balance: token.balance || 0,
        decimals: token.decimals || 8,
        logo: getTokenLogo(token.symbol || ''),
        assetGuid: token.assetGuid || '',
        type: token.type || 'SPTAllocated',
      })),
    []
  );

  // Handle import
  const handleImport = async (asset: any) => {
    setCurrentlyImporting(asset.id);

    try {
      // Get token logo URL for known tokens
      const tokenLogo = getTokenLogo(asset.symbol);

      // Convert to ITokenSysProps format for vault storage
      const tokenToSave: ITokenSysProps = {
        assetGuid: asset.assetGuid,
        symbol: asset.symbol,
        name: asset.name || asset.symbol,
        decimals: asset.decimals,
        balance: asset.balance,
        chainId: asset.chainId || activeNetwork.chainId,
        type: asset.type || 'SPTAllocated',
        // Store image URL only for known tokens
        ...(tokenLogo && { image: tokenLogo }),
      };

      await controllerEmitter(['wallet', 'saveTokenInfo'], [tokenToSave]);

      // Add to recently imported for immediate UI feedback
      setRecentlyImportedGuids((prev) => new Set(prev).add(asset.assetGuid));

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

  // Handle details click
  const handleDetailsClick = (asset: any) => {
    navigate('/home/details', {
      state: {
        ...asset,
        isImportPreview: true,
      },
    });
  };

  // Handle tab change
  const handleTabChange = (tab: 'owned' | 'custom') => {
    setActiveTab(tab);
    if (tab === 'custom') {
      setCustomAssetGuid('');
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
      <div className="flex-1 overflow-y-auto scrollbar-styled px-4 py-4">
        {activeTab === 'owned' ? (
          <ImportableAssetsList
            assets={ownedAssetsForList}
            isLoading={isLoadingOwned}
            onImport={handleImport}
            onDetailsClick={handleDetailsClick}
            importedAssetIds={importedAssetGuids}
            currentlyImporting={currentlyImporting}
            assetType="utxo"
          />
        ) : (
          <div className="space-y-4">
            {/* Asset GUID Input */}
            <div className="relative max-w-lg mx-auto">
              <input
                className="w-full h-12 px-6 pr-12 bg-brand-blue800 border border-bkg-white200/30 
                          rounded-full text-brand-white placeholder-brand-gray200/70 text-sm font-poppins
                          focus:border-brand-royalblue/50 focus:outline-none focus:ring-2 focus:ring-brand-royalblue/20
                          transition-all duration-200"
                placeholder={t('tokens.enterAssetGuid')}
                value={customAssetGuid}
                onChange={(e) => setCustomAssetGuid(e.target.value)}
              />
              <div className="absolute right-4 top-1/2 transform -translate-y-1/2 flex items-center justify-center w-6 h-6">
                {isValidatingCustom ? (
                  <LoadingOutlined className="text-brand-royalblue animate-spin text-base" />
                ) : customTokenDetails && customAssetGuid ? (
                  <CheckCircleOutlined className="text-warning-success text-base" />
                ) : customAssetGuid &&
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
                importedAssetIds={importedAssetGuids}
                currentlyImporting={currentlyImporting}
                assetType="utxo"
              />
            )}

            {/* Empty state for custom tab */}
            {!customAssetGuid && !customTokenDetails && (
              <div className="text-center py-12">
                <div className="relative inline-block mb-4">
                  <div className="absolute inset-0 bg-brand-royalblue/20 blur-3xl rounded-full"></div>
                  <div className="relative w-16 h-16 mx-auto bg-bkg-2 rounded-full flex items-center justify-center">
                    <TbFileImport size={32} className="text-brand-royalblue" />
                  </div>
                </div>
                <h3 className="text-brand-white font-rubik font-medium text-lg mb-1">
                  {t('tokens.addCustomToken')}
                </h3>
                <p className="text-brand-gray200 text-sm font-poppins max-w-xs mx-auto">
                  {t('tokens.enterAssetGuidToImport')}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default SyscoinImport;
