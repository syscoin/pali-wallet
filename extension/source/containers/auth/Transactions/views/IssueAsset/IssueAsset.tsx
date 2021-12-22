import React from 'react';
import { useController } from 'hooks/index';
import {SiteTransaction} from '../SiteTransaction';
import { useStore } from 'hooks/index';
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

export const IssueAsset = () => {
  const controller = useController();

  return (
    <div>
      <SiteTransaction
        callbackToSetDataFromWallet={
          controller.wallet.account.setDataFromWalletToMintSPT
        }
        messageToSetDataFromWallet="DATA_FROM_WALLET_TO_MINT_TOKEN"
        confirmRoute="/issueAsset/confirm"
        itemStringToClearData="mintSPT"
        layoutTitle="Issue token"
      />
    </div>
  );
};
