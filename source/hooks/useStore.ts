import { useSelector } from 'react-redux';
import IPriceState from 'state/price/types';
import { RootState } from 'state/store';
import { IVaultState } from 'state/vault/types';

export const useStore = () => {
  const { fiat }: IPriceState = useSelector((state: RootState) => state.price);

  const {
    temporaryTransactionState,
    timer,
    hasEncryptedVault,
    trustedApps,
    activeNetwork,
    isPendingBalances,
    networks,
    activeAccount,
    accounts,
  }: IVaultState = useSelector((state: RootState) => state.vault);

  return {
    accounts,
    activeAccountId: activeAccount.id,
    activeNetwork,
    hasEncryptedVault,
    isPendingBalances,
    walletTokens: [],
    networks,
    trustedApps,
    temporaryTransactionState,
    fiat,
    timer,
  };
};
