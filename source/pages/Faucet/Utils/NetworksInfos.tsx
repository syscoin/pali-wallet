import { useMemo } from 'react';
import { useSelector } from 'react-redux';

import { FaucetChainIds, FaucetChainNames, FaucetChainSymbols } from '../Types';
import { RootState } from 'state/store';

export const useHandleNetworkTokenNames = () => {
  const { activeNetwork } = useSelector(
    (rootState: RootState) => rootState.vault
  );

  const { token: tokenSymbol, network: networkName } = useMemo(() => {
    let token: string;
    let network: string;

    if (activeNetwork.chainId === FaucetChainIds.nevmMainnet) {
      token = FaucetChainSymbols.SYS;
      network = FaucetChainNames.SYSCOIN_NEVM;
    } else if (activeNetwork.chainId === FaucetChainIds.nevmTestnet) {
      token = FaucetChainSymbols.TSYS;
      network = FaucetChainNames.SYSCOIN_NEVM_TESTNET;
    } else if (activeNetwork.chainId === FaucetChainIds.RolluxTestnet) {
      token = FaucetChainSymbols.TSYS;
      network = FaucetChainNames.ROLLUX_TESTNET;
    } else if (activeNetwork.chainId === FaucetChainIds.RolluxMainnet) {
      token = FaucetChainSymbols.SYS;
      network = FaucetChainNames.ROLLUX;
    } else {
      token = '';
      network = '';
    }

    return { token, network };
  }, [activeNetwork]);

  return {
    tokenSymbol,
    networkName,
  };
};
