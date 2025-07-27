import React from 'react';

import { ChainIcon } from 'components/ChainIcon';
import { INetworkType } from 'types/network';

type FaucetFeedbackProps = {
  chainId?: number;
  icon?: string;
  networkKind?: INetworkType;
  textFeedbackDesc: string;
  textFeedbackTitle: string;
};

export const FaucetFeedback: React.FC<FaucetFeedbackProps> = ({
  icon,
  chainId,
  networkKind = INetworkType.Ethereum,
  textFeedbackDesc,
  textFeedbackTitle,
}) => (
  <div className="flex flex-col items-center">
    {icon ? (
      <img className="w-[50px] h-[50px]" src={icon} alt="Faucet status" />
    ) : chainId ? (
      <div className="w-[50px] h-[50px] flex items-center justify-center">
        <ChainIcon chainId={chainId} size={50} networkKind={networkKind} />
      </div>
    ) : null}
    <h1 className="text-white text-sm text-center mt-6 mb-1">
      {textFeedbackTitle}
    </h1>
    <p className="text-brand-gray200 flex-wrap text-center max-w-[70%] text-xs">
      {textFeedbackDesc}
    </p>
  </div>
);
