import React from 'react';
import { useController, useStore } from 'hooks/index';
import { ConfirmTransaction } from '../index';

export const CreateTokenConfirm = () => {
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
