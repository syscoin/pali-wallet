import React, { useEffect, useState } from 'react';
import { Header, Icon, Button, Loading } from 'components/index';
import { useStore, usePrice, useUtils } from 'hooks/index';
import { formatNumber, getSymbolByChain } from 'utils/index';
import { getController } from 'utils/browser';

import { TxsPanel } from './TxsPanel';

export const Home = () => {
  const controller = getController();
  const { networks, activeNetwork, fiat, activeAccount, lastLogin } =
    useStore();
  const [symbol, setSymbol] = useState('SYS');

  const { getFiatAmount } = usePrice();

  const { navigate } = useUtils();

  const balance = networks.syscoin[activeNetwork.chainId]
    ? activeAccount.balances.syscoin
    : activeAccount.balances.ethereum;

  const setChainSymbol = async () => {
    const chain = networks.syscoin[activeNetwork.chainId]
      ? 'syscoin'
      : 'ethereum';
    const symbol = await getSymbolByChain(chain);

    setSymbol(symbol);
  };

  const isUnlocked = controller.wallet.isUnlocked();

  useEffect(() => {
    setChainSymbol();
  }, [isUnlocked]);

  const isSysTestnet = activeNetwork.chainId === 5700;
  const symbolByChain = isSysTestnet ? 'tsys' : symbol;

  return (
    <div className="scrollbar-styled h-full bg-bkg-3 overflow-auto">
      {activeAccount && lastLogin ? (
        <>
          <Header accountHeader />

          <section className="flex flex-col gap-1 items-center py-14 text-brand-white bg-bkg-1">
            <div className="flex flex-col items-center justify-center text-center">
              <div className="balance-account flex gap-x-0.5 items-center justify-center">
                <p
                  id="home-balance"
                  className="font-rubik text-5xl font-medium"
                >
                  {formatNumber(balance || 0)}{' '}
                </p>

                <p className="mt-4 font-poppins">
                  {activeNetwork.currency
                    ? activeNetwork.currency.toUpperCase()
                    : symbolByChain.toUpperCase()}
                </p>
              </div>

              <p id="fiat-ammount">
                {!isSysTestnet
                  ? getFiatAmount(balance || 0, 4, String(fiat.current))
                  : null}
              </p>
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
        <Loading />
      )}
    </div>
  );
};
