import { useSelector } from 'react-redux';
import IPriceState from 'state/price/types';
import { RootState } from 'state/store';
import { IVaultState } from 'state/vault/types';
import IWalletState from 'state/wallet/types';

export const useStore = () => {
  const { accounts, activeAccountId, walletTokens }: IWalletState = useSelector(
    (state: RootState) => state.wallet
  );

  const { fiat }: IPriceState = useSelector((state: RootState) => state.price);

  const {
    temporaryTransactionState,
    timer,
    hasEncryptedVault,
    trustedApps,
    activeNetwork,
    isPendingBalances,
    networks,
  }: IVaultState = useSelector((state: RootState) => state.vault);

  return {
    accounts,
    activeAccountId,
    activeNetwork,
    hasEncryptedVault,
    isPendingBalances,
    walletTokens,
    networks,
    trustedApps,
    temporaryTransactionState,
    fiat,
    timer,
  };
};
