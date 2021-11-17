import React from 'react';
import { useController } from 'hooks/index';

import {SiteTransaction} from '../SiteTransaction';

export const MintNFT = () => {
  const controller = useController();

  return (
    <div>
      <SiteTransaction
        callbackToSetDataFromWallet={
          controller.wallet.account.setDataFromWalletToIssueNFT
        }
        messageToSetDataFromWallet="DATA_FROM_WALLET_TO_ISSUE_NFT"
        confirmRoute="/mintNFT/confirm"
        itemStringToClearData="issueNFTItem"
        layoutTitle="NFT mint"
      />
    </div>
  );
};
