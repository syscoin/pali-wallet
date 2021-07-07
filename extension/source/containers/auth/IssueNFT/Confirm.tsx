import React from 'react';
import IWalletState from 'state/wallet/types';
import { useSelector } from 'react-redux';
import { useController } from 'hooks/index';
import { RootState } from 'state/store';
import { ConfirmTransaction } from '../SiteTransaction';

const CreateAndIssueNFTConfirm = () => {
  const controller = useController();
  const mintNFT = controller.wallet.account.getTransactionItem().mintNFT;

  const { issuingNFT }: IWalletState = useSelector(
    (state: RootState) => state.wallet
  );

  return (
    <div>
      <ConfirmTransaction
        transactionItem="mintNFT"
        itemStringToClearData="mintNFT"
        confirmTransaction={controller.wallet.account.confirmIssueNFT}
        errorMessage="Can\'t create and issue NFT. Try again later."
        layoutTitle="Confirm NFT creation"
        data={mintNFT}
        transactingStateItem={issuingNFT}
      />
    </div>
  )
};

export default CreateAndIssueNFTConfirm;
