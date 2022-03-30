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
    changingNetwork,
    signingTransaction,
    signingPSBT,
    walletTokens,
    tabs,
    networks,
    temporaryTransactionState,
  }: IWalletState = useSelector((state: RootState) => state.wallet);

  const { fiat }: IPriceState = useSelector((state: RootState) => state.price);

  const { timer, hasEncryptedVault, trustedApps }: IVaultState = useSelector(
    (state: RootState) => state.vault
  );

  const { currentSenderURL, currentURL, canConnect, connections } = tabs;

  return {
    accounts,
    activeAccountId,
    activeNetwork,
    hasEncryptedVault,
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
