import { useSelector } from 'react-redux';
import { RootState } from 'state/store';
import { getHost } from 'utils/index';
import IWalletState, { IAccountState } from 'state/wallet/types';

import { useController, useWindowsAPI } from '.';

export const useAccount = () => {
  const { accounts, activeAccountId }: IWalletState = useSelector(
    (state: RootState) => state.wallet
  );

  const { getCurrentOrigin } = useWindowsAPI();

  const controller = useController();

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
