import { useSelector } from 'react-redux';

import leftLogoEthChain from 'assets/images/ethChainDarkBlue.svg';
import leftLogoPinkBitcoin from 'assets/images/pinkBitcoin.svg';
import rightLogoRolluxChain from 'assets/images/rolluxChainWhite.svg';
import rightLogoSysWhite from 'assets/images/sysChainWhite.svg';
import { RootState } from 'state/store';
import { NetworkType } from 'utils/types';
interface INetworkInfo {
  connectedColor: string;
  connectedNetwork: NetworkType;
  leftLogo: string;
  networkDescription: string;
  networkNeedsChangingColor: string;
  networkThatNeedsChanging: NetworkType;
  rightLogo: string;
  selectedNetworkText: string;
}

const PINK_COLOR = 'text-brand-pink';
const BLUE_COLOR = 'text-brand-blue';

export const useNetworkInfo = (): INetworkInfo => {
  const isBitcoinBased = useSelector(
    (state: RootState) => state.vault.isBitcoinBased
  );

  const utxoNetwork: INetworkInfo = {
    connectedNetwork: NetworkType.UTXO,
    networkThatNeedsChanging: NetworkType.EVM,
    connectedColor: PINK_COLOR,
    networkNeedsChangingColor: BLUE_COLOR,
    networkDescription: 'Ethereum Virtual Machine',
    selectedNetworkText: 'Select an EVM network:',
    leftLogo: leftLogoEthChain,
    rightLogo: rightLogoRolluxChain,
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
  };

  return isBitcoinBased ? utxoNetwork : otherNetworkInfo;
};
