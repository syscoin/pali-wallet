import React from 'react';
import { useController, useStore } from 'hooks/index';

import { ConfirmTransaction } from '../SiteTransaction';

export const IssueAssetConfirm = () => {
  const controller = useController();
  const { mintSPT } = controller.wallet.account.getTransactionItem();

  const { issuingAsset } = useStore();

  return (
    <div>
      <ConfirmTransaction
        transactionItem="mintSPT"
        itemStringToClearData="mintSPT"
        confirmTransaction={controller.wallet.account.confirmIssueSPT}
        errorMessage="Can't issue token. Try again later."
        layoutTitle="Confirm token issue"
        data={mintSPT}
        transactingStateItem={issuingAsset}
      />
    </div>
  );
};

