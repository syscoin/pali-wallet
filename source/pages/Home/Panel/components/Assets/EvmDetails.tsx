import { Disclosure } from '@headlessui/react';
import { uniqueId } from 'lodash';
import React, { Fragment, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { Icon } from 'components/Icon';
import { IconButton } from 'components/IconButton';
import { useUtils } from 'hooks/index';
import { RootState } from 'state/store';
import { IERC1155Collection } from 'types/tokens';
import { camelCaseToText, truncate } from 'utils/index';

import { NftImage } from './NftImage';

export const EvmAssetDetais = ({ id }: { id: string }) => {
  const { accounts, activeAccount } = useSelector(
    (state: RootState) => state.vault
  );
  const { assets } = accounts[activeAccount.type][activeAccount.id];
  const { useCopyClipboard, alert } = useUtils();
  const { t } = useTranslation();

  const [copied, copy] = useCopyClipboard();

  useEffect(() => {
    if (!copied) return;

    alert.removeAll();
    alert.success(t('home.contractCopied'));
  }, [copied]);

  const formattedAsset = [];

  const currentAsset = assets.ethereum.find((asset) => asset.id === id);

  assets.ethereum?.find((asset) => {
    if (asset.id !== id) return null;

    for (const [key, value] of Object.entries(asset)) {
      const formattedKey = camelCaseToText(key);
      const formattedBoolean = Boolean(value) ? 'Yes' : 'No';
      const formattedAndStringValue =
        typeof value === 'boolean' ? formattedBoolean : value;

      const formattedValue = {
        value: {
          formatted: formattedAndStringValue,
          stringValue: formattedAndStringValue,
        },
        label: formattedKey,
        canCopy: false,
        isNft: false,
      };

      if (key === 'isNft') {
        formattedValue.isNft = Boolean(value);
      }

      if (String(value).length >= 20) {
        formattedValue.value.formatted = truncate(String(value), 20);
        formattedValue.canCopy = true;
      }

      const isValid = typeof value !== 'object';

      if (isValid) formattedAsset.unshift(formattedValue);
    }

    return formattedAsset;
  });

  const RenderCollectionItem: React.FC<{ currentNft: IERC1155Collection }> = ({
    currentNft,
  }) => (
    <>
      <Fragment key={uniqueId(id)}>
        <li className="flex items-center justify-between my-1 pl-0 pr-3 py-2 w-full text-xs border-b border-dashed border-bkg-2 cursor-default transition-all duration-300">
          <p>{t('send.balance')}</p>
          <span>
            <b>{currentNft.balance}</b>
          </span>
        </li>

        <li className="flex items-center justify-between my-1 pl-0 pr-3 py-2 w-full text-xs border-b border-dashed border-bkg-2 cursor-default transition-all duration-300">
          <p>{t('settings.tokenName')}</p>
          <span>
            <b>{currentNft.tokenSymbol}</b>
          </span>
        </li>
      </Fragment>
    </>
  );

  const renderAssetsDisclosure = (NFT: IERC1155Collection) => {
    const { tokenId } = NFT;
    return (
      <Disclosure>
        {({ open }) => (
          <>
            <div className="px-6">
              <Disclosure.Button
                className={`${
                  open ? 'rounded-t-md' : 'rounded-md'
                } mt-3 py-2 px-2 flex justify-between items-center  w-full border border-bkg-3 bg-bkg-1 cursor-pointer transition-all duration-300 text-xs`}
              >
                {`Token ID #${tokenId}`}
                <Icon
                  name="select-down"
                  className={`${
                    open ? 'transform rotate-180' : ''
                  } mb-1 text-brand-white`}
                />
              </Disclosure.Button>
            </div>

            <div className="px-6">
              <Disclosure.Panel>
                <div className="flex flex-col pb-2 px-2 w-full text-brand-white text-sm bg-bkg-3 border border-t-0 border-bkg-4 rounded-lg rounded-t-none transition-all duration-300">
                  <RenderCollectionItem currentNft={NFT} />
                </div>
              </Disclosure.Panel>
            </div>
          </>
        )}
      </Disclosure>
    );
  };

  const RenderAsset = () => (
    <>
      {formattedAsset.map(({ label, value, canCopy }: any) => {
        const { formatted, stringValue } = value;
        const canRender =
          label.length > 0 &&
          label !== 'Edited Symbol To Use' &&
          stringValue.length > 0 &&
          formatted.length > 0;

        return (
          <Fragment key={uniqueId(id)}>
            {label === 'Image' && <NftImage imageLink={stringValue} />}

            {canRender && (
              <li className="flex items-center justify-between my-1 pl-0 pr-3 py-2 w-full text-xs border-b border-dashed border-bkg-2 cursor-default transition-all duration-300">
                <p>{label}</p>
                <span>
                  <b>{formatted}</b>

                  {canCopy && (
                    <IconButton onClick={() => copy(stringValue ?? '')}>
                      <Icon
                        name="copy"
                        className="px-1 text-brand-white hover:text-fields-input-borderfocus"
                      />
                    </IconButton>
                  )}
                </span>
              </li>
            )}
          </Fragment>
        );
      })}

      {currentAsset?.is1155 &&
        currentAsset.collection.map((nft) => renderAssetsDisclosure(nft))}
    </>
  );

  return <RenderAsset />;
};
