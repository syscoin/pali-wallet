import React from 'react';
import { TxConfirmLayout } from 'components/Layout';

export const SignAndSend = () => (
  <TxConfirmLayout
    sign
    signAndSend
    title="SIGNATURE REQUEST"
    txType="signAndSendPSBT"
  />
);
