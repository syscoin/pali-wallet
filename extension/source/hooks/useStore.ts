import { useSelector } from 'react-redux';
import { RootState } from 'state/store';
import IWalletState from 'state/wallet/types';

export const useStore = () => {
  const {
    status,
    accounts,
    activeAccountId,
    activeNetwork,
    encriptedMnemonic,
    confirmingTransaction,
    changingNetwork,
    signingTransaction,
    signingPSBT,
    walletTokens,
    tabs,
    timer,
    networks,
    trustedApps,
    temporaryTransactionState
  }: IWalletState = useSelector((state: RootState) => state.wallet);

  const {
    currentSenderURL,
    currentURL,
    canConnect,
    connections,
  } = tabs;

  return {
    status,
    accounts,
    activeAccountId,
    activeNetwork,
    encriptedMnemonic,
    confirmingTransaction,
    changingNetwork,
    signingTransaction,
    signingPSBT,
    walletTokens,
    timer,
    tabs,
    currentSenderURL,
    currentURL,
    canConnect,
    connections,
    networks,
    trustedApps,
    temporaryTransactionState
  }
}