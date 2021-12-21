import React from 'react';
import { useController, useStore } from 'hooks/index';
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
