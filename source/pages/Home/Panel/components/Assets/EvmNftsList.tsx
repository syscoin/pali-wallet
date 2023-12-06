import React, { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';

import ethChainImg from 'assets/images/ethChain.svg';
import rolluxChainImg from 'assets/images/rolluxChain.png';
import sysChainImg from 'assets/images/sysChain.svg';
import { RootState } from 'state/store';
import { getController } from 'utils/browser';

export const EvmNftsList = () => {
  const controller = getController();

  const { accounts, activeAccount, activeNetwork } = useSelector(
    (state: RootState) => state.vault
  );

  const [nftsGrouped, setNftsGrouped] = useState<Record<string, Array<any>>>(
    {}
  );

  const userAccount = accounts[activeAccount.type][activeAccount.id];

  const getUserNfts = async () => {
    try {
      await controller.wallet.fetchAndUpdateNftsState({
        activeAccount,
        activeNetwork,
      });

      const groupSameCollection = (data) => {
        const groups = {};

        data.forEach((item) => {
          const name = item.address;

          if (!groups[name]) {
            groups[name] = [];
          }

          groups[name].push(item);
        });

        return groups;
      };

      const grouped = groupSameCollection(userAccount.assets.nfts);

      setNftsGrouped(grouped);
    } catch (error) {
      console.error('Erro ao obter NFTs:', error);
    }
  };

  const getChainImage = (chain) => {
    let chainImage: string;

    switch (chain) {
      case 1:
        chainImage = ethChainImg;
        break;
      case 57:
        chainImage = sysChainImg;
        break;
      case 570:
        chainImage = rolluxChainImg;
        break;
      case 5700:
        chainImage = rolluxChainImg;
        break;
      default:
        <div
          className="rounded-full flex items-center justify-center text-brand-blue200 bg-white text-sm"
          style={{ width: '100px', height: '100px' }}
        ></div>;
    }
    return chainImage;
  };

  useEffect(() => {
    getUserNfts();
  }, [userAccount.address, activeNetwork.chainId]);

  return (
    <div className="flex flex-col gap-6 mt-6">
      {userAccount.assets.nfts &&
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
                    src={nfts[0]?.collection?.image_url}
                  />
                  <img
                    className="absolute top-[18px] left-[24px] w-[17.246px] h-[17.246px] rounded-[100px]"
                    src={getChainImage(nfts[0]?.chainId)}
                  />
                </div>
              )}
              <div className="text-sm font-medium text-white">
                {nfts[0]?.collection?.name}
              </div>
            </div>
            <div className="flex gap-2 items-start">
              {nfts.map((data, index) => (
                <img
                  key={index}
                  id="nft-image"
                  className="rounded-[10px] w-[153px] h-[153px]"
                  src={data?.image_preview_url}
                />
              ))}
            </div>
            <div id="nft-by" className="overflow-hidden max-w-[100px]">
              <p className="text-brand-gray200 text-xs overflow-hidden whitespace-nowrap">
                Post by @{nfts[0]?.creator?.user?.username}
              </p>
            </div>
          </div>
        ))}
    </div>
  );
};
