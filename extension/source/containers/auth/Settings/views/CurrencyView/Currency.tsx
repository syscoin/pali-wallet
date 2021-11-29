import React, { useEffect } from 'react';
import { AuthViewLayout } from 'containers/common/Layout';
import { useController, useFormat, useStore, useFiat } from 'hooks/index';
import { Icon } from 'components/Icon';
import { Button } from 'components/Button';
import { Input } from 'antd';
const { formatNumber } = useFormat();
const DeleteWalletView = () => {
  // const controller = useController();
  const controller = useController();
  const { accounts, activeAccountId, activeNetwork, changingNetwork } =
    useStore();
  const getFiatAmount = useFiat();
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
    <>
      <AuthViewLayout title="CURRENCY"> </AuthViewLayout>
      <div className="flex  flex-col min-w-full px-8">
        <div className="text-white pt-4">
          <p className="text-base text-left">Choose your currencies</p>
        </div>
        <div className="inline-flex grid-cols gap-4 pt-4">
          <div className="p-0.5 rounded-full border border-brand-royalBlue">
            <select className="rounded-full py-1 px-2 bg-brand-navydarker border-royalBlue text-brand-royalBlue w-36">
              <option className="text-base">Main</option>
            </select>
          </div>
          <div className="p-0.5 rounded-full border border-brand-royalBlue">
            <select className="rounded-full py-1 px-2 bg-brand-navydarker border-royalBlue text-brand-royalBlue w-36">
              <option className="text-base">Fiat</option>
            </select>
          </div>
        </div>
        <div>
          <section className="flex items-center flex-col gap-1 text-brand-white pb-6 pt-6">
            {changingNetwork ? (
              <Icon
                name="loading"
                className="w-4 bg-brand-gray200 text-brand-navy"
              />
            ) : (
              <div className="flex justify-center">
                <p className="text-5xl flex-1 font-medium">
                  {formatNumber(
                    accounts.find((element) => element.id === activeAccountId)
                      ?.balance || 5268
                  )}{' '}
                </p>
                <p className="flex-1 self-end pl-0.5">
                  {activeNetwork == 'testnet' ? 'TSYS' : 'SYS'}
                </p>
              </div>
            )}

            {changingNetwork ? (
              <p className="text-royalBlue">...</p>
            ) : (
              <small className="mt-1.5 mb-1.5 text-brand-royalblue">
                {activeNetwork !== 'testnet'
                  ? getFiatAmount(
                      accounts.find((element) => element.id === activeAccountId)
                        ?.balance || 0
                    )
                  : ''}
              </small>
            )}
            <div className="pt-6">
              <Button type="submit">Save</Button>
            </div>
          </section>
        </div>
      </div>
      <div className="bg-brand-darkRoyalBlue px-4 h-40">
        <div>
          <p className="text-base pt-4 text-white">
            Check your balance in different currencies
          </p>
        </div>
        <div className="pb-2 pt-2">
          <Input
            size="large"
            className="rounded-full bg-brand-navydarker w-full h-10 "
          />
        </div>
        <div className="pb-2">
          <Input size="large" className="rounded-full bg-brand-navydarker w-full h-10" />
        </div>
      </div>
    </>
  );
};

export default DeleteWalletView;
