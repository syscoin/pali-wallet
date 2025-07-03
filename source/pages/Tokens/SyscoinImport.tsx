import { LoadingOutlined } from '@ant-design/icons';
import { debounce } from 'lodash';
import React, { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { DefaultModal, Icon } from 'components/index';
import { useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { ISysTokensAssetReponse } from 'scripts/Background/controllers/assets/types';
import { RootState } from 'state/store';
import { ITokenSysProps } from 'types/tokens';
import { truncate } from 'utils/index';
import { getTokenLogo, getTokenTypeBadgeColor } from 'utils/tokens';

export const SyscoinImport: React.FC = () => {
  const { controllerEmitter } = useController();
  const { navigate, alert } = useUtils();
  const { t } = useTranslation();

  // Tab state
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
  const [selectedToken, setSelectedToken] = useState<
    ISysTokensAssetReponse | ITokenSysProps | null
  >(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importSuccess, setImportSuccess] = useState(false);

  const {
    accounts,
    activeAccount: activeAccountMeta,
    activeNetwork,
    accountAssets,
  } = useSelector((state: RootState) => state.vault);
  const activeAccount = accounts[activeAccountMeta.type][activeAccountMeta.id];
  const activeAccountAssets =
    accountAssets[activeAccountMeta.type][activeAccountMeta.id];

  // Load user's owned tokens on component mount
  useEffect(() => {
    if (activeTab === 'owned' && activeAccount?.xpub) {
      loadOwnedTokens();
    }
  }, [activeTab, activeAccount?.xpub, activeAccountAssets?.syscoin]);

  // PATH 1: Load tokens user actually owns
  const loadOwnedTokens = async () => {
    if (!activeAccount?.xpub) return;

    setIsLoadingOwned(true);
    try {
      console.log('[SyscoinImport] Loading user owned tokens');

      const results = (await controllerEmitter(
        ['wallet', 'getUserOwnedTokens'],
        [activeAccount.address]
      )) as ISysTokensAssetReponse[];

      console.log(`[SyscoinImport] Found ${results?.length || 0} owned tokens`);

      // Filter out already imported tokens
      if (results && results.length > 0 && activeAccountAssets?.syscoin) {
        const importedGuids = new Set(
          activeAccountAssets.syscoin.map(
            (token: ITokenSysProps) => token.assetGuid
          )
        );

        const filteredResults = results.filter(
          (token) => !importedGuids.has(token.assetGuid)
        );

        console.log(
          `[SyscoinImport] Filtered out ${
            results.length - filteredResults.length
          } already imported tokens`
        );

        setOwnedTokens(filteredResults);
      } else {
        setOwnedTokens(results || []);
      }
    } catch (error) {
      console.error('Error loading owned tokens:', error);
      setOwnedTokens([]);
    } finally {
      setIsLoadingOwned(false);
    }
  };

  // PATH 2: Validate custom asset GUID
  const validateCustomToken = async (assetGuid: string) => {
    if (!assetGuid || !/^\d+$/.test(assetGuid)) {
      setCustomTokenDetails(null);
      return;
    }

    // Check if token is already imported
    if (activeAccountAssets?.syscoin) {
      const alreadyImported = activeAccountAssets.syscoin.some(
        (token: ITokenSysProps) => token.assetGuid === assetGuid
      );

      if (alreadyImported) {
        console.log('[SyscoinImport] Token already imported:', assetGuid);
        alert.error(t('tokens.tokenAlreadyImported'));
        setCustomTokenDetails(null);
        return;
      }
    }

    setIsValidatingCustom(true);

    try {
      console.log('[SyscoinImport] Validating custom asset:', assetGuid);

      const details = (await controllerEmitter(
        ['wallet', 'validateSPTOnly'],
        [assetGuid, activeAccount.xpub]
      )) as ITokenSysProps | null;

      if (details) {
        setCustomTokenDetails(details);
        console.log('[SyscoinImport] Valid SPT token found:', details.symbol);
      } else {
        throw new Error('Asset not found');
      }
    } catch (error) {
      console.error('Error validating custom token:', error);
      setCustomTokenDetails(null);
    } finally {
      setIsValidatingCustom(false);
    }
  };

  // Debounced validation for custom asset GUID
  const debouncedValidation = useCallback(debounce(validateCustomToken, 500), [
    activeAccount?.xpub,
    activeAccountAssets?.syscoin,
  ]);

  // Handle custom asset GUID input
  const handleCustomAssetChange = (value: string) => {
    setCustomAssetGuid(value);
    debouncedValidation(value.trim());
  };

  // Select token for import - just store the raw data
  const handleTokenSelect = (
    token: ISysTokensAssetReponse | ITokenSysProps
  ) => {
    setSelectedToken(token);
  };

  // Import selected token - convert to ITokenSysProps format and save directly
  const handleImport = async () => {
    if (!selectedToken || !selectedToken.assetGuid) return;

    setIsImporting(true);

    try {
      // Get token logo URL for known tokens only (no Pali logo fallback for storage)
      const tokenLogo = getTokenLogo(selectedToken.symbol);

      // Convert to ITokenSysProps format for vault storage
      const tokenToSave: ITokenSysProps = {
        assetGuid: selectedToken.assetGuid,
        symbol: selectedToken.symbol,
        name: selectedToken.name || selectedToken.symbol,
        decimals: selectedToken.decimals,
        balance: selectedToken.balance,
        chainId: selectedToken.chainId || activeNetwork.chainId,
        type: 'SPTAllocated',
        // Store image URL only for known tokens
        ...(tokenLogo && { image: tokenLogo }),
        // Preserve fields that only exist on ITokenSysProps (from custom validation)
        ...((selectedToken as ITokenSysProps).contract && {
          contract: (selectedToken as ITokenSysProps).contract,
        }),
        ...((selectedToken as ITokenSysProps).maxSupply && {
          maxSupply: (selectedToken as ITokenSysProps).maxSupply,
        }),
        ...((selectedToken as ITokenSysProps).totalSupply && {
          totalSupply: (selectedToken as ITokenSysProps).totalSupply,
        }),
        ...((selectedToken as ITokenSysProps).description && {
          description: (selectedToken as ITokenSysProps).description,
        }),
      };

      // Save the token directly
      await controllerEmitter(['wallet', 'saveTokenInfo'], [tokenToSave]);

      setImportSuccess(true);
    } catch (error) {
      console.error('Import error:', error);
      alert.error(error.message || t('tokens.tokenNotAdded'));
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-bkg-3 text-brand-white font-poppins">
      {/* Tab Navigation - Compact Style matching EVM */}
      <div className="h-10 relative flex items-end justify-center w-full bg-bkg-1 -mt-2">
        <button
          className={`w-[12.5rem] h-full px-4 font-medium text-base transition-all duration-300 ${
            activeTab === 'owned'
              ? 'bg-bkg-3 text-brand-white rounded-tr-[2rem]'
              : 'bg-bkg-1 text-brand-gray200 hover:text-brand-white'
          }`}
          type="button"
          onClick={() => {
            setActiveTab('owned');
            setSelectedToken(null); // Clear selection when switching tabs
            setCustomAssetGuid('');
            setCustomTokenDetails(null);
          }}
        >
          {t('tokens.yourSptTokens')}
        </button>

        <button
          className={`w-[12.5rem] h-full px-4 font-medium text-base transition-all duration-300 ${
            activeTab === 'custom'
              ? 'bg-bkg-3 text-brand-white rounded-tl-[2rem]'
              : 'bg-bkg-1 text-brand-gray200 hover:text-brand-white'
          }`}
          type="button"
          onClick={() => {
            setActiveTab('custom');
            setSelectedToken(null); // Clear selection when switching tabs
          }}
        >
          {t('tokens.customToken')}
        </button>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto scrollbar-styled">
        <div className="px-4 py-4">
          {/* PATH 1: Your Tokens */}
          {activeTab === 'owned' && (
            <div>
              {/* Loading State */}
              {isLoadingOwned && (
                <div className="flex items-center justify-center py-12">
                  <LoadingOutlined className="text-3xl text-brand-royalblue animate-spin" />
                </div>
              )}

              {/* Token List */}
              {!isLoadingOwned && ownedTokens.length > 0 && (
                <div className="space-y-2">
                  {ownedTokens.map((token) => (
                    <button
                      key={token.assetGuid}
                      onClick={() => handleTokenSelect(token)}
                      className={`w-full p-4 rounded-lg border transition-all ${
                        selectedToken?.assetGuid === token.assetGuid
                          ? 'bg-brand-royalblue/20 border-brand-royalblue'
                          : 'bg-bkg-2 border-transparent hover:bg-bkg-3 hover:border-brand-royalbluemedium'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          {getTokenLogo(token.symbol) ? (
                            <img
                              src={getTokenLogo(token.symbol)!}
                              alt={token.symbol}
                              className="w-10 h-10 rounded-full object-cover bg-bkg-2"
                              onError={(e) => {
                                e.currentTarget.style.display = 'none';
                                e.currentTarget.nextElementSibling?.classList.remove(
                                  'hidden'
                                );
                              }}
                            />
                          ) : null}
                          <div
                            className={`${
                              getTokenLogo(token.symbol) ? 'hidden' : ''
                            } w-10 h-10 bg-gradient-to-br from-brand-royalblue to-brand-pink200 rounded-full flex items-center justify-center`}
                          >
                            <span className="text-white font-bold">
                              {token.symbol?.charAt(0).toUpperCase() || 'S'}
                            </span>
                          </div>
                          <div className="text-left">
                            <div className="font-medium text-brand-white">
                              {token.symbol}
                            </div>
                            <div className="text-xs text-brand-gray200">
                              {t('tokens.assetGuid')}: {token.assetGuid}
                            </div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-brand-white font-rubik font-medium text-base">
                            {token.balance.toFixed(4)}
                          </div>
                          <div
                            className={`text-xs font-poppins px-2 py-0.5 rounded-full inline-block ${getTokenTypeBadgeColor(
                              token.type,
                              true
                            )}`}
                          >
                            SPT
                          </div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {/* Empty State */}
              {!isLoadingOwned && ownedTokens.length === 0 && (
                <div className="text-center py-12">
                  <div className="relative inline-block mb-4">
                    <div className="absolute inset-0 bg-brand-royalblue/20 blur-3xl rounded-full"></div>
                    <div
                      className="relative w-16 h-16 mx-auto bg-bkg-2 
                                  rounded-full flex items-center justify-center"
                    >
                      <Icon
                        name="wallet"
                        size={40}
                        className="text-brand-royalblue"
                      />
                    </div>
                  </div>
                  <h3 className="text-brand-white font-rubik font-medium text-lg mb-1">
                    {t('tokens.noSptAssetsFound')}
                  </h3>
                  <p className="text-brand-gray200 text-sm font-poppins max-w-xs mx-auto">
                    {activeAccountAssets?.syscoin?.length > 0
                      ? t('tokens.youveImportedAllSptTokens')
                      : t('tokens.youDontOwnAnySptTokens')}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* PATH 2: Custom Token */}
          {activeTab === 'custom' && (
            <div className="space-y-4">
              {/* Asset GUID Input - Compact styling matching EVM */}
              <div className="relative max-w-lg mx-auto">
                <input
                  className="w-full h-12 px-6 pr-12 bg-brand-blue800 border border-bkg-white200/30 
                          rounded-full text-brand-white placeholder-brand-gray200/70 text-sm font-poppins
                          focus:border-brand-royalblue/50 focus:outline-none focus:ring-2 focus:ring-brand-royalblue/20
                          transition-all duration-200"
                  placeholder={t('tokens.enterAssetGuid')}
                  value={customAssetGuid}
                  onChange={(e) => handleCustomAssetChange(e.target.value)}
                />
                <div className="absolute right-4 top-1/2 transform -translate-y-1/2 flex items-center justify-center w-6 h-6">
                  {isValidatingCustom ? (
                    <LoadingOutlined className="text-brand-royalblue animate-spin text-base" />
                  ) : customTokenDetails && customAssetGuid ? (
                    <Icon name="check" size={16} className="text-green-500" />
                  ) : customAssetGuid && !customTokenDetails ? (
                    <Icon
                      name="close-circle"
                      size={16}
                      className="text-red-500"
                    />
                  ) : null}
                </div>
              </div>

              {/* Token Details - Professional card */}
              {customTokenDetails && (
                <div className="animate-fadeIn">
                  <div
                    className={`relative overflow-hidden rounded-[16px] p-4 cursor-pointer 
                             transition-all duration-300 transform hover:scale-[1.02]
                             ${
                               selectedToken?.assetGuid ===
                               customTokenDetails.assetGuid
                                 ? 'bg-gradient-to-r from-brand-royalblue/20 to-brand-pink200/20 border-2 border-brand-royalblue shadow-lg shadow-brand-royalblue/20'
                                 : 'bg-bkg-2 border border-bkg-4 hover:border-brand-royalblue/50'
                             }`}
                    onClick={() => handleTokenSelect(customTokenDetails)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="relative">
                          {getTokenLogo(customTokenDetails.symbol) ? (
                            <img
                              src={getTokenLogo(customTokenDetails.symbol)!}
                              alt={customTokenDetails.symbol}
                              className="w-12 h-12 rounded-full object-cover bg-bkg-2"
                              onError={(e) => {
                                e.currentTarget.style.display = 'none';
                                e.currentTarget.nextElementSibling?.classList.remove(
                                  'hidden'
                                );
                              }}
                            />
                          ) : null}
                          <div
                            className={`${
                              getTokenLogo(customTokenDetails.symbol)
                                ? 'hidden'
                                : ''
                            } w-12 h-12 bg-gradient-to-br from-brand-royalblue to-brand-pink200 rounded-full flex items-center justify-center`}
                          >
                            <span className="text-white font-bold text-lg">
                              {customTokenDetails.symbol
                                ?.charAt(0)
                                .toUpperCase() || 'S'}
                            </span>
                          </div>
                          <div
                            className="absolute -bottom-1 -right-1 w-5 h-5 bg-bkg-3 rounded-full 
                                  border-2 border-brand-royalblue flex items-center justify-center"
                          >
                            <Icon
                              name="verified"
                              size={10}
                              className="text-brand-royalblue"
                            />
                          </div>
                        </div>
                        <div className="text-left">
                          <div className="font-medium text-brand-white">
                            {customTokenDetails.symbol}
                          </div>
                          <div className="text-xs text-brand-gray200">
                            {t('tokens.assetGuid')}:{' '}
                            {customTokenDetails.assetGuid}
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-brand-white font-rubik font-medium text-base">
                          {(customTokenDetails.balance || 0).toFixed(4)}
                        </div>
                        <div
                          className={`text-xs font-poppins px-2 py-0.5 rounded-full inline-block ${getTokenTypeBadgeColor(
                            customTokenDetails.type,
                            true
                          )}`}
                        >
                          SPT
                        </div>
                      </div>
                    </div>

                    {/* Additional Details */}
                    {customTokenDetails.contract && (
                      <div className="mt-2 pt-2 border-t border-bkg-4">
                        <p className="text-xs text-brand-gray200">
                          {t('tokens.contractAddressHelp')}
                        </p>
                        <p className="text-xs text-brand-white font-mono mt-1">
                          {truncate(customTokenDetails.contract, 10, true)}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Empty state */}
              {!customAssetGuid && !customTokenDetails && (
                <div className="text-center py-12">
                  <div className="relative inline-block mb-4">
                    <div className="absolute inset-0 bg-brand-royalblue/20 blur-3xl rounded-full"></div>
                    <div
                      className="relative w-16 h-16 mx-auto bg-bkg-2 
                                  rounded-full flex items-center justify-center"
                    >
                      <Icon
                        name="import"
                        size={40}
                        className="text-brand-royalblue"
                      />
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

      {/* Import Confirmation - Fixed Bottom Panel */}
      {selectedToken && (
        <div
          className="fixed bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-bkg-1 to-bkg-1/95 
                        backdrop-blur-sm border-t border-bkg-4 animate-slideIn"
        >
          <div className="max-w-md mx-auto">
            <div className="bg-bkg-2 rounded-[20px] p-5 shadow-xl border border-brand-royalblue/30">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  {getTokenLogo(selectedToken.symbol) ? (
                    <img
                      src={getTokenLogo(selectedToken.symbol)!}
                      alt={selectedToken.symbol}
                      className="w-10 h-10 rounded-full object-cover bg-bkg-2"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                        e.currentTarget.nextElementSibling?.classList.remove(
                          'hidden'
                        );
                      }}
                    />
                  ) : null}
                  <div
                    className={`${
                      getTokenLogo(selectedToken.symbol) ? 'hidden' : ''
                    } w-10 h-10 bg-gradient-to-br from-brand-royalblue to-brand-pink200 rounded-full flex items-center justify-center`}
                  >
                    <span className="text-white font-bold">
                      {selectedToken.symbol?.charAt(0).toUpperCase() || 'S'}
                    </span>
                  </div>
                  <div>
                    <h4 className="text-brand-white font-rubik font-medium text-base">
                      {t('buttons.import')} {selectedToken.symbol}
                    </h4>
                    <p className="text-brand-gray200 text-xs font-poppins">
                      {t('tokens.assetGuid')}: {selectedToken.assetGuid}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-brand-white font-rubik font-medium">
                    {(selectedToken.balance || 0).toFixed(4)}
                  </div>
                  <div className="text-brand-gray200 text-xs font-poppins">
                    {selectedToken.symbol}
                  </div>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={handleImport}
                  disabled={isImporting}
                  className="flex-1 py-3 bg-gradient-to-r from-brand-royalblue to-brand-pink200 
                            text-brand-white font-medium text-sm rounded-full
                            hover:shadow-lg hover:shadow-brand-royalblue/30 transform hover:scale-105
                            transition-all duration-200 disabled:opacity-60 disabled:hover:scale-100
                            disabled:hover:shadow-none flex items-center justify-center gap-2"
                >
                  {isImporting ? (
                    <>
                      <LoadingOutlined className="animate-spin" />
                      {t('tokens.importing')}
                    </>
                  ) : (
                    t('buttons.importToken')
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedToken(null)}
                  className="px-6 py-3 bg-bkg-3 border border-bkg-4 text-brand-gray200 
                            font-medium text-sm rounded-full hover:bg-bkg-4 hover:text-brand-white
                            transition-all duration-200"
                >
                  {t('buttons.cancel')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Success Modal */}
      {importSuccess && selectedToken && (
        <DefaultModal
          show={importSuccess}
          title={t('tokens.tokenImported')}
          description={`${selectedToken.symbol} has been added to your wallet`}
          onClose={async () => {
            setImportSuccess(false);
            // Trigger assets refresh
            await controllerEmitter(
              ['wallet', 'getLatestUpdateForCurrentAccount'],
              [false, true]
            );
            navigate('/home');
          }}
        />
      )}
    </div>
  );
};
