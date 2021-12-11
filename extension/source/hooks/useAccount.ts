import { useSelector } from 'react-redux';
import { RootState } from 'state/store';
import IWalletState, { IAccountState } from 'state/wallet/types';
import { useController, useUtils, useWindowsAPI } from '.';

export const useAccount = () => {
  const {
    accounts,
    activeAccountId
  }: IWalletState = useSelector((state: RootState) => state.wallet);

  const { getCurrentOrigin } = useWindowsAPI();
  const { getHost } = useUtils();

  const controller = useController();

  const connectedAccount = () => {
    if (!controller.wallet.isLocked()) {
      return accounts.find((account: IAccountState) => {
        return account.connectedTo.findIndex(async (url: string) => url === getHost(String(await getCurrentOrigin()))) > -1;
      })
    }

    return null;
  }

  const activeAccount = () => {
    return accounts.find((account: IAccountState) => account.id === activeAccountId);
  }

  return {
    activeAccount: activeAccount(),
    connectedAccount: connectedAccount(),
  }
}