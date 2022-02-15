import React from 'react';
import { useController } from 'hooks/index';
import { TxConfirmLayout } from 'components/Layout';

export const SignPSBT = () => {
  const controller = useController();

  const temporaryTransaction =
    controller.wallet.account.getTemporaryTransaction('signPSBT');

  return (
    <TxConfirmLayout
      sign
      title="SIGNATURE REQUEST"
      signAndSend={false}
      temporaryTransaction={temporaryTransaction}
      temporaryTransactionStringToClear="signPSBT"
    />
  );
};
