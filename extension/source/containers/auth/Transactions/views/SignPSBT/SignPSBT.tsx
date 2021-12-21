import React from 'react';
import { useController, useStore } from 'hooks/index';
import { ConfirmTransaction } from '../index';

export const SignPSBT = () => {
  const controller = useController();

  const { currentPsbtToSign } = controller.wallet.account.getTransactionItem();
  const { signingPSBT } = useStore();

  return (
    <ConfirmTransaction
      sign={true}
      title="SIGNATURE REQUEST"
      signAndSend={false}
      confirmTransaction={controller.wallet.account.confirmSignature}
      temporaryTransaction={currentPsbtToSign}
      temporaryTransactionStringToClear="currentPsbtToSign"
      submittingData={signingPSBT}
    />
  );
};
