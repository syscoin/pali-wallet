import React from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

type PaymasterSetupStatus = 'approving' | 'idle' | 'ready';

export const PaymasterSetupStatusBanner: React.FC<{
  context: 'calls' | 'transaction';
  status: PaymasterSetupStatus;
}> = ({ context, status }) => {
  const { t } = useTranslation();

  if (status === 'idle') return null;

  const title =
    status === 'approving'
      ? t('send.paymasterApprovalApproving')
      : context === 'calls'
      ? t('send.paymasterApprovalReadyCalls')
      : t('send.paymasterApprovalReadyTransaction');

  return createPortal(
    <div className="fixed inset-x-0 bottom-24 z-[90] flex justify-center px-4 pointer-events-none">
      <div
        className="flex items-center gap-3 w-full max-w-[22rem] px-4 py-3 rounded-[10px] bg-brand-blue600 border border-alpha-whiteAlpha300 shadow-lg animate-fadeIn"
        data-testid="paymaster-setup-status-banner"
      >
        <span className="relative flex h-3 w-3 shrink-0">
          {status === 'approving' && (
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-royalblue opacity-75" />
          )}
          <span
            className={`relative inline-flex rounded-full h-3 w-3 ${
              status === 'approving' ? 'bg-brand-royalblue' : 'bg-brand-green'
            }`}
          />
        </span>
        <span className="text-sm font-medium text-white">{title}</span>
      </div>
    </div>,
    document.body
  );
};
