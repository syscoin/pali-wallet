import React from 'react';
import IWalletState from 'state/wallet/types';
import { RootState } from 'state/store';
import { useSelector } from 'react-redux';
import SignTransaction from '../SignTransaction';

const SignAndSend = () => {
  const { signingTransaction }: IWalletState = useSelector((state: RootState) => state.wallet);

  return (
    <div>
      <SignTransaction
        item="currentPSBT"
        transactingStateItem={signingTransaction}
        sendPSBT={false}
        warning="Only sign messages from sites you fully trust with your account."
      />
    </div>
  )
};

export default SignAndSend;
