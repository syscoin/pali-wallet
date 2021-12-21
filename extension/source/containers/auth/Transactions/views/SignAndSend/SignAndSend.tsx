import React from 'react';
import { useController, useStore } from 'hooks/index';
import { ConfirmTransaction } from '../index';

export const SignAndSend = () => {
  const controller = useController();

  const { currentPSBT } = controller.wallet.account.getTransactionItem();
  const { signingTransaction } = useStore();

  return (
    <ConfirmTransaction
      sign={true}
      title="SIGNATURE REQUEST"
      signAndSend={true}
      confirmTransaction={controller.wallet.account.confirmSignature}
      temporaryTransaction={currentPSBT}
      temporaryTransactionStringToClear="currentPSBT"
      submittingData={signingTransaction}
    />
  );
};
