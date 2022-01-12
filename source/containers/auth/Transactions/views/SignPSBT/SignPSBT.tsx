import React from "react";
import { useController } from "hooks/index";

import { ConfirmTransaction } from "../index";

export const SignPSBT = () => {
  const controller = useController();

  const temporaryTransaction =
    controller.wallet.account.getTemporaryTransaction("signPSBT");

  return (
    <ConfirmTransaction
      sign
      title="SIGNATURE REQUEST"
      signAndSend={false}
      temporaryTransaction={temporaryTransaction}
      temporaryTransactionStringToClear="signPSBT"
    />
  );
};
