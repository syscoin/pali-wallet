import React from 'react';
import { useTranslation } from 'react-i18next';

import { StatusModal } from 'components/Modal/StatusModal';
import { useUtils } from 'hooks/useUtils';

type FaucetApiFeedbackProps = {
  apiResponse: string;
  apiTitle: string;
  status?: string;
};
export const FaucetApiFeedback: React.FC<FaucetApiFeedbackProps> = ({
  apiTitle,
  apiResponse,
  status,
}) => {
  const { useCopyClipboard } = useUtils();
  const { t } = useTranslation();

  const [copied, copyText] = useCopyClipboard();

  const handleCopyToClipboard = () => copyText(apiResponse);

  return (
    <>
      <StatusModal
        status="success"
        show={copied}
        title={t(`settings.successfullyCopied`)}
        description=""
      />
      <div className="gap-1 w-[352px] h-[76px] flex flex-col mt-6 rounded-[20px] p-4 border border-dashed border-alpha-whiteAlpha300 bg-alpha-whiteAlpha100">
        <h1 className="text-white text-sm">{apiTitle}</h1>
        <p
          onClick={() => (status ? handleCopyToClipboard() : null)}
          className="text-white text-sm underline overflow-hidden"
          style={{
            cursor: status ? 'pointer' : 'default',
          }}
        >
          {apiResponse}
        </p>
      </div>
    </>
  );
};
