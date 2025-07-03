import { LoadingOutlined } from '@ant-design/icons';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FiExternalLink as ExternalLinkIcon } from 'react-icons/fi';
import { RiFileCopyLine as CopyIcon } from 'react-icons/ri';
import { useSelector } from 'react-redux';

import { ChainIcon } from 'components/ChainIcon';
import { Icon } from 'components/Icon/Icon';
import { useUtils, useAdjustedExplorer } from 'hooks/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import { selectActiveAccountAssets } from 'state/vault/selectors';
import { ellipsis } from 'utils/index';
import { NFT_FALLBACK_IMAGE } from 'utils/nftFallback';
import { getNftAssetsFromEthereum } from 'utils/nftToAsset';

export const NftsDetails = ({ nftAddress }: { nftAddress: string }) => {
  const { controllerEmitter } = useController();
  const {
    activeNetwork: { explorer, chainId },
    activeAccount,
    accounts,
  } = useSelector((state: RootState) => state.vault);

  // Use proper selector for assets
  const accountAssets = useSelector(selectActiveAccountAssets);
  const currentAccount = accounts[activeAccount.type][activeAccount.id];

  const { useCopyClipboard, alert } = useUtils();

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

  // Find NFT collection from ethereum assets array
  const nftAssets = getNftAssetsFromEthereum(accountAssets.ethereum, chainId);
  const currentNft = nftAssets.find(
    (nft) => nft.contractAddress === nftAddress
  );

  // Load token IDs when component mounts (only if no specific tokenId provided)
  useEffect(() => {
    if (currentNft && currentNft.balance > 0) {
      loadTokenIds();
    }
  }, [nftAddress, currentNft]);

  // Verify manually entered token ID
  const verifyTokenId = async (tokenId: string) => {
    if (!currentNft || !currentAccount.address || !tokenId.trim()) {
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
        [currentNft.contractAddress, currentAccount.address, [tokenId]]
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
    if (!currentNft || !currentAccount.address) return;

    setIsLoadingTokenIds(true);
    try {
      const result = (await controllerEmitter(
        ['wallet', 'fetchNftTokenIds'],
        [
          nftAddress,
          currentAccount.address,
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

  // Get display token ID (from selection or manual input)
  const displayTokenId = manualTokenId || selectedTokenId;

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

            {/* Token ID Selector */}
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
                  : currentNft.tokenStandard === 'ERC-1155'
                  ? t('send.erc1155RequiresManualEntry')
                  : t('send.enterNftTokenId')}
                {hasMoreTokens && (
                  <>
                    <br />
                    {t('send.orEnterDifferentTokenId')}
                  </>
                )}
              </p>
            </div>

            {/* NFT Image */}
            <div>
              <img
                id={`${currentNft.name}`}
                className="rounded-[10px] w-[153px] h-[153px] object-cover"
                src={getNftImage()}
                alt={currentNft.name || `NFT #${displayTokenId || ''}`}
                onError={(e) => {
                  (e.target as HTMLImageElement).src = NFT_FALLBACK_IMAGE;
                }}
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
              <p className="flex flex-col items-center justify-evenly h-full font-medium text-base text-brand-white">
                <ChainIcon
                  chainId={Number(currentNft.chainId)}
                  size={28}
                  className=""
                />
                <span className="text-sm font-normal text-brand-gray200">
                  {t('nftDetails.network')}
                </span>
              </p>
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
                  <img
                    className="w-6 h-6 rounded-full"
                    src={currentNft.logo || NFT_FALLBACK_IMAGE}
                    alt={currentNft.name}
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
                    <p className="flex items-center font-normal gap-x-1.5 text-xs">
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
                    </p>
                  </li>
                )}

                <li
                  className="flex items-center justify-between my-1 pl-0 pr-3 py-2 w-full text-xs  cursor-default transition-all duration-300 
                  border-none"
                >
                  <p className="font-normal text-xs">Contract Address</p>
                  <p className="flex items-center font-normal gap-x-1.5 text-xs">
                    <span className="text-brand-white">
                      {ellipsis(currentNft.contractAddress)}
                    </span>

                    <CopyIcon
                      size={15}
                      className="hover:text-brand-deepPink100 cursor-pointer"
                      color="text-brand-white"
                      onClick={() => copy(currentNft.contractAddress ?? '')}
                    />
                  </p>
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
