import React from 'react';
import IWalletState from 'state/wallet/types';
import { useSelector } from 'react-redux';
import { useController } from 'hooks/index';
import { RootState } from 'state/store';

import { ConfirmTransaction } from '../SiteTransaction';

const TransferOwnershipConfirm = () => {
  const controller = useController();
  const { transferOwnershipData } =
    controller.wallet.account.getTransactionItem();

  const { transferringOwnership }: IWalletState = useSelector(
    (state: RootState) => state.wallet
  );

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

export default TransferOwnershipConfirm;
