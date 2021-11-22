import React from 'react';
import { useController } from 'hooks/index';

import { SiteTransaction } from '../SiteTransaction';

export const IssueNFT = () => {
  const controller = useController();

  return (
    <div>
      <SiteTransaction
        callbackToSetDataFromWallet={
          controller.wallet.account.setDataFromWalletToMintNFT
        }
        messageToSetDataFromWallet="DATA_FROM_WALLET_TO_MINT_NFT"
        confirmRoute="/issueNFT/confirm"
        itemStringToClearData="mintNFT"
        layoutTitle="NFT creation"
      />
    </div>
  );
};
