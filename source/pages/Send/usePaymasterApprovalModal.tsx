import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ConfirmationModal } from 'components/index';
import type { SmartAccountPaymasterApprovalSetup } from 'utils/smartAccount';

type PendingApproval = {
  resolve: (approved: boolean) => void;
  token: string;
};

export const usePaymasterApprovalModal = () => {
  const { t } = useTranslation();
  const [pendingApproval, setPendingApproval] = useState<PendingApproval>();

  const requestPaymasterApproval = useCallback(
    (setup: SmartAccountPaymasterApprovalSetup) =>
      new Promise<boolean>((resolve) => {
        setPendingApproval({
          resolve,
          token: setup.token.symbol || 'zkSYS',
        });
      }),
    []
  );

  const closeApproval = useCallback(
    (approved: boolean) => {
      pendingApproval?.resolve(approved);
      setPendingApproval(undefined);
    },
    [pendingApproval]
  );

  const paymasterApprovalModal = (
    <ConfirmationModal
      buttonText={t('buttons.confirm')}
      description={
        pendingApproval
          ? t('send.paymasterApprovalPrompt', { token: pendingApproval.token })
          : ''
      }
      onClick={() => closeApproval(true)}
      onClose={() => closeApproval(false)}
      show={Boolean(pendingApproval)}
      title={t('buttons.confirm')}
    />
  );

  return {
    paymasterApprovalModal,
    requestPaymasterApproval,
  };
};
