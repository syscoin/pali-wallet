import React from 'react';
import { useController } from 'hooks/index';

import {SiteTransaction} from '../SiteTransaction';

export const IssueAsset = () => {
  const controller = useController();

  return (
    <div>
      <SiteTransaction
        callbackToSetDataFromWallet={
          controller.wallet.account.setDataFromWalletToMintSPT
        }
        messageToSetDataFromWallet="DATA_FROM_WALLET_TO_MINT_TOKEN"
        confirmRoute="/issueAsset/confirm"
        itemStringToClearData="mintSPT"
        layoutTitle="Issue token"
      />
    </div>
  );
};
