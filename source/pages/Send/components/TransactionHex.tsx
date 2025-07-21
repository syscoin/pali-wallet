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

    alert.info(t('send.hexDataCopied'));
  }, [copied, alert, t]);

  return (
    <div className="bg-brand-blue600 w-full max-w-[400px] mx-auto flex flex-col items-center justify-center p-6 rounded-[20px]">
      <div
        className="cursor-pointer remove-scrollbar w-full max-h-32 text-xs rounded-xl overflow-y-auto hover:opacity-60"
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
