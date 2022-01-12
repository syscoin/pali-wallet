import React from "react";
import { useController, useStore, useUtils } from "hooks/index";
import { PasswordForm } from "components/index";

const CreatePass = () => {
  const controller = useController();

  const { canConnect } = useStore();
  const { history } = useUtils();

  const next = () => {
    if (canConnect) {
      history.push("/connect-wallet");

      return;
    }

    history.push("/home");
  };

  const onSubmit = (data: any) => {
    controller.wallet.setWalletPassword(data.password);
    controller.wallet.createWallet(true);

    next();
  };

  return <PasswordForm onSubmit={onSubmit} />;
};

export default CreatePass;
