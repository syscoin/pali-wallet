import React, { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';

import { detectCollectibles } from '@pollum-io/sysweb3-utils';

import ethChainImg from 'assets/images/ethChain.svg';
import rolluxChainImg from 'assets/images/rolluxChain.png';
import sysChainImg from 'assets/images/sysChain.svg';
import { RootState } from 'state/store';

export const EvmNftsList = () => {
  const {
    accounts,
    activeAccount,
    activeNetwork: { chainId, url },
  } = useSelector((state: RootState) => state.vault);

  const [state, setState] = useState<any>();
  const [nftsGrouped, setNftsGrouped] = useState<Record<string, Array<any>>>(
    {}
  );

  const userAddress = accounts[activeAccount.type][activeAccount.id].address;

  const getUserNfts = async () => {
    try {
      const nfts = await detectCollectibles(userAddress, chainId, url);
      const groupSameCollection = (data) => {
        const grupos = {};

        data.forEach((item) => {
          const nome = item.address;

          if (!grupos[nome]) {
            grupos[nome] = [];
          }

          grupos[nome].push(item);
        });

        return grupos;
      };

      const grouped = groupSameCollection(nfts);

      setNftsGrouped(grouped);
      setState(nfts);
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
  }, [userAddress, chainId]);

  return (
    <div className="flex flex-col gap-6 mt-6">
      {state &&
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
