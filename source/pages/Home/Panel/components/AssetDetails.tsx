import React, { useEffect, useState } from 'react';
import { Button, Tooltip, Icon } from 'components/index';
import { formatUrl } from 'utils/index';
import { getController } from 'utils/browser';
import axios from 'axios';

export const AssetDetails = ({ assetType, assetData }) => {
  const controller = getController();

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

  const hasImage = description.startsWith('https://ipfs.io/ipfs/');
  const [imageLink, setImageLink] = useState<string>();

  const getImageLink = async () => {
    if (!hasImage) return;

    const response = await axios.get(description);
    setImageLink(response.data.image);
  };

  useEffect(() => {
    getImageLink();
  }, [hasImage]);

  const sysExplorer = controller.wallet.account.getSysExplorerSearch();

  const assetTransaction = [
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

  return (
    <>
      {hasImage && !imageLink && (
        <div className="flex items-center justify-center h-40">
          <Icon name="loading" className="text-brand-royalblue" size={50} />
        </div>
      )}
      {imageLink && (
        <Tooltip content="Click to open on IPFS">
          <img
            src={`${imageLink}`}
            alt="syscoin"
            className="mb-8 mt-4 mx-auto w-40 h-40 rounded-md cursor-pointer transition-all duration-200"
            onClick={() => imageLink && window.open(imageLink)}
          />
        </Tooltip>
      )}

      {assetTransaction.map(({ label, value }: any) => (
        <div
          key={label}
          className="flex items-center justify-between my-1 px-6 py-2 w-full text-xs border-b border-dashed border-bkg-2 cursor-default transition-all duration-300"
        >
          <p>{label}</p>
          <b>{value}</b>
        </div>
      ))}

      <div className="fixed bottom-0 left-0 flex gap-x-6 items-center justify-between p-4 w-full max-w-2xl text-xs bg-bkg-3 md:left-auto xl:mt-2">
        <p>Would you like to go to view asset on SYS Block Explorer?</p>

        <Button
          type="button"
          onClick={() => window.open(`${sysExplorer}/asset/${assetGuid}`)}
          className="inline-flex justify-center px-6 py-1 hover:text-brand-royalblue text-brand-white text-sm font-medium hover:bg-button-popuphover bg-transparent border border-brand-white rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-royalblue focus-visible:ring-offset-2"
        >
          Go
        </Button>
      </div>
    </>
  );
};
