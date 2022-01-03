import React, { useEffect } from 'react';
import { AuthViewLayout } from 'containers/common/Layout';
import { useController, useStore, useUtils } from 'hooks/index';
import { PrimaryButton } from 'components/index';

const CurrencyView = () => {
  const controller = useController();

  const { accounts, activeAccountId } =
    useStore();

  const { history } = useUtils();

  const handleRefresh = () => {
    controller.wallet.account.getLatestUpdate();
    controller.wallet.account.watchMemPool(accounts[activeAccountId]);
    controller.stateUpdater();
  };

  useEffect(() => {
    if (
      !controller.wallet.isLocked() &&
      accounts.length > 0 &&
      accounts.find((element) => element.id === activeAccountId)
    ) {
      handleRefresh();
    }
  }, [!controller.wallet.isLocked(), accounts.length > 0]);

  return (
    <AuthViewLayout title="FIAT CURRENCY">
      <PrimaryButton
        type="button"
        onClick={() => history.push('/home')}
      >
        Save
      </PrimaryButton>
    </AuthViewLayout>
  );
};

export default CurrencyView;
