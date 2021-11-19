import React from 'react';
import { useController, useStore } from 'hooks/index';

import { ConfirmTransaction } from '../SiteTransaction';

export const CreateTokenConfirm = () => {
  const controller = useController();

  const { newSPT } = controller.wallet.account.getTransactionItem();
  const { creatingAsset } = useStore();

  return (
    <div>
      <ConfirmTransaction
        transactionItem="newSPT"
        itemStringToClearData="newSPT"
        confirmTransaction={controller.wallet.account.confirmNewSPT}
        errorMessage="Can't create token. Try again later."
        layoutTitle="Confirm token creation"
        data={newSPT}
        transactingStateItem={creatingAsset}
      />
    </div>
  );
};
