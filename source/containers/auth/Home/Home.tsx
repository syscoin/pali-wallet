import React, { useEffect } from 'react';
import { Icon, Button } from 'components/index';
import {
  useController,
  useStore,
  usePrice,
  useFormat,
  useUtils,
  useAccount,
} from 'hooks/index';
import { Header } from 'containers/common/Header';

import { TxsPanel } from './TxsPanel';

export const Home = () => {
  const controller = useController();
  const getFiatAmount = usePrice();

  const { navigate, handleRefresh } = useUtils();
  const { formatNumber } = useFormat();
  const { activeAccount } = useAccount();

  const { accounts, activeNetwork, fiat } = useStore();

  useEffect(() => {
    if (!controller.wallet.isLocked() && accounts.length > 0 && activeAccount) {
      handleRefresh(controller, activeAccount);
    }
  }, [!controller.wallet.isLocked(), accounts.length > 0]);

  return (
    <div className="scrollbar-styled h-full bg-bkg-3 overflow-auto">
      {activeAccount ? (
        <>
          <Header accountHeader />

          <section className="flex flex-col gap-1 items-center py-14 text-brand-white bg-bkg-1">
            <div className="flex flex-col items-center justify-center text-center">
              {activeNetwork === 'testnet' ? (
                <div className="flex items-center justify-center gap-x-0.5 balance-account">
                  <p
                    className="text-5xl font-medium font-rubik"
                    id="home-balance"
                  >
                    {formatNumber(activeAccount?.balance || 0)}{' '}
                  </p>

                  <p className="mt-4 font-poppins">TSYS</p>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-center gap-x-0.5 balance-account">
                    <p
                      id="home-balance"
                      className="text-5xl font-medium font-rubik"
                    >
                      {formatNumber(activeAccount?.balance || 0)}{' '}
                    </p>

                    <p className="mt-4 font-poppins">SYS</p>
                  </div>

                  <p id="fiat-ammount">
                    {getFiatAmount(
                      activeAccount.balance || 0,
                      4,
                      String(fiat.current)
                    )}
                  </p>
                </>
              )}
            </div>

            <div className="flex gap-x-0.5 items-center justify-center pt-8 w-3/4 max-w-md">
              <Button
                type="button"
                className="flex items-center justify-center flex-1 xl:flex-none xl:p-18 text-base rounded-l-full border border-button-primary bg-button-primary text-brand-white transition-all duration-300 hover:bg-button-primaryhover"
                id="send-btn"
                onClick={() => navigate('/send')}
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
                className="flex items-center justify-center flex-1 xl:flex-none xl:p-18 text-base rounded-r-full border border-button-secondary bg-button-secondary text-brand-white hover:bg-button-secondaryhover transition-all duration-300"
                id="receive-btn"
                onClick={() => navigate('/receive')}
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
        <div className="fixed z-20 flex items-center justify-center w-full min-w-popup h-full min-h-popup bg-bkg-2">
          <Icon name="loading" className="ml-2 w-4 text-brand-white" />
        </div>
      )}
    </div>
  );
};
