import { useSelector } from 'react-redux';
import { RootState } from 'state/store';
import { getHost, getCurrentOrigin, getController } from 'utils/index';
import IWalletState, { IAccountState } from 'state/wallet/types';

export const useAccount = () => {
  const { accounts, activeAccountId }: IWalletState = useSelector(
    (state: RootState) => state.wallet
  );

  const controller = getController();

  const connectedAccount = () => {
    if (!controller.wallet.isLocked()) {
      return accounts.find(
        (account: IAccountState) =>
          account.connectedTo.findIndex(
            async (url: string) =>
              url === getHost(String(await getCurrentOrigin()))
          ) > -1
      );
    }

    return null;
  };

  const activeAccount = () =>
    accounts.find((account: IAccountState) => account.id === activeAccountId);

  return {
    activeAccount: activeAccount(),
    connectedAccount: connectedAccount(),
  };
};
