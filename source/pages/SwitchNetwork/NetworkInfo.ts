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

const PINK_COLOR = 'text-brand-pink';
const BLUE_COLOR = 'text-brand-blue';

export const useNetworkInfo = (setedNetwork?: string): INetworkInfo => {
  const isBitcoinBased = useSelector(
    (state: RootState) => state.vault.isBitcoinBased
  );
  const networks = useSelector((state: RootState) => state.vault.networks);

  const filteredNetworks = useMemo(() => {
    if (setedNetwork !== '') {
      return setedNetwork === 'EVM'
        ? Object.values(networks.ethereum)
        : Object.values(networks.syscoin);
    }

    return isBitcoinBased
      ? Object.values(networks.ethereum)
      : Object.values(networks.syscoin);
  }, [setedNetwork, isBitcoinBased, networks]);

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

  return setedNetwork
    ? setedNetwork === 'EVM'
      ? utxoNetwork
      : otherNetworkInfo
    : isBitcoinBased
    ? utxoNetwork
    : otherNetworkInfo;
};
