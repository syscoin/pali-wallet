import React from 'react';

import {
  EthChainDarkBlueSvg,
  PinkBitcoinSvg,
  RolluxChainWhiteSvg,
  SysChainWhiteSvg,
} from 'components/Icon/Icon';
import { NetworkType } from 'utils/types';

interface INetworkInfo {
  connectedColor: string;
  connectedNetwork: NetworkType;
  leftLogo: React.ComponentType<{
    className?: string;
    style?: React.CSSProperties;
  }>;
  networkDescription: string;
  networkNeedsChangingColor: string;
  networkThatNeedsChanging: NetworkType;
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
    connectedNetwork: NetworkType.UTXO,
    networkThatNeedsChanging: NetworkType.EVM,
    connectedColor: PINK_COLOR,
    networkNeedsChangingColor: BLUE_COLOR,
    networkDescription: 'Ethereum Virtual Machine',
    selectedNetworkText: 'Select an EVM network:',
    leftLogo: EthChainDarkBlueSvg,
    rightLogo: RolluxChainWhiteSvg,
  };

  const evmNetworkInfo: INetworkInfo = {
    connectedNetwork: NetworkType.EVM,
    networkThatNeedsChanging: NetworkType.UTXO,
    connectedColor: BLUE_COLOR,
    networkNeedsChangingColor: PINK_COLOR,
    networkDescription: 'Unspent Transaction Output',
    selectedNetworkText: 'Select a UTXO network:',
    leftLogo: PinkBitcoinSvg,
    rightLogo: SysChainWhiteSvg,
  };

  let value: any;

  if (isChanging) {
    value = selectedNetwork === 'UTXO' ? evmNetworkInfo : utxoNetwork;
  } else {
    value = isBitcoinBased ? utxoNetwork : evmNetworkInfo;
  }

  return value;
};
