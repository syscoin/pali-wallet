import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import {
  getHomeBrowsingScope,
  useHomeBrowsingState,
} from '../../../useHomeBrowsingState';
import { ChainIcon } from 'components/ChainIcon';
import {
  FiExternalLink as ExternalLinkIcon,
  RiFileCopyLine as CopyIcon,
} from 'components/Icon/Icon';
import { LoadingOutlined } from 'components/Icon/Icon';
import { Icon } from 'components/Icon/Icon';
import { TokenIcon } from 'components/TokenIcon';
import { useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import { INetworkType } from 'types/network';
import { ellipsis } from 'utils/index';
import { NFT_FALLBACK_IMAGE } from 'utils/nftFallback';
import { getNftQuantity } from 'utils/nftQuantity';
import { normalizeNftTokenId } from 'utils/nftTokenId';
import { buildExplorerUrl } from 'utils/strings';

const renderNftSection = (title: string, children: React.ReactNode) => (
  <div
    className="w-full bg-brand-blue800 flex flex-col items-start gap-y-3"
    style={{ borderRadius: '20px', padding: '17px 16px' }}
  >
    <p className="font-poppins font-bold text-base">{title}</p>
    {children}
  </div>
);

const renderCopyRow = (
  className: string,
  label: string,
  value: string,
  copyLabel: string,
  onCopy: () => void
) => (
  <li className={className}>
    <p className="font-normal text-xs">{label}</p>
    <div className="flex items-center font-normal gap-x-1.5 text-xs">
      <span className="text-brand-white">{value}</span>
      <button
        type="button"
        aria-label={copyLabel}
        className="inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg text-brand-white hover:text-brand-deepPink100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-royalblue"
        onClick={onCopy}
      >
        <CopyIcon size={15} />
      </button>
    </div>
  </li>
);

export const NftsDetails = ({ nftData }: { nftData: any }) => {
  const { controllerEmitter } = useController();
  const { activeNetwork, activeAccount, accounts } = useSelector(
    (state: RootState) => state.vault
  );

  // Use proper selector for assets
  const currentAccount = accounts[activeAccount.type]?.[activeAccount.id];
  const explorer = activeNetwork.explorer || activeNetwork.url;

  const { alert } = useUtils();

  // Get NFT data from navigation state if available (for import preview/search results)
  const currentNft = nftData;
  const { exactQuantity, quantity, isSingle } = getNftQuantity(currentNft);
  const nftScope = `${getHomeBrowsingScope(
    { ...currentAccount, ...activeAccount },
    activeNetwork
  )}:${currentNft?.contractAddress}:${currentNft?.tokenStandard}`;

  const copyContextRef = useRef({ active: true, scope: nftScope });
  copyContextRef.current.scope = nftScope;
  const copySequenceRef = useRef(0);
  const [nftTokenIds, setNftTokenIds] = useState<
    { balance: number; tokenId: string }[]
  >([]);
  const [isLoadingTokenIds, setIsLoadingTokenIds] = useState(false);
  const [nftView, setNftView] = useHomeBrowsingState<{
    manualTokenId: string;
    selectedTokenId: string | null;
  }>('nftView', nftScope, {
    selectedTokenId: null,
    manualTokenId: '',
  });
  const { selectedTokenId, manualTokenId } = nftView;
  const setSelectedTokenId = (tokenId: string | null) =>
    setNftView((previous) => ({ ...previous, selectedTokenId: tokenId }));
  const setManualTokenId = (tokenId: string) =>
    setNftView((previous) => ({ ...previous, manualTokenId: tokenId }));
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
    let current = true;
    setNftTokenIds([]);
    setHasMoreTokens(false);
    if (
      !currentNft ||
      !currentAccount?.address ||
      currentNft.balance <= 0 ||
      currentNft.tokenStandard === 'ERC-1155'
    ) {
      setIsLoadingTokenIds(false);
      return;
    }

    setIsLoadingTokenIds(true);
    void (async () => {
      try {
        const result = (await controllerEmitter(
          ['wallet', 'fetchNftTokenIds'],
          [
            currentNft.contractAddress,
            currentAccount.address,
            currentNft.tokenStandard || 'ERC-721',
          ]
        )) as { balance: number; tokenId: string }[] & {
          hasMore?: boolean;
          requiresManualEntry?: boolean;
        };
        if (!current) return;
        setNftTokenIds(result || []);
        setHasMoreTokens(result?.hasMore || false);
        if (result?.length > 0 && !selectedTokenId && !manualTokenId) {
          setSelectedTokenId(result[0].tokenId);
        }
      } catch (error) {
        console.error('Error loading NFT token IDs:', error);
      } finally {
        if (current) setIsLoadingTokenIds(false);
      }
    })();
    return () => {
      current = false;
    };
  }, [nftScope, currentNft?.balance]);

  // Event handlers do not run returned cleanup functions. Own both the debounce
  // and in-flight result here so old edits, accounts and collections cannot
  // update the current token's ownership indicator.
  useEffect(() => {
    let current = true;
    const tokenId = manualTokenId.trim();
    setVerificationError(null);
    setVerifiedTokenBalance(null);
    if (currentNft?.tokenStandard === 'ERC-1155') {
      setVerifiedTokenBalance(currentNft.balance);
      setIsVerifyingTokenId(false);
      return;
    }
    if (!currentNft || !currentAccount?.address || !tokenId) {
      const selected = nftTokenIds.find(
        (token) => token.tokenId === selectedTokenId
      );
      setVerifiedTokenBalance(selected?.balance ?? null);
      setIsVerifyingTokenId(false);
      return;
    }
    setIsVerifyingTokenId(true);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const result = (await controllerEmitter(
            ['wallet', 'verifyERC721Ownership'],
            [currentNft.contractAddress, currentAccount.address, [tokenId]]
          )) as { balance: number; tokenId: string; verified: boolean }[];
          if (!current) return;
          const tokenInfo = result?.[0];
          if (tokenInfo?.verified && tokenInfo.balance > 0) {
            setVerifiedTokenBalance(tokenInfo.balance);
          } else {
            setVerifiedTokenBalance(0);
            setVerificationError(
              !tokenInfo
                ? t('send.tokenNotFound')
                : tokenInfo.verified && tokenInfo.balance === 0
                ? t('send.youDontOwnThisToken')
                : t('send.tokenVerificationFailed')
            );
          }
        } catch (error) {
          console.error('Error verifying token ID:', error);
          if (current) {
            setVerifiedTokenBalance(0);
            setVerificationError(t('send.verificationFailed'));
          }
        } finally {
          if (current) setIsVerifyingTokenId(false);
        }
      })();
    }, 500);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [
    manualTokenId,
    selectedTokenId,
    nftTokenIds,
    nftScope,
    currentNft?.balance,
  ]);

  // Handle manual token ID input with debounced verification
  const handleManualTokenIdChange = (value: string) => {
    setManualTokenId(value);
    setSelectedTokenId(value || null);
    setVerifiedTokenBalance(null);
    setVerificationError(null);
  };

  // Format affects field feedback only; ownership requests keep their existing path.
  const showTokenIdError = Boolean(
    manualTokenId && !isVerifyingTokenId && verificationError
  );
  const tokenIdFormatInvalid = (() => {
    if (!showTokenIdError) return false;
    try {
      normalizeNftTokenId(manualTokenId.trim());
      return false;
    } catch {
      return true;
    }
  })();

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

  const openCollectionOnExplorer = () =>
    window.open(
      buildExplorerUrl(explorer, 'token', currentNft.contractAddress),
      '_blank',
      'noopener, noreferrer'
    );

  useEffect(() => {
    copyContextRef.current.active = true;
    return () => {
      copyContextRef.current.active = false;
      copySequenceRef.current += 1;
    };
  }, []);

  const copy = async (value: string, successMessage: string) => {
    const scope = nftScope;
    const sequence = ++copySequenceRef.current;
    const isCurrent = () =>
      copyContextRef.current.active &&
      copyContextRef.current.scope === scope &&
      copySequenceRef.current === sequence;
    try {
      await navigator.clipboard.writeText(value);
      if (isCurrent()) alert.info(t(successMessage));
    } catch {
      if (isCurrent()) alert.error(t('transactions.copyFailed'));
    }
  };

  return (
    <>
      {currentNft?.contractAddress ? (
        <div className="w-full min-w-0 pb-6">
          <div className="w-full flex flex-col items-center justify-center gap-y-4">
            {/* Collection Header */}
            <div className="w-full text-center mb-2">
              <h3 className="break-words text-brand-white text-lg font-medium">
                {currentNft.name || t('send.nftCollection')}
              </h3>
              <p className="text-brand-gray200 text-sm" title={exactQuantity}>
                {quantity === undefined ? (
                  t('settings.unavailable')
                ) : (
                  <>
                    {quantity}{' '}
                    {isSingle ? t('nftDetails.item') : t('nftDetails.items')}
                  </>
                )}{' '}
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
                <label
                  htmlFor="nft-details-token-id"
                  className="text-brand-gray200 text-xs mb-2 block"
                >
                  {t('send.tokenId')}:
                </label>

                {/* Quick select from discovered tokens */}
                {nftTokenIds.length > 0 && (
                  <div className="mb-3">
                    <div className="flex flex-wrap gap-2 mb-2">
                      {nftTokenIds.map((token) => (
                        <button
                          key={token.tokenId}
                          type="button"
                          onClick={() => {
                            setSelectedTokenId(token.tokenId);
                            setManualTokenId('');
                          }}
                          className={`max-w-full break-all px-3 py-1.5 rounded-lg text-xs font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-royalblue ${
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
                        type="button"
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
                    id="nft-details-token-id"
                    type="text"
                    value={manualTokenId}
                    onChange={(e) => handleManualTokenIdChange(e.target.value)}
                    placeholder={
                      isLoadingTokenIds
                        ? t('buttons.loading')
                        : t('send.enterTokenId')
                    }
                    disabled={isLoadingTokenIds}
                    aria-describedby={
                      showTokenIdError
                        ? 'nft-details-token-id-help nft-details-token-id-error'
                        : 'nft-details-token-id-help'
                    }
                    aria-invalid={tokenIdFormatInvalid || undefined}
                    className="w-full px-3 py-2 pr-12 bg-bkg-2 border border-bkg-4 rounded-lg text-brand-white text-sm
                           placeholder-brand-gray200 focus:border-brand-royalblue focus:outline-none
                           disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                  {/* Validation indicator */}
                  <div className="pointer-events-none absolute right-4 top-1/2 transform -translate-y-1/2 flex items-center justify-center w-6 h-6">
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
                {showTokenIdError && (
                  <div className="mt-2">
                    <p
                      id="nft-details-token-id-error"
                      role="alert"
                      className="text-xs text-red-400 text-center"
                    >
                      ❌{' '}
                      {tokenIdFormatInvalid
                        ? t('send.invalidTokenId')
                        : verificationError}
                    </p>
                  </div>
                )}

                <p
                  id="nft-details-token-id-help"
                  className="text-brand-gray200 text-[10px] mt-1 text-center"
                >
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
              <p
                className="flex flex-col items-center justify-evenly h-full font-medium text-base text-brand-white"
                title={exactQuantity}
              >
                {quantity ?? t('settings.unavailable')}
                <span className="text-sm font-normal text-brand-gray200">
                  {t('send.amount')}
                </span>
              </p>
              <p className="flex flex-col items-center justify-evenly h-full font-medium text-base text-brand-white">
                {t('components.noInformation')}
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
            {renderNftSection(
              t('nftDetails.about'),
              <>
                <p className="max-w-full break-words text-xs font-normal">
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
              </>
            )}

            {currentNft.name &&
              renderNftSection(
                t('nftDetails.collectionInfo'),
                <div className="w-full flex items-center text-xs font-normal gap-x-1.5">
                  <TokenIcon
                    logo={currentNft.logo}
                    contractAddress={currentNft.contractAddress}
                    symbol={currentNft.name || 'NFT'}
                    isNft={true}
                    size={24}
                    className="rounded-full"
                  />

                  <span className="min-w-0 break-words text-brand-gray200">
                    {currentNft.name}
                  </span>
                </div>
              )}

            {renderNftSection(
              t('nftDetails.technicalInfo'),
              <ul className="w-full">
                {displayTokenId &&
                  renderCopyRow(
                    'flex items-center justify-between my-1 pl-0 pr-3 py-2 w-full text-xs border-b  border-dashed border-bkg-white200 cursor-default transition-all duration-300',
                    t('send.tokenId'),
                    displayTokenId.length > 9
                      ? ellipsis(displayTokenId)
                      : displayTokenId,
                    `${t('buttons.copy')} ${t('send.tokenId')}`,
                    () => void copy(displayTokenId, 'components.copied')
                  )}

                {renderCopyRow(
                  'flex items-center justify-between my-1 pl-0 pr-3 py-2 w-full text-xs  cursor-default transition-all duration-300  border-none',
                  t('settings.contractAddress'),
                  ellipsis(currentNft.contractAddress),
                  t('send.copyContractAddress'),
                  () =>
                    void copy(currentNft.contractAddress, 'home.contractCopied')
                )}
              </ul>
            )}
          </div>

          <div className="w-full flex items-center justify-center text-brand-white hover:text-brand-deepPink100 my-6">
            <a
              href={buildExplorerUrl(
                explorer,
                'address',
                currentNft.contractAddress
              )}
              target="_blank"
              className="flex items-center justify-center gap-x-2"
              rel="noreferrer"
            >
              <ExternalLinkIcon size={16} />
              <span className="font-normal font-poppins underline text-sm">
                {t('home.viewOnExplorer')}
              </span>
            </a>
          </div>
        </div>
      ) : (
        <p className="py-8 text-center text-brand-gray200">
          {t('tokens.assetNotFound')}
        </p>
      )}
    </>
  );
};
