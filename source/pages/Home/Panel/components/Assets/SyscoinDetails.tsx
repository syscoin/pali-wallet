import { uniqueId } from 'lodash';
import React, { Fragment, useEffect } from 'react';

import { isNFT } from '@pollum-io/sysweb3-utils';

import { Icon } from 'components/Icon';
import { IconButton } from 'components/IconButton';
import { useUtils, useStore } from 'hooks/index';
import { camelCaseToText, formatUrl } from 'utils/format';

import { NftImage } from './NftImage';

export const SyscoinAssetDetais = ({ id }: { id: string }) => {
  const { useCopyClipboard, alert } = useUtils();
  const {
    activeAccount: { assets },
  } = useStore();

  const [copied, copy] = useCopyClipboard();

  useEffect(() => {
    if (!copied) return;

    alert.removeAll();
    alert.success('Guid successfully copied');
  }, [copied]);

  useEffect(() => {
    console.log({ assets });

    const selected = assets.find((asset: any) => asset.assetGuid === id);

    console.log({ selected });
  }, [assets]);

  const formattedAsset = [];

  assets.find((asset: any) => {
    if (asset.assetGuid !== id) return null;

    for (const [key, value] of Object.entries(asset)) {
      const formattedKey = camelCaseToText(key);
      const formattedBoolean = Boolean(value) ? 'Yes' : 'No';

      const formattedValue = {
        value: typeof value === 'boolean' ? formattedBoolean : value,
        label: formattedKey,
        canCopy: false,
        isNft: isNFT(Number(id)),
      };

      if (String(value).length >= 20 && key !== 'image') {
        formattedValue.value = formatUrl(String(value), 20);
        formattedValue.canCopy = true;
      }

      const isValid = typeof value !== 'object';

      if (isValid) formattedAsset.push(formattedValue);
    }

    return formattedAsset;
  });

  const RenderAsset = () => (
    <>
      {formattedAsset.map(({ label, isNft, value, canCopy }: any) => (
        <Fragment key={uniqueId(id)}>
          {label === 'Image' && isNft && <NftImage imageLink={value} />}

          {label.length > 0 && value !== undefined && label !== 'Image' && (
            <li className="flex items-center justify-between my-1 px-6 py-2 w-full text-xs border-b border-dashed border-bkg-2 cursor-default transition-all duration-300">
              <p>{label}</p>
              <span>
                <b>{value}</b>

                {canCopy && (
                  <IconButton onClick={() => copy(value ?? '')}>
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
      ))}
    </>
  );

  return <RenderAsset />;
};
