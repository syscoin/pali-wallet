import { ethers, utils } from 'ethers';
import React, { useEffect } from 'react';

import { Icon } from 'components/Icon';
import { IconButton } from 'components/IconButton';
import { useUtils } from 'hooks/useUtils';

interface ITransactionHexProps {
  dataHex: string;
  methodName: string;
}

export const TransactionHexComponent = (props: ITransactionHexProps) => {
  const { methodName, dataHex } = props;

  const { useCopyClipboard, alert } = useUtils();

  const [copied, copy] = useCopyClipboard();

  const hexBytesLength = utils.hexDataLength(dataHex);

  useEffect(() => {
    if (!copied) return;

    alert.removeAll();
    alert.success('HEX data successfully copied!');
  }, [copied]);

  return (
    <div className="flex flex-col items-center justify-center w-full">
      <div className="flex flex-col gap-2 items-center justify-center w-full">
        <p className="flex gap-1.5 items-center justify-start w-full text-sm">
          Method:
          <span className="text-brand-royalblue font-bold">{methodName}</span>
        </p>

        <p className="flex gap-1.5 items-center justify-start w-full text-sm">
          HEX Data:
          <span className="text-brand-royalblue">{hexBytesLength} BYTES</span>
        </p>
      </div>

      <div
        className="scrollbar-styled mb-3 mt-2 p-3 w-full max-h-32 text-xs rounded-xl overflow-y-auto"
        style={{ backgroundColor: 'rgba(22, 39, 66, 1)' }}
      >
        <p
          className="w-full"
          style={{
            overflowWrap: 'break-word',
            wordBreak: 'break-all',
          }}
        >
          {dataHex}
        </p>
      </div>

      <div
        className="flex items-center justify-center mb-2 w-full text-sm cursor-pointer"
        onClick={() => copy(dataHex)}
      >
        <IconButton>
          <Icon
            name="copy"
            className="px-1 text-brand-white hover:text-fields-input-borderfocus"
          />
        </IconButton>
        <span>Copy transaction HEX data</span>
      </div>
    </div>
  );
};
