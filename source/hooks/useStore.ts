import { useSelector } from 'react-redux';
import { IDAppState } from 'state/dapp/types';
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

  const { listening, whitelist }: IDAppState = useSelector(
    (state: RootState) => state.dapp
  );

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
    listening,
    whitelist,
  };
};
