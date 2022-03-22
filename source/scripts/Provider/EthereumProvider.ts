// @ts-nocheck
import { web3Provider } from '@pollum-io/sysweb3-network';

export const EthereumProvider = () => {
  const getNetwork = async () => {
    const currentNetwork = await web3Provider.eth.net.getNetworkType();
    return currentNetwork;
  };

  const getAccounts = () => {
    if (window.ethereum) {
      await window.ethereum.enable();
      const accounts = await window.ethereum.request({
        method: 'eth_accounts',
      });

      return accounts;
    }
    return console.log('window.ethereum not found');
  };

  const getChainId = async () => {
    if (window.ethereum) {
      await window.ethereum.enable();
      const chain: number = await window.ethereum.request({
        method: 'net_version',
      });

      return chain;
    }
    return console.log('window.ethereum not found');
  };

  const getAddress = async () => {
    if (window.ethereum) {
      await window.ethereum.enable();
      const address = await window.ethereum.request({
        method: 'eth_requestAccounts',
      });

      return address[0];
    }
    return console.log('window.ethereum not found');
  };

  const getBalance = async (address: string) => {
    if (window.ethereum) {
      await window.ethereum.enable();
      const balance: number = await window.ethereum.request({
        method: 'eth_getBalance',
        params: [address, 'latest'],
      });

      return balance;
    }
    return console.log('window.ethereum not found');
  };

  return {
    getAccounts,
    getNetwork,
    getChainId,
    getAddress,
    getBalance,
  };
};
