import { LoadingOutlined } from '@ant-design/icons';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FiExternalLink as ExternalLinkIcon } from 'react-icons/fi';
import { RiFileCopyLine as CopyIcon } from 'react-icons/ri';
import { useSelector } from 'react-redux';

import { ChainIcon } from 'components/ChainIcon';
import { Icon } from 'components/Icon/Icon';
import { TokenIcon } from 'components/TokenIcon';
import { useUtils, useAdjustedExplorer } from 'hooks/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import { INetworkType } from 'types/network';
import { ellipsis } from 'utils/index';
import { NFT_FALLBACK_IMAGE } from 'utils/nftFallback';

export const NftsDetails = ({ nftData }: { nftData: any }) => {
  const { controllerEmitter } = useController();
  const {
    activeNetwork: { explorer },
    activeAccount,
    accounts,
  } = useSelector((state: RootState) => state.vault);

  // Use proper selector for assets
  const currentAccount = accounts[activeAccount.type]?.[activeAccount.id];

  const { useCopyClipboard, alert } = useUtils();

  // Get NFT data from navigation state if available (for import preview/search results)
  const currentNft = nftData;

  const [copied, copy] = useCopyClipboard();
  const [nftTokenIds, setNftTokenIds] = useState<
    { balance: number; tokenId: string }[]
  >([]);
  const [isLoadingTokenIds, setIsLoadingTokenIds] = useState(false);
  const [selectedTokenId, setSelectedTokenId] = useState<string | null>(null);
  const [manualTokenId, setManualTokenId] = useState<string>('');
  const [hasMoreTokens, setHasMoreTokens] = useState(false);
  const [isVerifyingTokenId, setIsVerifyingTokenId] = useState(false);
  const [verifiedTokenBalance, setVerifiedTokenBalance] = useState<
    number | null
  >(null);
  const [verificationError, setVerificationError] = useState<string | null>(
    null
  );

  const { t } = useTranslation();

  // Load token IDs when component mounts
  useEffect(() => {
    if (currentNft && currentNft.balance > 0) {
      if (currentNft.tokenStandard === 'ERC-1155') {
        // ERC-1155 always has stored tokenId
        if (currentNft.tokenId) {
          setSelectedTokenId(currentNft.tokenId);
        }
        setVerifiedTokenBalance(currentNft.balance);
      } else {
        // ERC-721 - enumerate token IDs
        loadTokenIds();
      }
    }
  }, [currentNft]);

  // Verify manually entered token ID
  const verifyTokenId = async (tokenId: string) => {
    if (!currentNft || !currentAccount?.address || !tokenId.trim()) {
      setVerifiedTokenBalance(null);
      setVerificationError(null);
      return;
    }

    setIsVerifyingTokenId(true);
    setVerificationError(null);

    try {
      const result = (await controllerEmitter(
        [
          'wallet',
          currentNft.tokenStandard === 'ERC-721'
            ? 'verifyERC721Ownership'
            : 'verifyERC1155Ownership',
        ],
        [currentNft.contractAddress, currentAccount?.address, [tokenId]]
      )) as { balance: number; tokenId: string; verified: boolean }[];

      if (result && result.length > 0) {
        const tokenInfo = result[0];
        if (tokenInfo.verified && tokenInfo.balance > 0) {
          setVerifiedTokenBalance(tokenInfo.balance);
          setVerificationError(null);
        } else {
          setVerifiedTokenBalance(0);
          setVerificationError(
            tokenInfo.balance === 0
              ? t('send.youDontOwnThisToken')
              : t('send.tokenVerificationFailed')
          );
        }
      } else {
        setVerifiedTokenBalance(0);
        setVerificationError(t('send.tokenNotFound'));
      }
    } catch (error) {
      console.error('Error verifying token ID:', error);
      setVerifiedTokenBalance(0);
      setVerificationError(t('send.verificationFailed'));
    } finally {
      setIsVerifyingTokenId(false);
    }
  };

  const loadTokenIds = async () => {
    if (!currentNft || !currentAccount?.address) return;

    // This function is only called for ERC-721

    setIsLoadingTokenIds(true);
    try {
      const result = (await controllerEmitter(
        ['wallet', 'fetchNftTokenIds'],
        [
          currentNft.contractAddress,
          currentAccount?.address,
          currentNft.tokenStandard || 'ERC-721',
        ]
      )) as { balance: number; tokenId: string }[] & {
        hasMore?: boolean;
        requiresManualEntry?: boolean;
      };

      setNftTokenIds(result || []);
      setHasMoreTokens(result.hasMore || false);

      // Auto-select first token if we have any and no manual selection
      if (result && result.length > 0 && !selectedTokenId && !manualTokenId) {
        setSelectedTokenId(result[0].tokenId);
        setVerifiedTokenBalance(result[0].balance); // Already verified from enumeration
      }
    } catch (error) {
      console.error('Error loading NFT token IDs:', error);
      setNftTokenIds([]);
    } finally {
      setIsLoadingTokenIds(false);
    }
  };

  // Handle manual token ID input with debounced verification
  const handleManualTokenIdChange = (value: string) => {
    setManualTokenId(value);
    if (value) {
      setSelectedTokenId(value);
      // Clear previous verification
      setVerifiedTokenBalance(null);
      setVerificationError(null);

      // Debounce verification to avoid too many calls
      const timeoutId = setTimeout(() => {
        verifyTokenId(value);
      }, 500);

      return () => clearTimeout(timeoutId);
    } else {
      setVerifiedTokenBalance(null);
      setVerificationError(null);
    }
  };

  // Get display token ID
  const displayTokenId =
    currentNft?.tokenStandard === 'ERC-1155'
      ? currentNft.tokenId || '' // ERC-1155 may not have tokenId during search
      : manualTokenId || selectedTokenId; // ERC-721 uses manual/selected

  // Extract image URL with fallback logic similar to MetaMask
  const getNftImage = () => {
    if (!currentNft) return NFT_FALLBACK_IMAGE;

    // Priority order for images
    return currentNft.logo || NFT_FALLBACK_IMAGE;
  };

  const adjustedExplorer = useAdjustedExplorer(explorer);

  const openCollectionOnExplorer = () =>
    window.open(
      `${adjustedExplorer}token/${currentNft.contractAddress}`,
      '_blank',
      'noopener, noreferrer'
    );

  useEffect(() => {
    if (!copied) return;

    alert.info(t('home.contractCopied'));
  }, [copied, alert, t]);

  return (
    <>
      {currentNft?.contractAddress ? (
        <div className="pb-6">
          <div className="w-full flex flex-col items-center justify-center gap-y-4">
            {/* Collection Header */}
            <div className="w-full text-center mb-2">
              <h3 className="text-brand-white text-lg font-medium">
                {currentNft.name || t('send.nftCollection')}
              </h3>
              <p className="text-brand-gray200 text-sm">
                {currentNft.balance}{' '}
                {currentNft.balance === 1
                  ? t('nftDetails.item')
                  : t('nftDetails.items')}{' '}
                • {currentNft.tokenStandard || 'ERC-721'}
              </p>
            </div>

            {/* Token ID Display/Selector */}
            {currentNft?.tokenStandard === 'ERC-1155' ? (
              /* Show stored token ID for ERC-1155 */
              <div className="w-full">
                <label className="text-brand-gray200 text-xs mb-2 block">
                  {t('send.tokenId')}:
                </label>
                <div className="bg-bkg-2 border border-bkg-4 rounded-lg px-3 py-2">
                  <p className="text-brand-white text-sm font-medium">
                    #
                    {currentNft.tokenId && currentNft.tokenId.length > 20
                      ? ellipsis(currentNft.tokenId, 12, 8)
                      : currentNft.tokenId || ''}
                  </p>
                </div>
              </div>
            ) : (
              /* Token ID selector for ERC-721 */
              <div className="w-full">
                <label className="text-brand-gray200 text-xs mb-2 block">
                  {t('send.tokenId')}:
                </label>

                {/* Quick select from discovered tokens */}
                {nftTokenIds.length > 0 && (
                  <div className="mb-3">
                    <div className="flex flex-wrap gap-2 mb-2">
                      {nftTokenIds.map((token) => (
                        <button
                          key={token.tokenId}
                          onClick={() => {
                            setSelectedTokenId(token.tokenId);
                            setManualTokenId('');
                          }}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                            selectedTokenId === token.tokenId && !manualTokenId
                              ? 'bg-brand-royalblue text-white'
                              : 'bg-bkg-2 text-brand-gray200 hover:bg-bkg-3 hover:text-white border border-bkg-4'
                          }`}
                        >
                          #{token.tokenId}
                          {token.balance > 1 && ` (${token.balance}x)`}
                        </button>
                      ))}
                    </div>
                    {hasMoreTokens && (
                      <button
                        onClick={openCollectionOnExplorer}
                        className="text-brand-royalblue text-xs hover:underline flex items-center gap-1"
                      >
                        <span>{t('send.viewAllOnExplorer')}</span>
                        <ExternalLinkIcon size={12} />
                      </button>
                    )}
                  </div>
                )}

                {/* Manual token ID input */}
                <div className="relative">
                  <input
                    type="text"
                    value={manualTokenId}
                    onChange={(e) => handleManualTokenIdChange(e.target.value)}
                    placeholder={
                      isLoadingTokenIds ? 'Loading...' : t('send.enterTokenId')
                    }
                    disabled={isLoadingTokenIds}
                    className="w-full px-3 py-2 pr-12 bg-bkg-2 border border-bkg-4 rounded-lg text-brand-white text-sm
                           placeholder-brand-gray200 focus:border-brand-royalblue focus:outline-none
                           disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                  {/* Validation indicator */}
                  <div className="absolute right-4 top-1/2 transform -translate-y-1/2 flex items-center justify-center w-6 h-6">
                    {isVerifyingTokenId ? (
                      <LoadingOutlined className="text-brand-royalblue animate-spin text-base" />
                    ) : manualTokenId && verificationError ? (
                      <Icon
                        name="close-circle"
                        size={16}
                        className="text-red-500"
                      />
                    ) : manualTokenId &&
                      verifiedTokenBalance !== null &&
                      verifiedTokenBalance > 0 ? (
                      <Icon name="check" size={16} className="text-green-500" />
                    ) : null}
                  </div>
                </div>

                {/* Validation status messages */}
                {manualTokenId && !isVerifyingTokenId && verificationError && (
                  <div className="mt-2">
                    <p className="text-xs text-red-400 text-center">
                      ❌ {verificationError}
                    </p>
                  </div>
                )}

                <p className="text-brand-gray200 text-[10px] mt-1 text-center">
                  {verifiedTokenBalance !== null && verifiedTokenBalance > 0
                    ? t('send.selectTokenIdOrTryDifferent')
                    : t('send.enterNftTokenId')}
                  {hasMoreTokens && (
                    <>
                      <br />
                      {t('send.orEnterDifferentTokenId')}
                    </>
                  )}
                </p>
              </div>
            )}

            {/* NFT Image */}
            <div>
              <TokenIcon
                logo={getNftImage()}
                contractAddress={currentNft.contractAddress}
                symbol={currentNft.name || 'NFT'}
                isNft={true}
                size={153}
                className="rounded-[10px] object-cover"
                fallbackClassName="rounded-[10px]"
              />
            </div>

            <div className="w-full flex items-center justify-evenly h-14 font-poppins">
              <p className="flex flex-col items-center justify-evenly h-full font-medium text-base text-brand-white">
                {currentNft.balance}
                <span className="text-sm font-normal text-brand-gray200">
                  Amount
                </span>
              </p>
              <p className="flex flex-col items-center justify-evenly h-full font-medium text-base text-brand-white">
                {'No info'}
                <span className="text-sm font-normal text-brand-gray200">
                  {t('nftDetails.lastPrice')}
                </span>
              </p>
              <div className="flex flex-col items-center justify-evenly h-full font-medium text-base text-brand-white">
                <ChainIcon
                  chainId={Number(currentNft.chainId)}
                  size={28}
                  className=""
                  networkKind={INetworkType.Ethereum}
                />
                <span className="text-sm font-normal text-brand-gray200">
                  {t('nftDetails.network')}
                </span>
              </div>
            </div>
          </div>

          <div className="w-full flex flex-col gap-y-4 my-4">
            <div
              className="w-full bg-brand-blue800 flex flex-col items-start gap-y-3"
              style={{ borderRadius: '20px', padding: '17px 16px' }}
            >
              <p className="font-poppins font-bold text-base">
                {t('nftDetails.about')}
              </p>

              <p className="text-xs font-normal">
                {currentNft.name || t('send.nftCollection')}
              </p>

              <div className="w-full flex items-center text-xs font-normal gap-x-1.5">
                <p className="text-brand-gray200">
                  {t('nftDetails.tokenStandard')}
                </p>
                <span className="text-brand-white">
                  {currentNft.tokenStandard || 'ERC-721'}
                </span>
              </div>
            </div>

            {currentNft.name && (
              <div
                className="w-full bg-brand-blue800 flex flex-col items-start gap-y-3"
                style={{ borderRadius: '20px', padding: '17px 16px' }}
              >
                <p className="font-poppins font-bold text-base">
                  {t('nftDetails.collectionInfo')}
                </p>

                <div className="w-full flex items-center text-xs font-normal gap-x-1.5">
                  <TokenIcon
                    logo={currentNft.logo}
                    contractAddress={currentNft.contractAddress}
                    symbol={currentNft.name || 'NFT'}
                    isNft={true}
                    size={24}
                    className="rounded-full"
                  />

                  <span className="text-brand-gray200">{currentNft.name}</span>
                </div>
              </div>
            )}

            <div
              className="w-full bg-brand-blue800 flex flex-col items-start gap-y-3"
              style={{ borderRadius: '20px', padding: '17px 16px' }}
            >
              <p className="font-poppins font-bold text-base">
                {t('nftDetails.technicalInfo')}
              </p>

              <ul className="w-full">
                {displayTokenId && (
                  <li
                    className="flex items-center justify-between my-1 pl-0 pr-3 py-2 w-full text-xs border-b 
                    border-dashed border-bkg-white200 cursor-default transition-all duration-300"
                  >
                    <p className="font-normal text-xs">{t('send.tokenId')}</p>
                    <div className="flex items-center font-normal gap-x-1.5 text-xs">
                      <span className="text-brand-white">
                        {displayTokenId.length > 9
                          ? ellipsis(displayTokenId)
                          : displayTokenId}
                      </span>

                      <CopyIcon
                        size={15}
                        className="hover:text-brand-deepPink100 cursor-pointer"
                        color="text-brand-white"
                        onClick={() => copy(displayTokenId ?? '')}
                      />
                    </div>
                  </li>
                )}

                <li
                  className="flex items-center justify-between my-1 pl-0 pr-3 py-2 w-full text-xs  cursor-default transition-all duration-300 
                  border-none"
                >
                  <p className="font-normal text-xs">Contract Address</p>
                  <div className="flex items-center font-normal gap-x-1.5 text-xs">
                    <span className="text-brand-white">
                      {ellipsis(currentNft.contractAddress)}
                    </span>

                    <CopyIcon
                      size={15}
                      className="hover:text-brand-deepPink100 cursor-pointer"
                      color="text-brand-white"
                      onClick={() => copy(currentNft.contractAddress ?? '')}
                    />
                  </div>
                </li>
              </ul>
            </div>
          </div>

          <div className="w-full flex items-center justify-center text-brand-white hover:text-brand-deepPink100 my-6">
            <a
              href={`${adjustedExplorer}address/${currentNft.contractAddress}`}
              target="_blank"
              className="flex items-center justify-center gap-x-2"
              rel="noreferrer"
            >
              <ExternalLinkIcon size={16} />
              <span className="font-normal font-poppins underline text-sm">
                View on Explorer
              </span>
            </a>
          </div>
        </div>
      ) : null}
    </>
  );
};
