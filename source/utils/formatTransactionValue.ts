import { ethers } from 'ethers';

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
    const isSyscoinChain =
      Boolean(networks.syscoin[activeNetwork.chainId]) &&
      activeNetwork.url.includes('blockbook');

    const isSysTestnet = activeNetwork.chainId === 5700;

    if (!isSyscoinChain) {
      const web3Value = ethers.utils.formatEther(transactionValue);

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
    return 0;
  }
};
