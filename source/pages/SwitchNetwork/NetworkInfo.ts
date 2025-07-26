import { INetworkType } from '@sidhujag/sysweb3-network';
import React from 'react';

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
  networkThatNeedsChanging: string;
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
  selectedNetwork,
}: {
  isBitcoinBased?: boolean;
  selectedNetwork?: string;
}): INetworkInfo => {
  // For switching context (what you need to switch TO)
  const utxoSwitchingInfo: INetworkInfo = {
    connectedNetwork: INetworkType.Syscoin,
    networkThatNeedsChanging: 'EVM',
    connectedColor: PINK_COLOR,
    networkNeedsChangingColor: BLUE_COLOR,
    networkDescription: 'Ethereum Virtual Machine',
    selectedNetworkText: 'Select an EVM network:',
    leftLogo: EthChainDarkBlueSvg,
    rightLogo: RolluxChainWhiteSvg,
  };

  const evmSwitchingInfo: INetworkInfo = {
    connectedNetwork: INetworkType.Ethereum,
    networkThatNeedsChanging: 'UTXO',
    connectedColor: BLUE_COLOR,
    networkNeedsChangingColor: PINK_COLOR,
    networkDescription: 'Unspent Transaction Output',
    selectedNetworkText: 'Select a UTXO network:',
    leftLogo: PinkBitcoinSvg,
    rightLogo: SysChainWhiteSvg,
  };

  // For selection context (what you're currently selecting)
  const utxoSelectionInfo: INetworkInfo = {
    connectedNetwork: INetworkType.Syscoin,
    networkThatNeedsChanging: 'UTXO',
    connectedColor: PINK_COLOR,
    networkNeedsChangingColor: PINK_COLOR,
    networkDescription: 'Unspent Transaction Output',
    selectedNetworkText: 'Select a UTXO network:',
    leftLogo: PinkBitcoinSvg,
    rightLogo: SysChainWhiteSvg,
  };

  const evmSelectionInfo: INetworkInfo = {
    connectedNetwork: INetworkType.Ethereum,
    networkThatNeedsChanging: 'EVM',
    connectedColor: BLUE_COLOR,
    networkNeedsChangingColor: BLUE_COLOR,
    networkDescription: 'Ethereum Virtual Machine',
    selectedNetworkText: 'Select an EVM network:',
    leftLogo: EthChainDarkBlueSvg,
    rightLogo: RolluxChainWhiteSvg,
  };

  let value: any;

  // If selectedNetwork is provided, use selection context (for network selection tabs)
  // Otherwise, use switching context (for warning messages)
  if (selectedNetwork) {
    value =
      selectedNetwork === INetworkType.Syscoin
        ? utxoSelectionInfo
        : evmSelectionInfo;
  } else {
    value = isBitcoinBased ? utxoSwitchingInfo : evmSwitchingInfo;
  }

  return value;
};
