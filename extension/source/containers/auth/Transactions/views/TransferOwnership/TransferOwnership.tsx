import React from 'react';
import { useController } from 'hooks/index';

import {SiteTransaction} from '../SiteTransaction';

export const TransferOwnership = () => {
  const controller = useController();

  return (
    <div>
      <SiteTransaction
        callbackToSetDataFromWallet={
          controller.wallet.account.setDataFromWalletToTransferOwnership
        }
        messageToSetDataFromWallet="DATA_FROM_WALLET_TO_TRANSFER_OWNERSHIP"
        confirmRoute="/transferOwnership/confirm"
        itemStringToClearData="transferOwnershipData"
        layoutTitle="Transfer ownership"
      />
    </div>
  );
};
