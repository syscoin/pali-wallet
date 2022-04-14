import { useSelector } from 'react-redux';
import IPriceState from 'state/price/types';
import { RootState } from 'state/store';
import { IVaultState } from 'state/vault/types';

export const useStore = () => {
  const { fiat }: IPriceState = useSelector((state: RootState) => state.price);

  const {
    lastLogin,
    timer,
    encryptedMnemonic,
    trustedApps,
    activeNetwork,
    isPendingBalances,
    networks,
    activeAccount,
    accounts,
  }: IVaultState = useSelector((state: RootState) => state.vault);

  return {
    accounts,
    activeAccount,
    activeAccountId: activeAccount.id,
    activeNetwork,
    isPendingBalances,
    walletTokens: [],
    networks,
    trustedApps,
    lastLogin,
    fiat,
    timer,
    encryptedMnemonic,
  };
};
