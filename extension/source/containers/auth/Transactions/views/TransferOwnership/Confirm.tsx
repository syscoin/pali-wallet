import React from 'react';
import { useController, useStore } from 'hooks/index';

import { ConfirmTransaction } from '../SiteTransaction';

export const TransferOwnershipConfirm = () => {
  const controller = useController();
  const { transferOwnershipData } =
    controller.wallet.account.getTransactionItem();

  const { transferringOwnership } = useStore();

  return (
    <div>
      <ConfirmTransaction
        transactionItem="transferOwnershipData"
        itemStringToClearData="transferOwnershipData"
        confirmTransaction={controller.wallet.account.confirmTransferOwnership}
        errorMessage="Can't transfer ownership. Try again later."
        layoutTitle="Confirm transfer ownership"
        data={transferOwnershipData}
        transactingStateItem={transferringOwnership}
      />
    </div>
  );
};
