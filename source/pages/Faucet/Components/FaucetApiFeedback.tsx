import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { StatusModal } from 'components/Modal/StatusModal';

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
  const [isCopied, setIsCopied] = useState<boolean>(false);
  const { t } = useTranslation();

  const handleCopyToClipboard = () => {
    setIsCopied(!isCopied);
    navigator.clipboard.writeText(apiResponse);
  };

  useEffect(() => {
    const timeoutDuration = 1000;
    const timeoutId = setTimeout(() => {
      setIsCopied(false);
    }, timeoutDuration);

    return () => clearTimeout(timeoutId);
  }, [isCopied]);

  return (
    <>
      <StatusModal
        status="success"
        show={isCopied}
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
