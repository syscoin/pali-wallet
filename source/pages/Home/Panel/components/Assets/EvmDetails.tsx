import { uniqueId } from 'lodash';
import React, { Fragment, useEffect } from 'react';
import { useSelector } from 'react-redux';

import { Icon } from 'components/Icon';
import { IconButton } from 'components/IconButton';
import { useUtils } from 'hooks/index';
import { RootState } from 'state/store';
import { camelCaseToText, truncate } from 'utils/index';

import { NftImage } from './NftImage';

export const EvmAssetDetais = ({ id }: { id: string }) => {
  const assets = useSelector(
    (state: RootState) => state.vault.activeAccount.assets
  );
  const { useCopyClipboard, alert } = useUtils();

  const [copied, copy] = useCopyClipboard();

  useEffect(() => {
    if (!copied) return;

    alert.removeAll();
    alert.success('Contract successfully copied');
  }, [copied]);

  const formattedAsset = [];

  assets.ethereum?.find((asset: any) => {
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

  const RenderAsset = () => (
    <>
      {formattedAsset.map(({ label, value, canCopy }: any) => {
        const { formatted, stringValue } = value;
        const canRender =
          label.length > 0 && stringValue.length > 0 && formatted.length > 0;

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
    </>
  );

  return <RenderAsset />;
};
