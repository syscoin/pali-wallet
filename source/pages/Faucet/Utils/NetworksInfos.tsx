import { useMemo } from 'react';
import { useSelector } from 'react-redux';

import { FaucetChainIds } from 'scripts/Background/controllers/message-handler/types';
import { RootState } from 'state/store';

export const faucetTxRolluxInfo = {
  icon: 'assets/images/rolluxChain.png',
  token: '$SYS',
  networkName: 'Rollux',
  quantity: 0.001,
  smartContract: '0x35EE5876Db071b527dC62FD3EE3c32e4304d8C23',
};

export const faucetTxRolluxTestnetInfo = {
  icon: 'assets/images/rolluxChain.png',
  token: '$TSYS',
  networkName: 'Rollux Testnet',
  quantity: 1,
  smartContract: '0x35EE5876Db071b527dC62FD3EE3c32e4304d8C23',
};

export const faucetTxSyscoinNEVMInfo = {
  icon: 'assets/images/sysChain.svg',
  token: '$SYS',
  networkName: 'Syscoin NEVM',
  quantity: 0.01,
  smartContract: '0x35EE5876Db071b527dC62FD3EE3c32e4304d8C23',
};

export const faucetTxSyscoinNEVMTestnetInfo = {
  icon: 'assets/images/sysChain.svg',
  token: '$TSYS',
  networkName: 'Syscoin NEVM Testnet',
  quantity: 1,
  smartContract: '0x35EE5876Db071b527dC62FD3EE3c32e4304d8C23',
};

export const useHandleNetworkTokenNames = () => {
  const { activeNetwork } = useSelector(
    (rootState: RootState) => rootState.vault
  );

  const { token: tokenSymbol, network: networkName } = useMemo(() => {
    let token: string;
    let network: string;

    if (activeNetwork.isTestnet) {
      token = 'TSYS';
      switch (activeNetwork.chainId) {
        case FaucetChainIds.RolluxTestnet:
          network = 'Rollux Testnet';
          break;
        case FaucetChainIds.nevmTestnet:
          network = 'Syscoin NEVM Testnet';
          break;
        default:
          network = '';
          break;
      }
    } else {
      token = 'SYS';
      switch (activeNetwork.chainId) {
        case FaucetChainIds.RolluxMainnet:
          network = 'Rollux';
          break;
        case FaucetChainIds.nevmMainnet:
          network = 'Syscoin NEVM';
          break;
        default:
          network = '';
          break;
      }
    }

    return { token, network };
  }, [activeNetwork]);

  return {
    tokenSymbol,
    networkName,
  };
};
