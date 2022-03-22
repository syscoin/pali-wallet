import { web3Provider } from '@pollum-io/sysweb3-network';

export const EthereumProvider = () => {
  const getNetwork = async () => {
    const currentNetwork = await web3Provider.eth.net.getNetworkType();
    return currentNetwork;
  };

  const getAccounts = () => {
    await window.ethereum.enable();
    const accounts = await window.ethereum.request({
      method: 'eth_accounts',
    });

    return accounts;
  };

  const getChainId = async () => {
    await window.ethereum.enable();
    const chain: number = await window.ethereum.request({
      method: 'net_version',
    });

    return chain;
  };

  const getAddress = async () => {
    await window.ethereum.enable();
    const address = await window.ethereum.request({
      method: 'eth_requestAccounts',
    });

    return address[0];
  };

  const getBalance = (address) => {
    await window.ethereum.enable();
    const balance: number = await window.ethereum.request({
      method: 'eth_getBalance',
      params: [address, 'latest'],
    });

    return balance;
  };

  return {
    getAccounts,
    getNetwork,
    getChainId,
    getAddress,
    getBalance,
  };
};
