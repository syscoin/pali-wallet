import React from 'react';
import { useController, useStore } from 'hooks/index';
import { ConfirmTransaction } from '../index';

export const IssueAssetConfirm = () => {
  const controller = useController();

  const { mintSPT } = controller.wallet.account.getTransactionItem();
  const { issuingAsset } = useStore();

  return (
    <ConfirmTransaction
      sign={false}
      signAndSend={false}
      title="TOKEN MINT"
      confirmTransaction={controller.wallet.account.confirmIssueSPT}
      temporaryTransaction={mintSPT}
      temporaryTransactionStringToClear="newSPT"
      submittingData={issuingAsset}
    />
  );
};
