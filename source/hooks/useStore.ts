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
    walletTokens,
    networks,
    temporaryTransactionState,
  }: IWalletState = useSelector((state: RootState) => state.wallet);

  const { fiat }: IPriceState = useSelector((state: RootState) => state.price);

  const { timer, hasEncryptedVault, trustedApps }: IVaultState = useSelector(
    (state: RootState) => state.vault
  );

  return {
    accounts,
    activeAccountId,
    activeNetwork,
    hasEncryptedVault,
    changingNetwork,
    walletTokens,
    networks,
    trustedApps,
    temporaryTransactionState,
    fiat,
    timer,
  };
};
