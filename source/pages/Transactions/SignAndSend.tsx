import React from 'react';
import { useController } from 'hooks/index';
import { TxConfirmLayout } from 'components/Layout';

export const SignAndSend = () => {
  const controller = useController();

  const temporaryTransaction =
    controller.wallet.account.getTemporaryTransaction('signAndSendPSBT');

  return (
    <TxConfirmLayout
      sign
      title="SIGNATURE REQUEST"
      signAndSend
      temporaryTransaction={temporaryTransaction}
      temporaryTransactionStringToClear="signAndSendPSBT"
    />
  );
};
