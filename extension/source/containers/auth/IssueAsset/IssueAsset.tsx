import React from 'react';
import SiteTransaction from '../SiteTransaction';
import { useController } from 'hooks/index';

const IssueAsset = () => {
  const controller = useController();

  return (
    <div>
      <SiteTransaction
        callbackToSetDataFromWallet={controller.wallet.account.setDataFromWalletToMintSPT}
        messageToSetDataFromWallet="DATA_FROM_WALLET_TO_MINT_TOKEN"
        confirmRoute="/issueAsset/confirm"
        itemStringToClearData="mintSPT"
        layoutTitle="Issue token"
      />
    </div>
  )
}

export default IssueAsset;
