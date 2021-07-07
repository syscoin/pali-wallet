import React from 'react';
import IWalletState from 'state/wallet/types';
import { useSelector } from 'react-redux';
import { useController } from 'hooks/index';
import { RootState } from 'state/store';
import { ConfirmTransaction } from '../SiteTransaction';

const IssueAssetConfirm = () => {
  const controller = useController();
  const mintSPT = controller.wallet.account.getTransactionItem().mintSPT;

  const { issuingAsset }: IWalletState = useSelector(
    (state: RootState) => state.wallet
  );
  
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
  )
};

export default IssueAssetConfirm;
