import { useSelector } from 'react-redux';
import { RootState } from 'state/store';
import IWalletState, { IAccountState } from 'state/wallet/types';

export const useAccount = () => {
  const { accounts, activeAccountId }: IWalletState = useSelector((state: RootState) => state.wallet);

  return {
    activeAccount: accounts.find((account: IAccountState) => account.id === activeAccountId),
  }
}