import React from 'react';

import placeholder from 'assets/all_assets/placeholder.png';
import { Tooltip } from 'components/index';

export const NftImage = ({ imageLink }: { imageLink: string }) => {
  const isClickable = Boolean(imageLink);
  return (
    <Tooltip content={isClickable ? 'Click to open NFT image' : ''}>
      <img
        src={`${imageLink ?? placeholder}`}
        alt={imageLink}
        className={`mb-8 mt-4 mx-auto w-40 h-40 rounded-md ${
          isClickable
            ? 'cursor-pointer transition-all duration-200'
            : 'cursor-default'
        }`}
        onClick={isClickable ? () => window.open(imageLink) : undefined}
      />
    </Tooltip>
  );
};
