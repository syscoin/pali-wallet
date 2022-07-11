import { ethers } from 'ethers';

import { web3Provider } from '@pollum-io/sysweb3-network';
import { INetwork } from '@pollum-io/sysweb3-utils';

import { chooseDecimalsPlaces } from 'utils/index';

export const formatTransactionValue = (
  transactionValue: string,
  activeNetwork: INetwork,
  networks: any,
  activeToken: string,
  forFiat?: boolean,
  decimals?: number
) => {
  try {
    const isSyscoinChain = Boolean(networks.syscoin[activeNetwork.chainId]);

    const isSysTestnet = activeNetwork.chainId === 5700;

    if (!isSyscoinChain) {
      const web3Value = web3Provider.utils.fromWei(transactionValue);

      return forFiat
        ? web3Value
        : chooseDecimalsPlaces(web3Value, decimals || 2) +
            `${activeToken || ' ETH'}`;
    }

    const syscoinValue = ethers.utils.formatUnits(transactionValue, 8);

    return forFiat
      ? syscoinValue
      : chooseDecimalsPlaces(syscoinValue, 4) +
          `${isSysTestnet ? ' TSYS' : ' SYS'}`;
  } catch (error) {
    console.log('error', error);
    return 0;
  }
};
