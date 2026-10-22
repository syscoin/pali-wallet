import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { useUtils } from 'hooks/useUtils';

interface ITransactionHexProps {
  dataHex: string;
}

export const TransactionHexComponent = (props: ITransactionHexProps) => {
  const { dataHex } = props;
  const { t } = useTranslation();

  const { useCopyClipboard, alert } = useUtils();

  const [copied, copy, isCurrentCopy] = useCopyClipboard(1000, dataHex);

  useEffect(() => {
    if (!copied) return;

    alert.info(t('send.hexDataCopied'), undefined, isCurrentCopy);
  }, [copied, alert, t, isCurrentCopy]);

  return (
    <div className="bg-brand-blue600 w-full max-w-[400px] mx-auto flex flex-col items-center justify-center p-6 rounded-[20px]">
      <button
        type="button"
        aria-label={t('buttons.copy')}
        className="cursor-pointer remove-scrollbar w-full max-h-32 text-left text-xs rounded-xl overflow-y-auto hover:opacity-60"
        style={{
          backgroundColor: 'rgba(22, 39, 66, 1)',
          overflowWrap: 'break-word',
          wordBreak: 'break-all',
        }}
        onClick={() => copy(dataHex)}
      >
        {dataHex}
      </button>
    </div>
  );
};
