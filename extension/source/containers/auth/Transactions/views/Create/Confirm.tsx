import React from 'react';
import IWalletState from 'state/wallet/types';
import { useSelector } from 'react-redux';
import { useController } from 'hooks/index';
import { RootState } from 'state/store';

import { ConfirmTransaction } from '../SiteTransaction';

export const CreateTokenConfirm = () => {
  const controller = useController();
  const { newSPT } = controller.wallet.account.getTransactionItem();

  const { creatingAsset }: IWalletState = useSelector(
    (state: RootState) => state.wallet
  );

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
