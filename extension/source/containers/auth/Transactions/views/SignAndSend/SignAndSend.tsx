import React from 'react';
import { useStore } from 'hooks/index';
import {SignTransaction} from '../SignTransaction';

export const SignAndSend = () => {
  const { signingTransaction } = useStore();

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
