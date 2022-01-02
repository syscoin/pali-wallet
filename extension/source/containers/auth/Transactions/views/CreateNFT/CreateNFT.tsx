import React from 'react';
import { useController } from 'hooks/index';
import { SiteTransaction } from '../SiteTransaction';
import { ConfirmTransaction } from '../index';

export const CreateAndIssueNFTConfirm = () => {
  const controller = useController();
  const temporaryTransaction = controller.wallet.account.getTemporaryTransaction('newNFT');

  return (
    <ConfirmTransaction
      sign={false}
      signAndSend={false}
      title="NFT CREATION"
      callback={controller.wallet.account.confirmCreateNFT}
      temporaryTransaction={temporaryTransaction}
      temporaryTransactionStringToClear="newNFT"
    />
  );
};

export const CreateAndIssueNFT = () => {
  return (
    <SiteTransaction
      confirmRoute="/issueNFT/confirm"
      temporaryTransactionAsString="newNFT"
      layoutTitle="Create NFT"
    />
  );
};
