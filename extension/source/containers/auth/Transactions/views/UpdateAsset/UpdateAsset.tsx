import React from 'react';
import { useController } from 'hooks/index';
import { SiteTransaction } from '../SiteTransaction';
import { useStore } from 'hooks/index';
import { ConfirmTransaction } from '../index';

export const UpdateAssetConfirm = () => {
  const controller = useController();

  const updateAssetItem = controller.wallet.account.getTransactionItem().updateAssetItem;
  const { updatingAsset } = useStore();

  return (
    <ConfirmTransaction
      sign={false}
      signAndSend={false}
      title="TOKEN UPDATE"
      confirmTransaction={controller.wallet.account.confirmUpdateAssetTransaction}
      temporaryTransaction={updateAssetItem}
      temporaryTransactionStringToClear="updateAssetItem"
      submittingData={updatingAsset}
    />
  );
};

export const UpdateAsset = () => {
  const controller = useController();

  return (
    <div>
      <SiteTransaction
        callbackToSetDataFromWallet={
          controller.wallet.account.setDataFromWalletToUpdateAsset
        }
        messageToSetDataFromWallet="DATA_FROM_WALLET_TO_UPDATE_TOKEN"
        confirmRoute="/updateAsset/confirm"
        itemStringToClearData="updateAssetItem"
        layoutTitle="Update token"
      />
    </div>
  );
};
