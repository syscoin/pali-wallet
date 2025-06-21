import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useSelector } from 'react-redux';

import { INftsStructure } from '@pollum-io/sysweb3-utils';

import { ChainIcon } from 'components/ChainIcon';
import { useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import { selectActiveAccountWithAssets } from 'state/vault/selectors';
import { nftsVideoFormats } from 'utils/index';
import { NFT_FALLBACK_IMAGE } from 'utils/nftFallback';

export const EvmNftsList = () => {
  const { controllerEmitter } = useController();
  const { navigate } = useUtils();

  const { activeNetwork } = useSelector((state: RootState) => state.vault);
  const { account: activeAccount, assets: accountAssets } = useSelector(
    selectActiveAccountWithAssets
  );

  const [nftsGrouped, setNftsGrouped] = useState<Record<string, Array<any>>>(
    {}
  );

  // ✅ MEMOIZED: NFT fetching function
  const getUserNfts = useCallback(async () => {
    try {
      await controllerEmitter(
        ['wallet', 'fetchAndUpdateNftsState'],
        [{ activeAccount, activeNetwork }]
      );
    } catch (error) {
      console.error('Error on get NFTs:', error);
    }
  }, [controllerEmitter, activeAccount, activeNetwork]);

  // ✅ MEMOIZED: Grouping function
  const groupSameCollection = useCallback((nfts: INftsStructure[]) => {
    const groups = {};

    nfts.forEach((item) => {
      const name = item.address;

      if (!groups[name]) {
        groups[name] = [];
      }

      groups[name].push(item);
    });

    setNftsGrouped(groups);
  }, []);

  // ✅ MEMOIZED: Navigation handler
  const handleNavigateToNftDetail = useCallback(
    (tokenId: string, address: string) => {
      navigate('/home/details', {
        state: {
          nftId: tokenId,
          nftAddress: address,
        },
      });
    },
    [navigate]
  );

  // ✅ OPTIMIZED: Fetch NFTs only when necessary dependencies change
  useEffect(() => {
    if (activeAccount?.address && activeNetwork?.chainId) {
      getUserNfts();
    }
  }, [activeAccount?.address, activeNetwork?.chainId, getUserNfts]);

  // ✅ OPTIMIZED: Filter and group NFTs when data changes
  const filteredNfts = useMemo(
    () =>
      accountAssets.nfts.filter(
        (nft) => Number(nft.chainId) === activeNetwork.chainId
      ),
    [accountAssets.nfts, activeNetwork.chainId]
  );

  useEffect(() => {
    groupSameCollection(filteredNfts);
  }, [filteredNfts, groupSameCollection]);

  // ✅ MEMOIZED: Render NFT item to prevent recreation
  const renderNftItem = useCallback(
    (data: any, index: number) => (
      <div key={index} className="rounded-[10px] overflow-hidden">
        {nftsVideoFormats.some((format) =>
          data.image_preview_url.endsWith(format)
        ) ? (
          <video
            className="max-w-none w-[153px] h-[153px] hover:cursor-pointer"
            autoPlay
            muted
            loop
            onClick={() =>
              handleNavigateToNftDetail(data.token_id, data.address)
            }
          >
            <source src={data.image_preview_url} type="video/mp4" />
            Video not supported
          </video>
        ) : (
          <img
            id="nft-image"
            className="rounded-[10px] w-[153px] h-[153px] cursor-pointer"
            onClick={() =>
              handleNavigateToNftDetail(data.token_id, data.address)
            }
            src={data?.image_preview_url}
          />
        )}
      </div>
    ),
    [handleNavigateToNftDetail]
  );

  return (
    <div className="flex flex-col gap-6 mt-6">
      {accountAssets.nfts &&
        Object.entries(nftsGrouped).map(([collections, nfts]) => (
          <div
            key={collections}
            className="w-full flex flex-col gap-2 items-start"
          >
            <div
              id="nft-collection-name"
              className="flex items-center gap-[22px]"
            >
              {nfts.length > 0 && (
                <div className="relative">
                  <img
                    className="w-[35px] h-[35px] rounded-[100px]"
                    src={nfts[0]?.collection?.image_url || NFT_FALLBACK_IMAGE}
                  />
                  <div className="absolute top-[18px] left-[24px]">
                    <ChainIcon
                      chainId={nfts[0]?.chainId}
                      size={17}
                      className=""
                    />
                  </div>
                </div>
              )}
              <div className="text-sm font-medium text-white">
                {nfts[0]?.collection?.name}
              </div>
            </div>

            <div className="flex gap-2 items-start flex-wrap">
              {nfts.map(renderNftItem)}
            </div>
            <div id="nft-by" className="overflow-hidden max-w-[100px]">
              <p className="text-brand-gray200 text-xs overflow-hidden whitespace-nowrap">
                Post by @{nfts[0]?.creator?.user?.username}
              </p>
            </div>
            <div className="flex items-center justify-between w-full gap-x-2 text-xs font-poppins">
              <p className="text-brand-gray200 font-normal">{collections}</p>

              <ChainIcon chainId={nfts[0]?.chainId} size={20} className="" />
            </div>
          </div>
        ))}
    </div>
  );
};
