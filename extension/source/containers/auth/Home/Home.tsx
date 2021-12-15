import React, { useEffect } from 'react';
import { Icon, Button } from 'components/index';
import {
  useController,
  useStore,
  usePrice,
  useFormat,
  useUtils,
  useAccount
} from 'hooks/index';

import { Header } from 'containers/common/Header';
import { TxsPanel } from './TxsPanel';

export const Home = () => {
  const controller = useController();
  const getFiatAmount = usePrice();

  const { history, handleRefresh } = useUtils();
  const { formatNumber } = useFormat();
  const { activeAccount } = useAccount();

  const {
    accounts,
    activeNetwork,
  } = useStore();

  useEffect(() => {
    if (
      !controller.wallet.isLocked() &&
      accounts.length > 0 &&
      activeAccount
    ) {
      handleRefresh(controller, activeAccount);
    }
  }, [!controller.wallet.isLocked(), accounts.length > 0]);

  return (
    <div className="bg-brand-navyborder overflow-auto home">
      {activeAccount ? (
        <>
          <Header accountHeader />

          <section
            className="flex items-center flex-col gap-1 text-brand-white bg-brand-navydarker py-14"
          >
            <div className="text-center flex justify-center flex-col items-center">
              {activeNetwork == 'testnet' ? (
                <div className="flex items-center justify-center gap-x-0.5">
                  <p className="text-5xl font-medium font-rubik">
                    {formatNumber(activeAccount?.balance || 0)}{' '}
                  </p>

                  <p className="font-poppins mt-4">TSYS</p>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-center gap-x-0.5">
                    <p className="text-5xl font-medium font-rubik">
                      {formatNumber(activeAccount?.balance || 0)}{' '}
                    </p>
                    
                    <p className="font-poppins mt-4">SYS</p>
                  </div>

                  <p>{getFiatAmount(activeAccount.balance || 0)}</p>
                </>
              )}
            </div>

            <div className="pt-8 w-3/4 flex justify-center items-center gap-x-0.5">
              <Button
                type="button"
                noStandard
                className="flex items-center justify-center flex-1 text-base rounded-l-full border border-brand-deepPink text-brand-white hover:bg-brand-deepPink transition-all duration-300"
                onClick={() => history.push('/send')}
              >
                <Icon
                  name="arrow-up"
                  className="w-4"
                  wrapperClassname="mb-2 mr-2"
                  rotate={40}
                />

                Send
              </Button>

              <Button
                type="button"
                noStandard
                className="flex items-center justify-center flex-1 text-base rounded-r-full border border-brand-royalBlue text-brand-white hover:bg-brand-royalBlue transition-all duration-300"
                onClick={() => history.push('/receive')}
              >
                <Icon
                  name="arrow-down"
                  className="w-4"
                  wrapperClassname="mb-2 mr-2"
                />

                Receive
              </Button>
            </div>
          </section>

          <TxsPanel />
        </>
      ) : (
        <div className="bg-brand-navy z-20 flex justify-center items-center fixed w-full h-full">
          <Icon name="loading" className="w-4 ml-2 text-brand-white" />
        </div>
      )}
    </div>
  );
};
