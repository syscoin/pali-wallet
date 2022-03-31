import React, { useEffect, useState } from 'react';
import { Header, Icon, Button } from 'components/index';
import { useStore, usePrice, useUtils } from 'hooks/index';
import { formatNumber, getSymbolByChain } from 'utils/index';
import { getController } from 'utils/browser';

import { TxsPanel } from './TxsPanel';

export const Home = () => {
  const controller = getController();
  const [symbol, setSymbol] = useState('SYS');
  const { getFiatAmount } = usePrice();

  const { navigate, handleRefresh } = useUtils();
  const activeAccount = controller.wallet.account.getActiveAccount();

  const { accounts, activeNetwork, fiat } = useStore();

  const setChainSymbol = async () => {
    const sb = await getSymbolByChain(activeNetwork);
    console.log('curr symb', sb, activeNetwork);
    setSymbol(sb);
  };

  useEffect(() => {
    if (!controller.wallet.isLocked() && accounts.length > 0 && activeAccount)
      handleRefresh();
    setChainSymbol();
  }, [!controller.wallet.isLocked(), accounts.length > 0]);

  const isTestnet = activeNetwork === 'testnet';
  const isNotTestnet = activeNetwork === 'main' ? 'SYS' : symbol;

  return (
    <div className="scrollbar-styled h-full bg-bkg-3 overflow-auto">
      {activeAccount ? (
        <>
          <Header accountHeader />

          <section className="flex flex-col gap-1 items-center py-14 text-brand-white bg-bkg-1">
            <div className="flex flex-col items-center justify-center text-center">
              {activeNetwork && (
                <>
                  <div className="balance-account flex gap-x-0.5 items-center justify-center">
                    <p
                      id="home-balance"
                      className="font-rubik text-5xl font-medium"
                    >
                      {formatNumber(activeAccount?.balance || 0)}{' '}
                    </p>

                    <p className="mt-4 font-poppins">
                      {isTestnet ? 'TSYS' : isNotTestnet}
                    </p>
                  </div>

                  {activeNetwork !== 'testnet' && (
                    <p id="fiat-ammount">
                      {getFiatAmount(
                        activeAccount.balance || 0,
                        4,
                        String(fiat.current)
                      )}
                    </p>
                  )}
                </>
              )}
            </div>

            <div className="flex gap-x-0.5 items-center justify-center pt-8 w-3/4 max-w-md">
              <Button
                type="button"
                className="xl:p-18 flex flex-1 items-center justify-center text-brand-white text-base bg-button-primary hover:bg-button-primaryhover border border-button-primary rounded-l-full transition-all duration-300 xl:flex-none"
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
                className="xl:p-18 flex flex-1 items-center justify-center text-brand-white text-base bg-button-secondary hover:bg-button-secondaryhover border border-button-secondary rounded-r-full transition-all duration-300 xl:flex-none"
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
