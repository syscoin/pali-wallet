import React, { useEffect, useState } from 'react';
import placeholder from 'assets/images/placeholder.png';
import { Tooltip, Icon } from 'components/index';
import { formatUrl } from 'utils/index';
import { useStore } from 'hooks/index';
import axios from 'axios';

export const AssetDetails = ({
  assetType,
  assetData,
}: {
  assetData: any;
  assetType?: string;
}) => {
  const [imageLink, setImageLink] = useState('');
  const [loadingImage, setLoadingImage] = useState(false);

  const { activeNetwork, networks } = useStore();

  const isSyscoinChain = Boolean(networks.syscoin[activeNetwork.chainId]);

  const {
    assetGuid,
    contract,
    symbol,
    totalSupply,
    maxSupply,
    decimals,
    updateCapabilityFlags,
    description,
  } = assetData;

  useEffect(() => {
    const getImageLink = async () => {
      if (description && description.startsWith('https://ipfs.io/ipfs/')) {
        setLoadingImage(true);

        const response = await axios.get(description);

        setImageLink(response.data.image);
        setLoadingImage(false);
      }
    };

    getImageLink();
  }, [description]);

  const sysAssetDetails = [
    {
      label: 'Asset Guid',
      value: assetGuid,
    },
    {
      label: 'Type',
      value: assetType,
    },
    {
      label: 'Contract',
      value: formatUrl(String(contract), 15),
    },
    {
      label: 'Symbol',
      value: symbol ? atob(String(symbol)) : '',
    },
    {
      label: 'Description',
      value: formatUrl(description, 15),
    },
    {
      label: 'Total supply',
      value: totalSupply / 10 ** Number(decimals),
    },
    {
      label: 'Max supply',
      value: maxSupply / 10 ** Number(decimals),
    },
    {
      label: 'Decimals',
      value: decimals,
    },
    {
      label: 'Capability flags',
      value: updateCapabilityFlags,
    },
  ];

  const ethAssetDetails = [
    {
      label: 'Name',
      value: 'name',
    },
    {
      label: 'Symbol',
      value: symbol,
    },
    {
      label: 'Contract',
      value: formatUrl(String('asdasd'), 15),
    },
    {
      label: 'Decimals',
      value: decimals,
    },
    {
      label: 'Description',
      value: formatUrl('description', 15),
    },
  ];

  const renderAssets = (detailsArray: { label: string; value: any }[]) => {
    detailsArray.map(({ label, value }: any) => (
      <div
        key={label}
        className="flex items-center justify-between my-1 px-6 py-2 w-full text-xs border-b border-dashed border-bkg-2 cursor-default transition-all duration-300"
      >
        <p>{label}</p>
        <b>{value}</b>
      </div>
    ));
  };

  return (
    <>
      {isSyscoinChain && (
        <>
          {imageLink && !loadingImage ? (
            <Tooltip content="Click to open on IPFS">
              <img
                src={`${imageLink}`}
                alt="syscoin"
                className="mb-8 mt-4 mx-auto w-40 h-40 rounded-md cursor-pointer transition-all duration-200"
                onClick={() => imageLink && window.open(imageLink)}
              />
            </Tooltip>
          ) : (
            <>
              {loadingImage ? (
                <div className="flex items-center justify-center h-40">
                  <Icon
                    name="loading"
                    className="text-brand-royalblue"
                    size={50}
                  />
                </div>
              ) : (
                <img
                  src={`${placeholder}`}
                  alt="syscoin"
                  className="mb-8 mt-4 mx-auto w-40 h-40 rounded-md cursor-not-allowed transition-all duration-200"
                />
              )}
            </>
          )}
        </>
      )}

      {renderAssets(isSyscoinChain ? sysAssetDetails : ethAssetDetails)}
    </>
  );
};
