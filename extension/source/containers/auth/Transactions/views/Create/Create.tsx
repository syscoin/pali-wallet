import React from 'react';
import { useController } from 'hooks/index';
import { SiteTransaction } from '../SiteTransaction';
import { useStore } from 'hooks/index';
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

export const Create = () => {
  return (
    <div>
      <SiteTransaction
        confirmRoute="/create/confirm"
        temporaryTransactionAsString="newSPT"
        layoutTitle="Create token"
      />
    </div>
  );
};
