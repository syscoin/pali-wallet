import { uniqueId } from 'lodash';
import React, { Fragment, useEffect } from 'react';
import { RiFileCopyLine } from 'react-icons/ri';
import { useSelector } from 'react-redux';

import { IconButton } from 'components/IconButton';
import { useUtils } from 'hooks/index';
import { RootState } from 'state/store';
import { camelCaseToText, truncate } from 'utils/format';

import { NftImage } from './NftImage';

export const SyscoinAssetDetais = ({ id }: { id: string }) => {
  const { useCopyClipboard, alert } = useUtils();
  const assets = useSelector(
    (state: RootState) => state.vault.activeAccount.assets
  );

  const [copied, copy] = useCopyClipboard();

  useEffect(() => {
    if (!copied) return;

    alert.removeAll();
    alert.success('Successfully copied');
  }, [copied]);

  const formattedAsset = [];

  assets.syscoin?.find((asset: any) => {
    if (asset.assetGuid !== id) return null;

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
      };

      if (String(value).length >= 20) {
        formattedValue.value.formatted = truncate(String(value), 20);
        formattedValue.canCopy = true;
      }

      const isValid = typeof value !== 'object';

      if (isValid) formattedAsset.unshift(formattedValue);
    }

    return formattedAsset;
  });

  const RenderAsset = () => (
    <>
      {formattedAsset.map(
        ({ label, value, canCopy }: any, index, totalArray) => {
          const { formatted, stringValue } = value;
          const canRender =
            label.length > 0 && stringValue.length > 0 && formatted.length > 0;

          return (
            <Fragment key={uniqueId(id)}>
              {label === 'Image' && canRender && (
                <NftImage imageLink={stringValue} />
              )}

              {canRender && (
                <li
                  className={`flex items-center justify-between my-1 pl-0 pr-3 py-2 w-full text-xs border-b 
              border-dashed border-bkg-white200 cursor-default transition-all duration-300 ${
                index + 1 === totalArray.length && 'mb-20'
              } `}
                >
                  <p className="font-normal">{label}</p>
                  <span className="flex items-center font-medium">
                    {formatted}

                    {canCopy && (
                      <IconButton
                        onClick={() => copy(stringValue ?? '')}
                        className="ml-1"
                      >
                        <RiFileCopyLine size={15} color="text-brand-white" />
                      </IconButton>
                    )}
                  </span>
                </li>
              )}
            </Fragment>
          );
        }
      )}
    </>
  );

  return <RenderAsset />;
};
