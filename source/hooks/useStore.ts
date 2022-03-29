import { useSelector } from 'react-redux';
import IPriceState from 'state/price/types';
import { RootState } from 'state/store';
import { IVaultState } from 'state/vault/types';
import IWalletState from 'state/wallet/types';

export const useStore = () => {
  const {
    accounts,
    activeAccountId,
    activeNetwork,
    encriptedMnemonic,
    changingNetwork,
    signingTransaction,
    signingPSBT,
    walletTokens,
    tabs,
    networks,
    trustedApps,
    temporaryTransactionState,
  }: IWalletState = useSelector((state: RootState) => state.wallet);

  const { fiat }: IPriceState = useSelector((state: RootState) => state.price);

  const { timer }: IVaultState = useSelector((state: RootState) => state.vault);

  const { currentSenderURL, currentURL, canConnect, connections } = tabs;

  return {
    accounts,
    activeAccountId,
    activeNetwork,
    encriptedMnemonic,
    changingNetwork,
    signingTransaction,
    signingPSBT,
    walletTokens,
    tabs,
    currentSenderURL,
    currentURL,
    canConnect,
    connections,
    networks,
    trustedApps,
    temporaryTransactionState,
    fiat,
    timer,
  };
};
