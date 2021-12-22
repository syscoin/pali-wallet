import React from 'react';
import { useController } from 'hooks/index';
import { SiteTransaction } from '../SiteTransaction';
import { useStore } from 'hooks/index';
import { ConfirmTransaction } from '../index';

export const CreateAndIssueNFTConfirm = () => {
  const controller = useController();

  const { mintNFT } = controller.wallet.account.getTransactionItem();
  const { issuingNFT } = useStore();

  return (
    <ConfirmTransaction
      sign={false}
      signAndSend={false}
      title="NFT CREATION"
      confirmTransaction={controller.wallet.account.confirmIssueNFT}
      temporaryTransaction={mintNFT}
      temporaryTransactionStringToClear="mintNFT"
      submittingData={issuingNFT}
    />
  );
};

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
