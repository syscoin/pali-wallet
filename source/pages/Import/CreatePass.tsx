import React from 'react';
import { useSelector } from 'react-redux';

import { PasswordForm } from 'components/index';
import { useUtils } from 'hooks/index';
import { RootState } from 'state/store';
import { getController } from 'utils/browser';

const CreatePass = () => {
  const controller = getController();
  const activeAccount = useSelector(
    (state: RootState) => state.vault.activeAccount
  );

  const { navigate } = useUtils();

  const next = () => navigate('/home');

  const onSubmit = ({ password }: { password: string }) => {
    // clear old wallet before set a new password
    // if (activeAccount.address) controller.wallet.clearState();

    controller.wallet.setWalletPassword(password);
    controller.wallet.createWallet();

    next();
  };

  return <PasswordForm onSubmit={onSubmit} />;
};

export default CreatePass;
