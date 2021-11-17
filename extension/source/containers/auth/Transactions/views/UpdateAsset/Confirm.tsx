import React from 'react';
import { useController, useStore } from 'hooks/index';

import { ConfirmTransaction } from '../SiteTransaction';

export const UpdateAssetConfirm = () => {
  const controller = useController();
  const updateAsset =
    controller.wallet.account.getTransactionItem().updateAssetItem;

  const { updatingAsset } = useStore();

  return (
    <div>
      <ConfirmTransaction
        transactionItem="updateAssetItem"
        itemStringToClearData="updateAssetItem"
        confirmTransaction={
          controller.wallet.account.confirmUpdateAssetTransaction
        }
        errorMessage="Can't update token. Try again later."
        layoutTitle="Confirm token update"
        data={updateAsset}
        transactingStateItem={updatingAsset}
      />
    </div>
  );
};
