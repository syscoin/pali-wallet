import React from "react";
import { useController } from "hooks/index";

import { SiteTransaction } from "../SiteTransaction";
import { ConfirmTransaction } from "../index";

export const MintTokenConfirm = () => {
  const controller = useController();
  const temporaryTransaction =
    controller.wallet.account.getTemporaryTransaction("mintAsset");

  return (
    <ConfirmTransaction
      sign={false}
      signAndSend={false}
      title="TOKEN MINT"
      callback={controller.wallet.account.confirmMintSPT}
      temporaryTransaction={temporaryTransaction}
      temporaryTransactionStringToClear="mintAsset"
    />
  );
};

export const MintToken = () => (
  <SiteTransaction
    confirmRoute="/issueAsset/confirm"
    temporaryTransactionAsString="mintAsset"
    layoutTitle="Mint token"
  />
);
