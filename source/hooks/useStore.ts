import { useSelector } from 'react-redux';

import { RootState } from 'state/store';

export const useStore = () => {
  const fiat = useSelector((state: RootState) => state.price.fiat);
  const coins = useSelector((state: RootState) => state.price.coins);

  const lastLogin = useSelector((state: RootState) => state.vault.lastLogin);
  const timer = useSelector((state: RootState) => state.vault.timer);
  const encryptedMnemonic = useSelector(
    (state: RootState) => state.vault.encryptedMnemonic
  );
  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );
  const isPendingBalances = useSelector(
    (state: RootState) => state.vault.isPendingBalances
  );
  const networks = useSelector((state: RootState) => state.vault.networks);
  const activeAccount = useSelector(
    (state: RootState) => state.vault.activeAccount
  );
  const accounts = useSelector((state: RootState) => state.vault.accounts);
  const error = useSelector((state: RootState) => state.vault.error);

  return {
    accounts,
    activeAccount,
    activeAccountId: activeAccount.id,
    activeNetwork,
    isPendingBalances,
    networks,
    lastLogin,
    fiat,
    coins,
    timer,
    encryptedMnemonic,
    error,
  };
};
