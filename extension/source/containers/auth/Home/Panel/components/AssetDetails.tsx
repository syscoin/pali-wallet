import { useFormat } from 'hooks/index';
import React, { useEffect, useState } from 'react';
import placeholder from 'assets/images/placeholder.png';
import { Button, Tooltip } from 'components/index';
import axios from 'axios';

export const AssetDetails = ({
  assetType,
  assetData
}) => {
  const { formatURL } = useFormat();

  const [imageLink, setImageLink] = useState('');

  const {
    assetGuid,
    contract,
    symbol,
    totalSupply,
    maxSupply,
    decimals,
    updateCapabilityFlags,
    description
  } = assetData;

  useEffect(() => {
    const getImageLink = async () => {
      if (description && description.startsWith("https://ipfs.io/ipfs/")) {
        const response = await axios.get(description);

        setImageLink(response.data.image);
      }
    }

    getImageLink();
  }, [description]);

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
      value: formatURL(String(contract), 15),
    },
    {
      label: 'Symbol',
      value: symbol ? atob(String(symbol)) : '',
    },
    {
      label: 'Description',
      value: formatURL(description, 15)
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
      {imageLink ? (
        <Tooltip content="Click to open on IPFS">
          <img
            src={`${imageLink}`}
            alt="syscoin"
            className="mx-auto mt-4 mb-8 w-40 h-40 rounded-md transition-all duration-200 cursor-pointer"
            onClick={() => imageLink && window.open(imageLink)}
          />
        </Tooltip>
      ) : (
        <img
          src={`${placeholder}`}
          alt="syscoin"
          className="mx-auto mt-4 mb-8 w-40 h-40 rounded-md transition-all duration-200 cursor-not-allowed"
        />
      )}

      {assetTransaction.map(({ label, value }: any) => {
        return (
          <div
            key={label}
            className="my-1 py-2 px-2 w-full border-b border-dashed border-brand-navydark cursor-default flex justify-between items-center transition-all duration-300 bg-brand-navydarker hover:bg-brand-navydarker text-xs"
          >
            <p>{label}</p>
            <b>{value}</b>
          </div>
        );
      })}

      <div className="bg-brand-navyborder fixed gap-x-6 p-4 bottom-0 left-0 text-xs flex justify-between items-center">
        <p>
          Would you like to go to view asset on SYS Block Explorer?
        </p>

        <Button
          type="button"
          onClick={() => window.open('')}
          className="inline-flex justify-center px-6 py-1 text-sm font-medium text-brand-royalBlue bg-blue-100 border border-transparent rounded-full hover:bg-blue-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-brand-royalBlue"
        >
          Go
        </Button>
      </div>
    </>
  )
}