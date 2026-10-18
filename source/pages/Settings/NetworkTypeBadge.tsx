import React from 'react';

import { INetworkType } from 'types/network';

export const NetworkTypeBadge = ({ kind }: { kind?: INetworkType }) => {
  const isUtxo = kind === INetworkType.Syscoin;
  return (
    <span
      className={`px-1.5 py-0.5 text-[10px] font-medium text-white rounded-full ${
        isUtxo ? 'bg-brand-pink' : 'bg-brand-blue'
      }`}
    >
      {isUtxo ? 'UTXO' : 'EVM'}
    </span>
  );
};
