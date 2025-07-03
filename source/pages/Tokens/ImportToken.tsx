import { LoadingOutlined } from '@ant-design/icons';
import { debounce } from 'lodash';
import React, { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import PaliLogo from 'assets/all_assets/favicon-32.png';
import { DefaultModal, Icon } from 'components/index';
import { useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import {
  ITokenEthProps,
  ITokenDetails,
  ITokenSearchResult,
} from 'types/tokens';
import { truncate } from 'utils/index';
import { getTokenTypeBadgeColor } from 'utils/tokens';

export const ImportToken: React.FC = () => {
  const { controllerEmitter } = useController();
  const { navigate, alert } = useUtils();
  const { t } = useTranslation();

  // Tab state - back to two tabs
  const [activeTab, setActiveTab] = useState<'owned' | 'custom'>('owned');

  // PATH 1: Your Tokens state
  const [ownedTokens, setOwnedTokens] = useState<ITokenSearchResult[]>([]);
  const [isLoadingOwned, setIsLoadingOwned] = useState(false);

  // PATH 2: Custom Token state (supports both ERC-20 and NFT)
  const [customContractAddress, setCustomContractAddress] = useState('');
  const [customTokenDetails, setCustomTokenDetails] =
    useState<ITokenDetails | null>(null);
  const [isValidatingCustom, setIsValidatingCustom] = useState(false);

  // Common state
  const [selectedToken, setSelectedToken] = useState<ITokenDetails | null>(
    null
  );
  const [isEnhancingToken, setIsEnhancingToken] = useState(false);
  const [enhancingTokenAddress, setEnhancingTokenAddress] = useState<
    string | null
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
    if (activeTab === 'owned') {
      loadOwnedTokens();
    }
  }, [activeTab, activeAccount.address, activeAccountAssets?.ethereum]);

  // PATH 1: Load tokens user actually owns
  const loadOwnedTokens = async () => {
    setIsLoadingOwned(true);
    try {
      console.log('[ImportToken] Loading user owned tokens');

      const results = (await controllerEmitter(
        ['wallet', 'getUserOwnedTokens'],
        [activeAccount.address]
      )) as ITokenSearchResult[];

      console.log(`[ImportToken] Found ${results?.length || 0} owned tokens`);

      // Filter out already imported tokens
      if (results && results.length > 0 && activeAccountAssets?.ethereum) {
        const importedAddresses = new Set(
          activeAccountAssets.ethereum.map((token: ITokenEthProps) =>
            token.contractAddress.toLowerCase()
          )
        );

        const filteredResults = results.filter(
          (token) => !importedAddresses.has(token.contractAddress.toLowerCase())
        );

        console.log(
          `[ImportToken] Filtered out ${
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

  // PATH 2: Validate custom contract address (supports both ERC-20 and NFT)
  const validateCustomToken = async (contractAddress: string) => {
    if (!contractAddress || !/^0x[a-fA-F0-9]{40}$/.test(contractAddress)) {
      setCustomTokenDetails(null);
      return;
    }

    // Check if token is already imported
    if (activeAccountAssets?.ethereum) {
      const alreadyImported = activeAccountAssets.ethereum.some(
        (token: ITokenEthProps) =>
          token.contractAddress.toLowerCase() === contractAddress.toLowerCase()
      );

      if (alreadyImported) {
        console.log('[ImportToken] Token already imported:', contractAddress);
        alert.error(t('tokens.tokenAlreadyImported'));
        setCustomTokenDetails(null);
        return;
      }
    }

    setIsValidatingCustom(true);

    try {
      console.log('[ImportToken] Validating custom contract:', contractAddress);

      // First try ERC-20 validation
      try {
        const erc20Details = (await controllerEmitter(
          ['wallet', 'validateERC20Only'],
          [contractAddress, activeAccount.address]
        )) as ITokenDetails | null;

        if (erc20Details) {
          setCustomTokenDetails(erc20Details);
          console.log(
            `[ImportToken] Valid ERC-20 token found:`,
            erc20Details.symbol
          );
          return;
        }
      } catch (erc20Error) {
        console.log('[ImportToken] Not an ERC-20 token, trying NFT validation');
      }

      // If ERC-20 validation fails, try NFT validation
      try {
        const nftDetails = (await controllerEmitter(
          ['wallet', 'validateNftContract'],
          [contractAddress, activeAccount.address]
        )) as ITokenDetails | null;

        if (nftDetails) {
          setCustomTokenDetails(nftDetails);
          console.log(`[ImportToken] Valid NFT contract found:`, {
            symbol: nftDetails.symbol,
            type: nftDetails.tokenStandard,
            balance: nftDetails.balance,
          });
          return;
        }
      } catch (nftError) {
        console.log('[ImportToken] Not an NFT contract either');
      }

      // If both validations fail
      throw new Error('Contract not recognized as ERC-20 or NFT');
    } catch (error) {
      console.error('Error validating custom contract:', error);
      alert.error(
        error.message ||
          "Invalid contract address. Please ensure it's a valid ERC-20 token or NFT collection contract."
      );
      setCustomTokenDetails(null);
    } finally {
      setIsValidatingCustom(false);
    }
  };

  // Debounced validation for custom contract
  const debouncedValidation = useCallback(debounce(validateCustomToken, 500), [
    activeAccount.address,
    activeAccountAssets?.ethereum,
  ]);

  // Handle custom contract input
  const handleCustomContractChange = (value: string) => {
    setCustomContractAddress(value);
    debouncedValidation(value.trim());
  };

  // Select token for import
  const handleTokenSelect = async (
    token: ITokenSearchResult | ITokenDetails
  ) => {
    // Convert TokenSearchResult to TokenDetails format if needed
    if ('contractAddress' in token && token.contractAddress) {
      const searchResult = token as ITokenSearchResult;
      // All fungible token standards supported by Blockscout
      const fungibleTypes = ['ERC-20', 'ERC-777', 'ERC-4626'];
      const isNft = !fungibleTypes.includes(searchResult.tokenStandard || '');
      // Convert image format if needed
      let imageField:
        | { large?: string; small?: string; thumb?: string }
        | undefined;
      if (searchResult.image) {
        if (typeof searchResult.image === 'string') {
          // If it's a string, use it for all sizes
          imageField = {
            thumb: searchResult.image,
            small: searchResult.image,
            large: searchResult.image,
          };
        } else {
          // If it's already an object, use as is
          imageField = searchResult.image as any;
        }
      }

      const basicTokenDetails: ITokenDetails = {
        id: searchResult.id,
        symbol: searchResult.symbol,
        name: searchResult.name,
        contractAddress: searchResult.contractAddress,
        decimals: searchResult.decimals || 18,
        balance: searchResult.balance || 0,
        chainId: activeNetwork.chainId,
        tokenStandard: searchResult.tokenStandard as any,
        isNft: isNft,

        // Include the converted image if available
        ...(imageField && { image: imageField }),
      };

      // Enhance with CoinGecko data for both ERC-20 and NFTs (same as import flows)
      setIsEnhancingToken(true);
      setEnhancingTokenAddress(searchResult.contractAddress);
      try {
        let enhancedTokenDetails: ITokenDetails;

        if (isNft) {
          // Use NFT validation to get CoinGecko enhancement
          enhancedTokenDetails = (await controllerEmitter(
            ['wallet', 'validateNftContract'],
            [searchResult.contractAddress, activeAccount.address]
          )) as ITokenDetails;
        } else {
          // Use ERC-20 validation to get CoinGecko enhancement
          enhancedTokenDetails = (await controllerEmitter(
            ['wallet', 'validateERC20Only'],
            [searchResult.contractAddress, activeAccount.address]
          )) as ITokenDetails;
        }

        if (enhancedTokenDetails) {
          // Merge enhanced data with our browsing-specific data (balance from API)
          setSelectedToken({
            ...enhancedTokenDetails, // CoinGecko data + validated token info
            balance: basicTokenDetails.balance, // Use balance from browsing API
          });
        } else {
          // Fallback to basic details if enhancement fails
          setSelectedToken(basicTokenDetails);
        }
      } catch (error) {
        console.warn(
          'CoinGecko enhancement failed, using basic token details:',
          error
        );
        // Fallback to basic details if enhancement fails
        setSelectedToken(basicTokenDetails);
      } finally {
        setIsEnhancingToken(false);
        setEnhancingTokenAddress(null);
      }
    } else {
      // Create a new object to ensure all fields are preserved
      const tokenWithAllFields = { ...token } as ITokenDetails;

      setSelectedToken(tokenWithAllFields);
    }
  };

  // Import selected token
  const handleImport = async () => {
    if (!selectedToken) return;

    setIsImporting(true);
    try {
      // Handle both ERC-20 and NFT imports
      let tokenLogo: string | undefined;

      // Handle different image formats
      if (typeof selectedToken.image === 'string') {
        tokenLogo = selectedToken.image;
      } else if (
        selectedToken.image &&
        typeof selectedToken.image === 'object'
      ) {
        tokenLogo =
          selectedToken.image.large ||
          selectedToken.image.small ||
          selectedToken.image.thumb;
      }

      if (!tokenLogo) {
        tokenLogo = PaliLogo;
      }

      const tokenStandard = selectedToken.tokenStandard || 'ERC-20';
      const isNft = ['ERC-721', 'ERC-1155'].includes(tokenStandard);

      const tokenToSave: ITokenEthProps = {
        tokenSymbol: selectedToken.symbol.toUpperCase(),
        contractAddress: selectedToken.contractAddress,
        decimals: selectedToken.decimals,
        isNft: isNft,
        balance: selectedToken.balance,
        chainId: activeNetwork.chainId,
        name: selectedToken.name || selectedToken.symbol,
        logo: tokenLogo,
        tokenStandard: tokenStandard,
      };

      await controllerEmitter(['wallet', 'saveTokenInfo'], [tokenToSave]);
      setImportSuccess(true);
    } catch (error) {
      console.error('Import error:', error);
      alert.error(error.message || 'Failed to import');
    } finally {
      setIsImporting(false);
    }
  };

  // Reset selection when switching tabs
  const handleTabChange = (key: 'owned' | 'custom') => {
    setActiveTab(key);
    setSelectedToken(null);
    setIsEnhancingToken(false);
    setEnhancingTokenAddress(null);
  };

  // Render owned token item - professional version
  const renderOwnedToken = (token: ITokenSearchResult) => {
    const isCurrentlyEnhancing =
      isEnhancingToken && enhancingTokenAddress === token.contractAddress;

    return (
      <div
        key={token.id}
        className={`group relative overflow-hidden rounded-[16px] p-4 cursor-pointer 
                 transition-all duration-300 transform hover:scale-[1.02]
                 ${
                   selectedToken?.contractAddress === token.contractAddress
                     ? 'bg-gradient-to-r from-brand-royalblue/20 to-brand-pink200/20 border-2 border-brand-royalblue shadow-lg shadow-brand-royalblue/20'
                     : 'bg-bkg-2 border border-bkg-4 hover:border-brand-royalblue/50 hover:shadow-md'
                 }
                 ${isCurrentlyEnhancing ? 'pointer-events-none' : ''}`}
        onClick={() => !isCurrentlyEnhancing && handleTokenSelect(token)}
      >
        {/* Selected checkmark or loading indicator */}
        {selectedToken?.contractAddress === token.contractAddress && (
          <div className="absolute top-3 right-3">
            <div className="w-6 h-6 bg-brand-royalblue rounded-full flex items-center justify-center">
              {isCurrentlyEnhancing ? (
                <LoadingOutlined className="animate-spin text-brand-white text-xs" />
              ) : (
                <Icon name="check" size={14} className="text-brand-white" />
              )}
            </div>
          </div>
        )}

        {/* Loading overlay for enhancement */}
        {isCurrentlyEnhancing && (
          <div className="absolute inset-0 bg-brand-blue800/60 backdrop-blur-sm flex items-center justify-center rounded-[16px] z-10">
            <div className="flex flex-col items-center gap-2">
              <LoadingOutlined className="text-brand-royalblue animate-spin text-xl" />
              <span className="text-brand-white text-xs font-medium">
                {t('send.verifyingBalance')}...
              </span>
            </div>
          </div>
        )}

        {/* Hover gradient effect */}
        <div
          className="absolute inset-0 bg-gradient-to-r from-brand-royalblue/0 to-brand-pink200/0 
                      group-hover:from-brand-royalblue/5 group-hover:to-brand-pink200/5 
                      transition-all duration-300 pointer-events-none"
        ></div>

        <div className="relative flex items-center justify-between">
          <div className="flex items-center space-x-4">
            {/* Token Icon */}
            <div className="relative">
              {(() => {
                // Handle both CoinGecko image structure and simple string
                let imageUrl: string | undefined;

                if (typeof token.image === 'string') {
                  imageUrl = token.image;
                } else if (token.image && typeof token.image === 'object') {
                  imageUrl =
                    (token.image as any).large ||
                    (token.image as any).small ||
                    (token.image as any).thumb;
                }

                return imageUrl ? (
                  <div
                    className="w-12 h-12 rounded-full overflow-hidden bg-bkg-2 border border-bkg-4
                                shadow-md group-hover:shadow-lg transition-shadow duration-300"
                  >
                    <img
                      src={imageUrl}
                      alt={token.symbol}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                        e.currentTarget.nextElementSibling?.classList.remove(
                          'hidden'
                        );
                      }}
                    />
                    <div
                      className="hidden w-full h-full bg-gradient-to-br from-brand-royalblue to-brand-pink200 
                                  flex items-center justify-center"
                    >
                      <span className="text-brand-white font-rubik font-bold text-lg">
                        {token.symbol.charAt(0).toUpperCase()}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div
                    className="w-12 h-12 rounded-full bg-gradient-to-br from-brand-royalblue to-brand-pink200 
                                flex items-center justify-center shadow-md group-hover:shadow-lg 
                                transition-shadow duration-300"
                  >
                    <span className="text-brand-white font-rubik font-bold text-lg">
                      {token.symbol.charAt(0).toUpperCase()}
                    </span>
                  </div>
                );
              })()}
              {/* Token type badge */}
              {token.tokenStandard && (
                <div
                  className={`absolute -bottom-1 -right-1 px-1.5 py-0.5 rounded-full 
                              text-[10px] font-medium ${getTokenTypeBadgeColor(
                                token.tokenStandard,
                                true
                              )}`}
                >
                  {token.tokenStandard}
                </div>
              )}
            </div>

            {/* Token Info */}
            <div className="flex-1 min-w-0">
              <div className="font-rubik font-medium text-brand-white text-base">
                {token.symbol}
              </div>
              <div className="text-sm text-brand-gray200 font-poppins truncate">
                {token.name}
              </div>
            </div>
          </div>

          {/* Balance Info */}
          <div className="text-right pl-4">
            <div className="text-brand-white font-rubik font-medium text-base">
              {token.balance?.toFixed(4) || '0'}
            </div>
            <div className="text-xs text-brand-gray200 font-poppins">
              {t('send.balance')}
            </div>
          </div>
        </div>
      </div>
    );
  };
  return (
    <div className="flex flex-col h-full bg-bkg-3 text-brand-white font-poppins">
      {/* Tab Navigation - Two Tab Layout */}
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
      <div className="flex-1 overflow-y-auto scrollbar-styled">
        <div className="px-4 py-4">
          {activeTab === 'owned' ? (
            <div>
              {/* Owned tokens list */}
              {isLoadingOwned ? (
                <div className="flex items-center justify-center py-12">
                  <LoadingOutlined className="text-3xl text-brand-royalblue animate-spin" />
                </div>
              ) : ownedTokens.length > 0 ? (
                <div className="space-y-2 max-h-[460px] overflow-y-auto scrollbar-styled">
                  {ownedTokens.map(renderOwnedToken)}
                </div>
              ) : (
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
                    {t('tokens.noTokensFound')}
                  </h3>
                  <p className="text-brand-gray200 text-sm font-poppins max-w-xs mx-auto">
                    {t('tokens.youDontHaveTokensYet')}
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {/* Contract Address Input - Compact styling */}
              <div className="relative max-w-lg mx-auto">
                <input
                  className="w-full h-12 px-6 pr-12 bg-brand-blue800 border border-bkg-white200/30 
                            rounded-full text-brand-white placeholder-brand-gray200/70 text-sm font-poppins
                            focus:border-brand-royalblue/50 focus:outline-none focus:ring-2 focus:ring-brand-royalblue/20
                            transition-all duration-200"
                  placeholder={t('tokens.enterContractAddress')}
                  value={customContractAddress}
                  onChange={(e) => handleCustomContractChange(e.target.value)}
                />
                <div className="absolute right-4 top-1/2 transform -translate-y-1/2 flex items-center justify-center w-6 h-6">
                  {isValidatingCustom ? (
                    <LoadingOutlined className="text-brand-royalblue animate-spin text-base" />
                  ) : customTokenDetails && customContractAddress ? (
                    <Icon name="check" size={16} className="text-green-500" />
                  ) : customContractAddress && !customTokenDetails ? (
                    <Icon
                      name="close-circle"
                      size={16}
                      className="text-red-500"
                    />
                  ) : null}
                </div>
              </div>

              {/* Custom token details - Dynamic styling based on token type */}
              {customTokenDetails && (
                <div className="animate-fadeIn">
                  <div
                    className={`relative overflow-hidden rounded-[16px] p-4 cursor-pointer 
                               transition-all duration-300 transform hover:scale-[1.02]
                               ${
                                 selectedToken?.contractAddress ===
                                 customTokenDetails.contractAddress
                                   ? customTokenDetails.isNft
                                     ? 'bg-gradient-to-r from-purple-600/20 to-pink-600/20 border-2 border-purple-500 shadow-lg shadow-purple-500/20'
                                     : 'bg-gradient-to-r from-brand-royalblue/20 to-brand-pink200/20 border-2 border-brand-royalblue shadow-lg shadow-brand-royalblue/20'
                                   : 'bg-bkg-2 border border-bkg-4 hover:border-brand-royalblue/50'
                               }
                               ${
                                 isEnhancingToken &&
                                 enhancingTokenAddress ===
                                   customTokenDetails.contractAddress
                                   ? 'pointer-events-none'
                                   : ''
                               }`}
                    onClick={() =>
                      !isEnhancingToken && handleTokenSelect(customTokenDetails)
                    }
                  >
                    {/* Selected indicator */}
                    {selectedToken?.contractAddress ===
                      customTokenDetails.contractAddress && (
                      <div className="absolute top-2 right-2">
                        <div
                          className={`w-6 h-6 rounded-full flex items-center justify-center ${
                            customTokenDetails.isNft
                              ? 'bg-purple-500'
                              : 'bg-brand-royalblue'
                          }`}
                        >
                          {isEnhancingToken ? (
                            <LoadingOutlined className="animate-spin text-brand-white text-xs" />
                          ) : (
                            <Icon
                              name="check"
                              size={14}
                              className="text-brand-white"
                            />
                          )}
                        </div>
                      </div>
                    )}

                    {/* Loading overlay for enhancement */}
                    {isEnhancingToken &&
                      enhancingTokenAddress ===
                        customTokenDetails.contractAddress && (
                        <div className="absolute inset-0 bg-brand-blue800/60 backdrop-blur-sm flex items-center justify-center rounded-[16px] z-10">
                          <div className="flex flex-col items-center gap-2">
                            <LoadingOutlined className="text-brand-royalblue animate-spin text-xl" />
                            <span className="text-brand-white text-xs font-medium">
                              {t('send.verifyingBalance')}...
                            </span>
                          </div>
                        </div>
                      )}

                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-4">
                        {/* Token Icon - Dynamic based on type */}
                        <div className="relative">
                          {(() => {
                            // Handle both CoinGecko image structure and simple string
                            let imageUrl: string | undefined;

                            if (typeof customTokenDetails.image === 'string') {
                              imageUrl = customTokenDetails.image;
                            } else if (
                              customTokenDetails.image &&
                              typeof customTokenDetails.image === 'object'
                            ) {
                              imageUrl =
                                customTokenDetails.image.large ||
                                customTokenDetails.image.small ||
                                customTokenDetails.image.thumb;
                            }

                            const gradientClasses = customTokenDetails.isNft
                              ? 'bg-gradient-to-br from-purple-600 to-pink-600'
                              : 'bg-gradient-to-br from-brand-royalblue to-brand-pink200';

                            return imageUrl ? (
                              <div className="w-12 h-12 rounded-full overflow-hidden bg-bkg-2 border border-bkg-4">
                                <img
                                  src={imageUrl}
                                  alt={customTokenDetails.symbol}
                                  className="w-full h-full object-cover"
                                  onError={(e) => {
                                    e.currentTarget.style.display = 'none';
                                    e.currentTarget.nextElementSibling?.classList.remove(
                                      'hidden'
                                    );
                                  }}
                                />
                                <div
                                  className={`hidden w-full h-full ${gradientClasses} flex items-center justify-center`}
                                >
                                  <span className="text-brand-white font-rubik font-bold text-lg">
                                    {customTokenDetails.symbol
                                      .charAt(0)
                                      .toUpperCase()}
                                  </span>
                                </div>
                              </div>
                            ) : (
                              <div
                                className={`w-12 h-12 rounded-full ${gradientClasses} flex items-center justify-center shadow-md`}
                              >
                                <span className="text-brand-white font-rubik font-bold text-lg">
                                  {customTokenDetails.symbol
                                    .charAt(0)
                                    .toUpperCase()}
                                </span>
                              </div>
                            );
                          })()}
                          <div
                            className={`absolute -bottom-1 -right-1 w-5 h-5 bg-bkg-3 rounded-full 
                                          border-2 flex items-center justify-center ${
                                            customTokenDetails.isNft
                                              ? 'border-purple-500'
                                              : 'border-brand-royalblue'
                                          }`}
                          >
                            <Icon
                              name={
                                customTokenDetails.isNft ? 'image' : 'verified'
                              }
                              size={10}
                              className={
                                customTokenDetails.isNft
                                  ? 'text-purple-500'
                                  : 'text-brand-royalblue'
                              }
                            />
                          </div>
                        </div>

                        {/* Token Info */}
                        <div>
                          <div className="font-rubik font-medium text-brand-white text-base">
                            {customTokenDetails.symbol}
                          </div>
                          <div className="text-sm text-brand-gray200 font-poppins">
                            {customTokenDetails.name}
                          </div>
                          <div className="text-xs text-brand-gray200/60 font-mono mt-1">
                            {truncate(customTokenDetails.contractAddress, 16)}
                          </div>
                        </div>
                      </div>

                      {/* Balance Info - Dynamic based on type */}
                      <div className="text-right">
                        <div className="text-brand-white font-rubik font-medium text-base">
                          {customTokenDetails.isNft
                            ? customTokenDetails.balance > 0
                              ? `${customTokenDetails.balance} ${t(
                                  'tokens.owned'
                                )}`
                              : t('tokens.noBalance')
                            : customTokenDetails.balance.toFixed(4)}
                        </div>
                        <div
                          className={`text-xs font-poppins px-2 py-0.5 rounded-full inline-block ${getTokenTypeBadgeColor(
                            customTokenDetails.tokenStandard,
                            true
                          )}`}
                        >
                          {customTokenDetails.tokenStandard || 'ERC-20'}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Empty state - Compact */}
              {!customContractAddress && !customTokenDetails && (
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
                    {t('tokens.enterContractToImport')}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Import Confirmation */}
          {selectedToken && (
            <div
              className="fixed bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-bkg-1 to-bkg-1/95 
                            backdrop-blur-sm border-t border-bkg-4 animate-slideIn"
            >
              <div className="max-w-md mx-auto">
                <div className="bg-bkg-2 rounded-[20px] p-5 shadow-xl border border-brand-royalblue/30">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      {(() => {
                        // Handle both CoinGecko image structure and simple string
                        let imageUrl: string | undefined;

                        if (typeof selectedToken.image === 'string') {
                          imageUrl = selectedToken.image;
                        } else if (
                          selectedToken.image &&
                          typeof selectedToken.image === 'object'
                        ) {
                          imageUrl =
                            selectedToken.image.large ||
                            selectedToken.image.small ||
                            selectedToken.image.thumb;
                        }

                        return imageUrl ? (
                          <div className="w-10 h-10 rounded-full overflow-hidden bg-bkg-2 border border-bkg-4 shadow-md">
                            <img
                              src={imageUrl}
                              alt={selectedToken.symbol}
                              className="w-full h-full object-cover"
                              onError={(e) => {
                                e.currentTarget.style.display = 'none';
                                e.currentTarget.nextElementSibling?.classList.remove(
                                  'hidden'
                                );
                              }}
                            />
                            <div
                              className="hidden w-full h-full bg-gradient-to-br from-brand-royalblue to-brand-pink200 
                                                flex items-center justify-center"
                            >
                              <span className="text-brand-white font-rubik font-bold text-base">
                                {selectedToken.symbol.charAt(0).toUpperCase()}
                              </span>
                            </div>
                          </div>
                        ) : (
                          <div
                            className="w-10 h-10 rounded-full bg-gradient-to-br from-brand-royalblue to-brand-pink200 
                                              flex items-center justify-center shadow-md"
                          >
                            <span className="text-brand-white font-rubik font-bold text-base">
                              {selectedToken.symbol.charAt(0).toUpperCase()}
                            </span>
                          </div>
                        );
                      })()}
                      <div>
                        <h4 className="text-brand-white font-rubik font-medium text-base">
                          {t('buttons.import')} {selectedToken.symbol}
                        </h4>
                        <p className="text-brand-gray200 text-xs font-poppins">
                          {truncate(selectedToken.contractAddress || '', 16)}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-brand-white font-rubik font-medium">
                        {selectedToken.isNft
                          ? selectedToken.balance > 0
                            ? `${selectedToken.balance} ${t('tokens.owned')}`
                            : t('tokens.noBalance')
                          : selectedToken.balance.toFixed(4)}
                      </div>
                      <div className="text-brand-gray200 text-xs font-poppins">
                        {selectedToken.isNft
                          ? selectedToken.tokenStandard || 'NFT'
                          : selectedToken.symbol}
                      </div>
                    </div>
                  </div>

                  {/* NFT-specific info panel for consistency between both flows */}
                  {selectedToken.isNft && (
                    <div className="mb-4 p-3 bg-purple-600/10 border border-purple-500/20 rounded-xl">
                      <div className="flex items-start gap-3">
                        <Icon
                          name="info"
                          size={16}
                          className="text-purple-400 mt-0.5 flex-shrink-0"
                        />
                        <div className="text-xs text-brand-gray200 font-poppins">
                          {selectedToken.tokenStandard === 'ERC-1155' ? (
                            <>
                              <p className="mb-1 font-medium text-purple-300">
                                {t('tokens.erc1155CollectionDetected')}
                              </p>
                              <p className="mb-1">
                                {selectedToken.balance > 0
                                  ? t('tokens.nftBalanceDetected')
                                  : 'Balance will show after entering specific token IDs in view/send flows.'}
                              </p>
                              <p>
                                {t('tokens.erc1155RequiresSpecificTokenIds')}
                              </p>
                            </>
                          ) : (
                            <>
                              <p className="mb-1 font-medium text-purple-300">
                                {t('tokens.erc721CollectionDetected')}
                              </p>
                              <p className="mb-1">
                                {selectedToken.balance > 0
                                  ? t('tokens.nftBalanceDetected')
                                  : t('send.youDontOwnAnyNftsFromCollection')}
                              </p>
                              <p>{t('tokens.nftIndividualTokensInfo')}</p>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={handleImport}
                      disabled={isImporting || isEnhancingToken}
                      className="flex-1 py-3 bg-gradient-to-r from-brand-royalblue to-brand-pink200 
                                text-brand-white font-medium text-sm rounded-full
                                hover:shadow-lg hover:shadow-brand-royalblue/30 transform hover:scale-105
                                transition-all duration-200 disabled:opacity-60 disabled:hover:scale-100
                                disabled:hover:shadow-none flex items-center justify-center gap-2"
                    >
                      {isEnhancingToken ? (
                        <>
                          <LoadingOutlined className="animate-spin" />
                          {t('send.verifyingBalance')}
                        </>
                      ) : isImporting ? (
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
                      onClick={() => {
                        setSelectedToken(null);
                      }}
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
        </div>
      </div>

      {/* Success Modal */}
      {importSuccess && selectedToken && (
        <DefaultModal
          show={importSuccess}
          title={t('tokens.tokenImported')}
          description={`${selectedToken.symbol} ${t(
            'tokens.hasBeenAddedToYourWallet'
          )}`}
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

export default ImportToken;
