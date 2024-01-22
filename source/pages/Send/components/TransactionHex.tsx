import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { useUtils } from 'hooks/useUtils';

interface ITransactionHexProps {
  dataHex: string;
  methodName: string;
}

export const TransactionHexComponent = (props: ITransactionHexProps) => {
  const { dataHex } = props;
  const { t } = useTranslation();

  const { useCopyClipboard, alert } = useUtils();

  const [copied, copy] = useCopyClipboard();

  useEffect(() => {
    if (!copied) return;

    alert.removeAll();
    alert.success(t('send.hexDataCopied'));
  }, [copied]);

  return (
    <div className="bg-brand-blue600 w-[400px] relative left-[-1%] flex flex-col items-center justify-center p-6 rounded-[20px]">
      <div
        className="cursor-pointer scrollbar-styled w-full max-h-32 text-xs rounded-xl overflow-y-auto hover:opacity-60"
        style={{ backgroundColor: 'rgba(22, 39, 66, 1)' }}
        onClick={() => copy(dataHex)}
      >
        <p
          className="w-full text-xs"
          style={{
            overflowWrap: 'break-word',
            wordBreak: 'break-all',
          }}
        >
          {dataHex}
        </p>
      </div>
    </div>
  );
};
