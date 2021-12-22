import React from 'react';
import { useController } from 'hooks/index';
import { SiteTransaction } from '../SiteTransaction';
import { useStore } from 'hooks/index';
import { ConfirmTransaction } from '../index';

export const MintNFTConfirm = () => {
  const controller = useController();

  const { issueNFTITem } = controller.wallet.account.getTransactionItem();
  const { issuingNFT } = useStore();

  return (
    <ConfirmTransaction
      sign={false}
      signAndSend={false}
      title="NFT MINT"
      confirmTransaction={controller.wallet.account.confirmIssueNFT}
      temporaryTransaction={issueNFTITem}
      temporaryTransactionStringToClear="issueNFTITem"
      submittingData={issuingNFT}
    />
  );
};

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
