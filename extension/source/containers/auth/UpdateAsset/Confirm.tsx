import React from 'react';
import IWalletState from 'state/wallet/types';
import { useSelector } from 'react-redux';
import { useController } from 'hooks/index';
import { RootState } from 'state/store';
import { ConfirmTransaction } from '../SiteTransaction';

const UpdateConfirm = () => {
  const controller = useController();
  const updateAsset = controller.wallet.account.getTransactionItem().updateAssetItem;

  const { updatingAsset }: IWalletState = useSelector(
    (state: RootState) => state.wallet
  );

  return (
    <div>
      <ConfirmTransaction
        transactionItem="updateAssetItem"
        itemStringToClearData="updateAssetItem"
        confirmTransaction={controller.wallet.account.confirmUpdateAssetTransaction}
        errorMessage="Can't update token. Try again later."
        layoutTitle="Confirm token update"
        data={updateAsset}
        transactingStateItem={updatingAsset}
      />
    </div>
  );
};

export default UpdateConfirm;
