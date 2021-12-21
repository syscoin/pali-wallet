import React from 'react';
import { useController, useStore } from 'hooks/index';
import { ConfirmTransaction } from '../index';

export const CreateTokenConfirm = () => {
  const controller = useController();

  const { newSPT } = controller.wallet.account.getTransactionItem();
  const { creatingAsset } = useStore();

  return (
    <ConfirmTransaction
      sign={false}
      signAndSend={false}
      title="TOKEN CREATION"
      confirmTransaction={controller.wallet.account.confirmNewSPT}
      temporaryTransaction={newSPT}
      temporaryTransactionStringToClear="newSPT"
      submittingData={creatingAsset}
    />
  );
};
