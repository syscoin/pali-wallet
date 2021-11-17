import React from 'react';
import { useController, useStore } from 'hooks/index';

import { ConfirmTransaction } from '../SiteTransaction';

export const CreateAndIssueNFTConfirm = () => {
  const controller = useController();
  const { issuingNFT } = useStore();

  const { mintNFT } = controller.wallet.account.getTransactionItem();

  return (
    <div>
      <ConfirmTransaction
        transactionItem="mintNFT"
        itemStringToClearData="mintNFT"
        confirmTransaction={controller.wallet.account.confirmIssueNFT}
        errorMessage="Can't create and issue NFT. Try again later."
        layoutTitle="Confirm NFT creation"
        data={mintNFT}
        transactingStateItem={issuingNFT}
      />
    </div>
  );
};
