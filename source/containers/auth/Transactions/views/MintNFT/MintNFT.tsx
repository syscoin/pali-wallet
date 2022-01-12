import React from "react";
import { useController } from "hooks/index";

import { SiteTransaction } from "../SiteTransaction";
import { ConfirmTransaction } from "../index";

export const MintNFTConfirm = () => {
  const controller = useController();
  const temporaryTransaction =
    controller.wallet.account.getTemporaryTransaction("mintNFT");

  return (
    <ConfirmTransaction
      sign={false}
      signAndSend={false}
      title="MINT NFT"
      callback={controller.wallet.account.confirmAssetTransfer}
      temporaryTransaction={temporaryTransaction}
      temporaryTransactionStringToClear="mintNFT"
    />
  );
};

export const MintNFT = () => (
  <div>
    <SiteTransaction
      confirmRoute="/mintNFT/confirm"
      temporaryTransactionAsString="mintNFT"
      layoutTitle="Mint NFT"
    />
  </div>
);
