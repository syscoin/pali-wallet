import React from 'react';
import SiteTransaction from '../SiteTransaction';
import { useController } from 'hooks/index';

const TransferOwnership = () => {
  const controller = useController();

  return (
    <div>
      <SiteTransaction
        callbackToSetDataFromWallet={controller.wallet.account.setDataFromWalletToTransferOwnership}
        messageToSetDataFromWallet="DATA_FROM_WALLET_TO_TRANSFER_OWNERSHIP"
        confirmRoute="/transferOwnership/confirm"
        itemStringToClearData="transferOwnershipData"
        layoutTitle="Transfer ownership"
      />
    </div>
  )
}

export default TransferOwnership;
