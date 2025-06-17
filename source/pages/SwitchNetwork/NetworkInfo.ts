import React from 'react';

import { INetworkType } from '@pollum-io/sysweb3-network';

import {
  EthChainDarkBlueSvg,
  PinkBitcoinSvg,
  RolluxChainWhiteSvg,
  SysChainWhiteSvg,
} from 'components/Icon/Icon';

interface INetworkInfo {
  connectedColor: string;
  connectedNetwork: INetworkType;
  leftLogo: React.ComponentType<{
    className?: string;
    style?: React.CSSProperties;
  }>;
  networkDescription: string;
  networkNeedsChangingColor: string;
  networkThatNeedsChanging: INetworkType;
  rightLogo: React.ComponentType<{
    className?: string;
    style?: React.CSSProperties;
  }>;
  selectedNetworkText: string;
}

const PINK_COLOR = 'text-brand-deepPink100';
const BLUE_COLOR = 'text-brand-blue200';

export const useNetworkInfo = ({
  isBitcoinBased,
  isChanging,
  selectedNetwork,
}: {
  isBitcoinBased?: boolean;
  isChanging?: boolean;
  selectedNetwork?: string;
}): INetworkInfo => {
  const utxoNetwork: INetworkInfo = {
    connectedNetwork: INetworkType.Syscoin,
    networkThatNeedsChanging: INetworkType.Ethereum,
    connectedColor: PINK_COLOR,
    networkNeedsChangingColor: BLUE_COLOR,
    networkDescription: 'Ethereum Virtual Machine',
    selectedNetworkText: 'Select an EVM network:',
    leftLogo: EthChainDarkBlueSvg,
    rightLogo: RolluxChainWhiteSvg,
  };

  const evmNetworkInfo: INetworkInfo = {
    connectedNetwork: INetworkType.Ethereum,
    networkThatNeedsChanging: INetworkType.Syscoin,
    connectedColor: BLUE_COLOR,
    networkNeedsChangingColor: PINK_COLOR,
    networkDescription: 'Unspent Transaction Output',
    selectedNetworkText: 'Select a UTXO network:',
    leftLogo: PinkBitcoinSvg,
    rightLogo: SysChainWhiteSvg,
  };

  let value: any;

  if (isChanging) {
    value =
      selectedNetwork === INetworkType.Syscoin ? evmNetworkInfo : utxoNetwork;
  } else {
    value = isBitcoinBased ? utxoNetwork : evmNetworkInfo;
  }

  return value;
};
