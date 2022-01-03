import React from 'react';
import { useController } from 'hooks/index';
import { ConfirmTransaction } from '../index';

export const SignAndSend = () => {
  const controller = useController();

  const temporaryTransaction = controller.wallet.account.getTemporaryTransaction('signAndSendPSBT');

  return (
    <ConfirmTransaction
      sign={true}
      title="SIGNATURE REQUEST"
      signAndSend={true}
      temporaryTransaction={temporaryTransaction}
      temporaryTransactionStringToClear="signAndSendPSBT"
    />
  );
};
