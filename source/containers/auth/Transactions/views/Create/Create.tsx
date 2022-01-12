import React from "react";
import { useController } from "hooks/index";

import { SiteTransaction } from "../SiteTransaction";
import { ConfirmTransaction } from "../index";

export const CreateTokenConfirm = () => {
  const controller = useController();
  const temporaryTransaction =
    controller.wallet.account.getTemporaryTransaction("newAsset");

  return (
    <ConfirmTransaction
      sign={false}
      signAndSend={false}
      title="TOKEN CREATION"
      callback={controller.wallet.account.confirmSPTCreation}
      temporaryTransaction={temporaryTransaction}
      temporaryTransactionStringToClear="newAsset"
    />
  );
};

export const Create = () => (
  <div>
    <SiteTransaction
      confirmRoute="/create/confirm"
      temporaryTransactionAsString="newAsset"
      layoutTitle="Create token"
    />
  </div>
);
