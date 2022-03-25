import { getNftImage, getTokenIconBySymbol } from '@pollum-io/sysweb3-utils';
import { setActiveNetwork, web3Provider } from '@pollum-io/sysweb3-network';
import { Web3Accounts } from '@pollum-io/sysweb3-keyring';

const Web3Controller = () => {
  const signTransaction = () => {};

  return {
    ...Web3Accounts(),
    signTransaction,
    web3Provider,
    setActiveNetwork,
    getNftImage,
    getTokenIconBySymbol,
  };
};

export default Web3Controller;
