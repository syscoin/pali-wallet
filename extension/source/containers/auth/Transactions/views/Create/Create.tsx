import React from 'react';
import { useController } from 'hooks/index';

import { SiteTransaction } from '../SiteTransaction';

export const Create = () => {
  const controller = useController();

  return (
    <div>
      <SiteTransaction
        callbackToSetDataFromWallet={
          controller.wallet.account.setDataFromWalletToCreateSPT
        }
        messageToSetDataFromWallet="DATA_FROM_WALLET_TO_CREATE_TOKEN"
        confirmRoute="/create/confirm"
        itemStringToClearData="newSPT"
        layoutTitle="Create token"
      />
    </div>
  );
};
