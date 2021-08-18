import React from 'react';
import IWalletState from 'state/wallet/types';
import { RootState } from 'state/store';
import { useSelector } from 'react-redux';
import SignTransaction from '../SignTransaction';

const SignPSBT = () => {
  const { signingPSBT }: IWalletState = useSelector((state: RootState) => state.wallet);

  return (
    <div>
      <SignTransaction
        item="currentPsbtToSign"
        transactingStateItem={signingPSBT}
        sendPSBT={true}
        warning="You are sending a signed PSBT to this site. This can be dangerous if you are not so sure about what you are doing. Confirm if you are fully aware of it."
      />
    </div>
  )
};

export default SignPSBT;
