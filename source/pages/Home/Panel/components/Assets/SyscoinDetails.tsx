import { uniqueId } from 'lodash';
import React, { Fragment, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { FiExternalLink as ExternalLinkIcon } from 'react-icons/fi';
import { FiCopy as CopyIcon } from 'react-icons/fi';
import { useSelector } from 'react-redux';

import { NeutralButton } from 'components/index';
import { useUtils } from 'hooks/index';
import { RootState } from 'state/store';
import {
  formatCurrency,
  truncate,
  camelCaseToText,
  syscoinKeysOfInterest,
  adjustUrl,
} from 'utils/index';

export const SyscoinAssetDetais = ({ id }: { id: string }) => {
  const { navigate, useCopyClipboard, alert } = useUtils();
  const [isCopied, copy] = useCopyClipboard();

  const { activeAccount, accountAssets, activeNetwork } = useSelector(
    (state: RootState) => state.vault
  );
  const accountAssetData = accountAssets[activeAccount.type]?.[
    activeAccount.id
  ] || { ethereum: [], syscoin: [], nfts: [] };

  const { t } = useTranslation();

  const asset = accountAssetData.syscoin?.find(
    (sysAsset: any) => sysAsset.assetGuid === id
  );

  const formattedAsset = [];
  const hasContract =
    asset?.contract &&
    asset.contract !== '0x0000000000000000000000000000000000000000';

  if (asset) {
    for (const [key, value] of Object.entries(asset)) {
      // Check if the key is one of the keys of interest
      if (!syscoinKeysOfInterest.includes(key)) continue;

      const formattedKey = camelCaseToText(key);
      const isValid =
        typeof value !== 'object' && value !== null && value !== '';

      if (isValid) {
        // Create an object with the key and value and unshift it into the array
        const keyValueObject = {
          key: formattedKey,
          value: value,
          originalKey: key,
        };

        formattedAsset.unshift(keyValueObject);
      }
    }
  }

  const assetSymbol = formattedAsset.find((item) => item.key === 'Symbol');
  const assetDecimals = formattedAsset.find((item) => item.key === 'Decimals');

  useEffect(() => {
    if (!isCopied) return;

    alert.info(t('home.contractCopied'));
  }, [isCopied, alert, t]);

  const RenderAsset = () => (
    <>
      <div className="w-full flex items-center justify-center mt-1">
        <p className="font-poppins font-normal text-lg">{assetSymbol.value}</p>
      </div>

      <div className="mt-4 mb-6">
        {formattedAsset
          .filter((item) => item.key !== 'Symbol' && item.key !== 'Decimals')
          .map((item, index, totalArray) => (
            <Fragment key={uniqueId(id)}>
              <li
                className={`flex items-center justify-between my-1 pl-0 pr-3 py-2 w-full text-xs border-b 
              border-dashed border-bkg-white200 cursor-default transition-all duration-300 ${
                index + 1 === totalArray.length && 'border-none'
              } `}
              >
                <p className="font-normal text-xs">{item.key}</p>
                {item.originalKey === 'contract' ? (
                  <div className="flex items-center gap-x-2">
                    <span className="text-brand-white text-xs">
                      {truncate(item.value, 10, true)}
                    </span>
                    <button
                      onClick={() => copy(item.value)}
                      className="text-brand-royalbluemedium hover:text-brand-deepPink100 transition-colors"
                      title="Copy contract address"
                    >
                      <CopyIcon size={14} />
                    </button>
                  </div>
                ) : item.originalKey === 'metaData' ? (
                  <p className="text-brand-white text-xs max-w-[200px] truncate">
                    {item.value}
                  </p>
                ) : (
                  <p className="flex items-center font-normal gap-x-1.5 text-xs">
                    <span className="text-brand-white">
                      {truncate(
                        formatCurrency(
                          String(item.value / 10 ** assetDecimals.value),
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
                )}
              </li>
            </Fragment>
          ))}
      </div>

      <div className="w-full flex flex-col items-center justify-center gap-y-2">
        <div className="text-brand-white hover:text-brand-deepPink100">
          <a
            href={`${adjustUrl(activeNetwork.url)}asset/${id}`}
            target="_blank"
            className="flex items-center justify-center gap-x-2"
            rel="noreferrer"
          >
            <ExternalLinkIcon size={16} />
            <span className="font-normal font-poppins underline text-sm">
              View on Syscoin Explorer
            </span>
          </a>
        </div>
        {hasContract && activeNetwork.url.includes('syscoin.org') && (
          <div className="text-brand-white hover:text-brand-deepPink100">
            <a
              href={`https://explorer.syscoin.org/address/${asset.contract}`}
              target="_blank"
              className="flex items-center justify-center gap-x-2"
              rel="noreferrer"
            >
              <ExternalLinkIcon size={16} />
              <span className="font-normal font-poppins underline text-sm">
                View on NEVM Explorer
              </span>
            </a>
          </div>
        )}
        {hasContract && activeNetwork.url.includes('tanenbaum') && (
          <div className="text-brand-white hover:text-brand-deepPink100">
            <a
              href={`https://explorer.tanenbaum.io/address/${asset.contract}`}
              target="_blank"
              className="flex items-center justify-center gap-x-2"
              rel="noreferrer"
            >
              <ExternalLinkIcon size={16} />
              <span className="font-normal font-poppins underline text-sm">
                View on NEVM Explorer
              </span>
            </a>
          </div>
        )}
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
