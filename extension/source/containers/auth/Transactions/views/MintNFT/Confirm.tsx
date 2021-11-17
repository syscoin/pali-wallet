import React from 'react';
import { useController, useStore } from 'hooks/index';

import { ConfirmTransaction } from '../SiteTransaction';

export const MintNFTConfirm = () => {
  const controller = useController();
  const { mintNFT } = useStore();

  const { issueNFTItem } = controller.wallet.account.getTransactionItem();

  return (
    <div>
      <ConfirmTransaction
        transactionItem="issueNFTItem"
        itemStringToClearData="issueNFTItem"
        confirmTransaction={controller.wallet.account.confirmIssueNFTTx}
        errorMessage="Can't issue NFT. Try again later."
        layoutTitle="Confirm NFT mint"
        data={issueNFTItem}
        transactingStateItem={mintNFT}
      />
    </div>
  );
};
