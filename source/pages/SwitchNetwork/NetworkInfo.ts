import { useMemo } from 'react';
import { useSelector } from 'react-redux';

import { INetwork } from '@pollum-io/sysweb3-network';

import leftLogoEthChain from 'assets/images/ethChainDarkBlue.svg';
import leftLogoPinkBitcoin from 'assets/images/pinkBitcoin.svg';
import rightLogoRolluxChain from 'assets/images/rolluxChainWhite.svg';
import rightLogoSysWhite from 'assets/images/sysChainWhite.svg';
import { RootState } from 'state/store';
import { NetworkType } from 'utils/types';

interface INetworkInfo {
  connectedColor: string;
  connectedNetwork: NetworkType;
  filteredNetworks: INetwork[];
  leftLogo: string;
  networkDescription: string;
  networkNeedsChangingColor: string;
  networkThatNeedsChanging: NetworkType;
  rightLogo: string;
  selectedNetworkText: string;
}

const PINK_COLOR = 'text-brand-deepPink100';
const BLUE_COLOR = 'text-brand-blue200';

export const useNetworkInfo = ({
  network,
  isBitcoinBased,
  networks,
}: {
  isBitcoinBased?: boolean;
  network?: string;
  networks: RootState['vault']['networks'];
}): INetworkInfo => {
  const filteredNetworks = useMemo(() => {
    if (network !== '') {
      return network === 'EVM'
        ? Object.values(networks.syscoin)
        : Object.values(networks.ethereum);
    }
  }, [network, isBitcoinBased, networks]);

  const utxoNetwork: INetworkInfo = {
    connectedNetwork: NetworkType.UTXO,
    networkThatNeedsChanging: NetworkType.EVM,
    connectedColor: PINK_COLOR,
    networkNeedsChangingColor: BLUE_COLOR,
    networkDescription: 'Ethereum Virtual Machine',
    selectedNetworkText: 'Select an EVM network:',
    leftLogo: leftLogoEthChain,
    rightLogo: rightLogoRolluxChain,
    filteredNetworks,
  };

  const otherNetworkInfo: INetworkInfo = {
    connectedNetwork: NetworkType.EVM,
    networkThatNeedsChanging: NetworkType.UTXO,
    connectedColor: BLUE_COLOR,
    networkNeedsChangingColor: PINK_COLOR,
    networkDescription: 'Unspent Transaction Output',
    selectedNetworkText: 'Select a UTXO network:',
    leftLogo: leftLogoPinkBitcoin,
    rightLogo: rightLogoSysWhite,
    filteredNetworks,
  };

  let value: any;

  if (network) {
    if (network === 'EVM') {
      value = otherNetworkInfo;
    } else {
      value = utxoNetwork;
    }
  } else {
    if (isBitcoinBased) {
      value = utxoNetwork;
    } else {
      value = otherNetworkInfo;
    }
  }
  return value;
};
