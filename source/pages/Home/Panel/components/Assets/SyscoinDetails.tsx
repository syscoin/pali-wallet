import { uniqueId } from 'lodash';
import React, { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { FiExternalLink as ExternalLinkIcon } from 'react-icons/fi';
import { useSelector } from 'react-redux';

import { NeutralButton } from 'components/index';
import { useUtils } from 'hooks/index';
import { RootState } from 'state/store';
import { formatCurrency, truncate, camelCaseToText } from 'utils/index';

export const SyscoinAssetDetais = ({ id }: { id: string }) => {
  const { navigate } = useUtils();

  const { accounts, activeAccount, activeNetwork } = useSelector(
    (state: RootState) => state.vault
  );

  const { t } = useTranslation();

  const { assets } = accounts[activeAccount.type][activeAccount.id];

  const formattedAsset = [];

  // Define the keys you are interested in
  const keysOfInterest = [
    'symbol',
    'totalReceived',
    'totalSent',
    'balance',
    'decimals',
  ];

  assets.syscoin?.find((asset: any) => {
    if (asset.assetGuid !== id) return null;

    for (const [key, value] of Object.entries(asset)) {
      // Check if the key is one of the keys of interest
      if (!keysOfInterest.includes(key)) continue;

      const formattedKey = camelCaseToText(key);
      const isValid = typeof value !== 'object';

      if (isValid) {
        // Create an object with the key and value and unshift it into the array
        const keyValueObject = {
          key: formattedKey, // Or use 'key' if you want the original key name
          value: value,
        };

        formattedAsset.unshift(keyValueObject);
      }
    }

    return formattedAsset;
  });

  const assetSymbol = formattedAsset.find((asset) => asset.key === 'Symbol');
  const assetDecimals = formattedAsset.find(
    (asset) => asset.key === 'Decimals'
  );

  const RenderAsset = () => (
    <>
      <div className="w-full flex items-center justify-center mt-1">
        <p className="font-poppins font-normal text-lg">{assetSymbol.value}</p>
      </div>

      <div className="mt-4 mb-6">
        {formattedAsset
          .filter((asset) => asset.key !== 'Symbol' && asset.key !== 'Decimals')
          .map((asset, index, totalArray) => (
            <Fragment key={uniqueId(id)}>
              <li
                className={`flex items-center justify-between my-1 pl-0 pr-3 py-2 w-full text-xs border-b 
              border-dashed border-bkg-white200 cursor-default transition-all duration-300 ${
                index + 1 === totalArray.length && 'border-none'
              } `}
              >
                <p className="font-normal text-xs">{asset.key}</p>
                <p className="flex items-center font-normal gap-x-1.5 text-xs">
                  <span className="text-brand-white">
                    {truncate(
                      formatCurrency(
                        String(asset.value / 10 ** assetDecimals.value),
                        assetDecimals.value
                      ),
                      5,
                      false
                    )}
                  </span>

                  <span className="text-brand-royalbluemedium">
                    {assetSymbol.value}
                  </span>
                </p>
              </li>
            </Fragment>
          ))}
      </div>

      <div className="w-full flex items-center justify-center text-brand-white hover:text-brand-deepPink100">
        <a
          href={`${activeNetwork.url}asset/${id}`}
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

      <div className="flex flex-col items-center justify-center w-full">
        <div className="w-full px-4 absolute bottom-12 md:static">
          <NeutralButton
            onClick={() => navigate('/home')}
            type="button"
            fullWidth={true}
          >
            {t('buttons.close')}
          </NeutralButton>
        </div>
      </div>
    </>
  );

  return <RenderAsset />;
};
