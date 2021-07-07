import React from 'react';
import SiteTransaction from '../SiteTransaction';
import { useController } from 'hooks/index';

const UpdateAsset = () => {
  const controller = useController();

  return (
    <div>
      <SiteTransaction
        callbackToSetDataFromWallet={controller.wallet.account.setDataFromWalletToUpdateAsset}
        messageToSetDataFromWallet="DATA_FROM_WALLET_TO_UPDATE_TOKEN"
        confirmRoute="/updateAsset/confirm"
        itemStringToClearData="updateAssetItem"
        layoutTitle="Update token"
      />
    </div>
  );
}

export default UpdateAsset;
