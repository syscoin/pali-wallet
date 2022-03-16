import React from 'react';
import IWalletState from 'state/wallet/types';
import { useSelector } from 'react-redux';
import { useController } from 'hooks/index';
import { RootState } from 'state/store';

import { ConfirmTransaction } from '../SiteTransaction';

const MintNFTConfirm = () => {
  const controller = useController();
  const { issueNFTItem } = controller.wallet.account.getTransactionItem();

  const { mintNFT }: IWalletState = useSelector(
    (state: RootState) => state.wallet
  );

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

export default MintNFTConfirm;
