import { useStore } from 'hooks/index';
import React from 'react';
import {SignTransaction} from '../SignTransaction';

export const SignPSBT = () => {
  const { signingPSBT } = useStore();

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
