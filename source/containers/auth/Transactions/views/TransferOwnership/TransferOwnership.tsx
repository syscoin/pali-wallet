import React from "react";
import { useController } from "hooks/index";

import { SiteTransaction } from "../SiteTransaction";
import { ConfirmTransaction } from "../index";

export const TransferOwnershipConfirm = () => {
  const controller = useController();
  const temporaryTransaction =
    controller.wallet.account.getTemporaryTransaction("transferAsset");

  return (
    <ConfirmTransaction
      sign={false}
      signAndSend={false}
      title="TRANSFER ASSET"
      callback={controller.wallet.account.confirmAssetTransfer}
      temporaryTransaction={temporaryTransaction}
      temporaryTransactionStringToClear="transferAsset"
    />
  );
};

export const TransferOwnership = () => (
  <div>
    <SiteTransaction
      confirmRoute="/transferOwnership/confirm"
      temporaryTransactionAsString="transferAsset"
      layoutTitle="Transfer Asset"
    />
  </div>
);
