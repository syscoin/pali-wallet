import { useSelector } from 'react-redux';
import IPriceState from 'state/price/types';
import { RootState } from 'state/store';
import IWalletState from 'state/wallet/types';

export const useStore = () => {
  const {
    accounts,
    activeAccountId,
    activeNetwork,
    activeChainId,
    activeNetworkType,
    encriptedMnemonic,
    confirmingTransaction,
    changingNetwork,
    signingTransaction,
    signingPSBT,
    walletTokens,
    tabs,
    trustedApps,
    networks,
  }: IWalletState = useSelector((state: RootState) => state.wallet);

  // const { temporaryTransactionState, status, timer, networks } = useSelector(
  //   (state: RootState) => state.vault
  // );

  const { fiat }: IPriceState = useSelector((state: RootState) => state.price);

  const { currentSenderURL, currentURL, canConnect, connections } = tabs;

  return {
    status: 1,
    accounts,
    activeAccountId,
    activeNetwork,
    activeChainId,
    activeNetworkType,
    encriptedMnemonic,
    confirmingTransaction,
    changingNetwork,
    signingTransaction,
    signingPSBT,
    walletTokens,
    timer: 5,
    tabs,
    currentSenderURL,
    currentURL,
    canConnect,
    connections,
    networks,
    trustedApps,
    temporaryTransactionState: { executing: false, type: '' },
    fiat,
  };
};
