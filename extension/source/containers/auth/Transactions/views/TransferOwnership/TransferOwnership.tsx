import React from 'react';
import { useController } from 'hooks/index';
import { SiteTransaction } from '../SiteTransaction';
import { useStore } from 'hooks/index';
import { ConfirmTransaction } from '../index';

export const TransferOwnershipConfirm = () => {
  const controller = useController();

  const { transferOwnershipData } = controller.wallet.account.getTransactionItem();
  const { transferringOwnership } = useStore();

  return (
    <ConfirmTransaction
      sign={false}
      signAndSend={false}
      title="TOKEN UPDATE"
      confirmTransaction={controller.wallet.account.confirmTransferOwnership}
      temporaryTransaction={transferOwnershipData}
      temporaryTransactionStringToClear="updateAssetItem"
      submittingData={transferringOwnership}
    />
  );
};

export const TransferOwnership = () => {
  const controller = useController();

  return (
    <div>
      <SiteTransaction
        callbackToSetDataFromWallet={
          controller.wallet.account.setDataFromWalletToTransferOwnership
        }
        messageToSetDataFromWallet="DATA_FROM_WALLET_TO_TRANSFER_OWNERSHIP"
        confirmRoute="/transferOwnership/confirm"
        itemStringToClearData="transferOwnershipData"
        layoutTitle="Transfer ownership"
      />
    </div>
  );
};
