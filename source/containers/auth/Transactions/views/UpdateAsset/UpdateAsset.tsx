import React from 'react';
import { useController } from 'hooks/index';

import { SiteTransaction } from '../SiteTransaction';
import { ConfirmTransaction } from '../index';

export const UpdateAssetConfirm = () => {
  const controller = useController();
  const temporaryTransaction =
    controller.wallet.account.getTemporaryTransaction('updateAsset');

  return (
    <ConfirmTransaction
      sign={false}
      signAndSend={false}
      title="UPDATE ASSET"
      callback={controller.wallet.account.confirmUpdateAsset}
      temporaryTransaction={temporaryTransaction}
      temporaryTransactionStringToClear="updateAsset"
    />
  );
};

export const UpdateAsset = () => (
  <div>
    <SiteTransaction
      confirmRoute="/updateAsset/confirm"
      temporaryTransactionAsString="updateAsset"
      layoutTitle="Update Asset"
    />
  </div>
);
