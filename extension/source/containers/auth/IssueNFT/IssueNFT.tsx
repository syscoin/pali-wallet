import React from 'react';
import SiteTransaction from '../SiteTransaction';
import { useController } from 'hooks/index';

const IssueAsset = () => {
  const controller = useController();
  
  return (
    <div>
      <SiteTransaction
        callbackToSetDataFromWallet={controller.wallet.account.setDataFromWalletToMintNFT}
        messageToSetDataFromWallet="DATA_FROM_WALLET_TO_MINT_NFT"
        confirmRoute="/issueNFT/confirm"
        itemStringToClearData="mintNFT"
        layoutTitle="NFT creation"
      />
    </div>
  )
}

export default IssueAsset;
